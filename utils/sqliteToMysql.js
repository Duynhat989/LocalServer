const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const { defineUser } = require('../models/User');
const { defineSession } = require('../models/Session');
const { definePost } = require('../models/Post');
const { defineGroup } = require('../models/Group');
const { defineCampaign } = require('../models/Campaign');
const { defineCampaignPhone } = require('../models/CampaignPhone');
const { defineKeywordFilter } = require('../models/KeywordFilter');
const { defineAppSetting } = require('../models/AppSetting');
const { defineApiKey } = require('../models/ApiKey');
const { defineActivityLog } = require('../models/ActivityLog');

const BATCH = 400;

function migrationMarkerPath(dataDir) {
  return path.join(dataDir, '.sqlite-migrated-to-mysql.json');
}

function readMigrationMarker(dataDir) {
  const file = migrationMarkerPath(dataDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { done: true };
  }
}

function writeMigrationMarker(dataDir, payload) {
  fs.writeFileSync(
    migrationMarkerPath(dataDir),
    JSON.stringify({ ...payload, done: true, at: new Date().toISOString() }, null, 2)
  );
}

function archiveSqliteFile(sqlitePath) {
  const dir = path.dirname(sqlitePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(dir, `localserver.db.bak-${stamp}`);
  fs.renameSync(sqlitePath, backup);
  for (const extra of ['localserver.db-shm', 'localserver.db-wal']) {
    const full = path.join(dir, extra);
    if (fs.existsSync(full)) {
      fs.renameSync(full, `${backup}-${path.basename(extra)}`);
    }
  }
  return backup;
}

function openSqliteModels(storagePath) {
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: storagePath,
    logging: false,
    define: { underscored: false, freezeTableName: true },
  });
  const models = {
    User: defineUser(sequelize),
    Session: defineSession(sequelize),
    Post: definePost(sequelize),
    Group: defineGroup(sequelize),
    Campaign: defineCampaign(sequelize),
    CampaignPhone: defineCampaignPhone(sequelize),
    KeywordFilter: defineKeywordFilter(sequelize),
    AppSetting: defineAppSetting(sequelize),
    ApiKey: defineApiKey(sequelize),
    ActivityLog: defineActivityLog(sequelize),
  };
  return { sequelize, models };
}

async function copyInBatches(sourceModel, targetModel, label) {
  const total = await sourceModel.count();
  if (!total) return 0;

  let copied = 0;
  let offset = 0;
  while (offset < total) {
    const rows = await sourceModel.findAll({
      order: [['id', 'ASC']],
      limit: BATCH,
      offset,
      raw: true,
    });
    if (!rows.length) break;
    await targetModel.bulkCreate(rows, { ignoreDuplicates: true });
    copied += rows.length;
    offset += rows.length;
    if (rows.length < BATCH) break;
  }
  console.log(`[migrate] ${label}: ${copied}/${total}`);
  return copied;
}

async function bumpAutoIncrement(sequelize, table, idColumn = 'id') {
  const [rows] = await sequelize.query(
    `SELECT MAX(\`${idColumn}\`) AS maxId FROM \`${table}\``
  );
  const maxId = Number(rows[0]?.maxId) || 0;
  if (maxId > 0) {
    await sequelize.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = ${maxId + 1}`);
  }
}

/**
 * Copy data from legacy SQLite file into active MySQL models.
 */
async function migrateSqliteFileToMysql(mysqlModels, sqlitePath, dataDir) {
  if (!fs.existsSync(sqlitePath)) return { skipped: true, reason: 'no-sqlite-file' };

  const { sequelize: sqliteDb, models: src } = openSqliteModels(sqlitePath);
  try {
    await sqliteDb.authenticate();
  } catch (err) {
    console.warn('[migrate] Không đọc được SQLite:', err.message || err);
    return { skipped: true, reason: 'sqlite-unreadable' };
  }

  const dest = mysqlModels;
  const mysqlSequelize = dest.User.sequelize;

  const existingUsers = await dest.User.count();
  const sqliteUsers = await src.User.count().catch(() => 0);
  if (existingUsers > 0 && sqliteUsers > 0) {
    console.log(
      '[migrate] MySQL đã có dữ liệu — bỏ qua đồng bộ SQLite (xóa MySQL hoặc DB_RESET=1 nếu muốn import lại)'
    );
    return { skipped: true, reason: 'mysql-not-empty' };
  }

  if (sqliteUsers === 0 && (await src.Post.count().catch(() => 0)) === 0) {
    return { skipped: true, reason: 'sqlite-empty' };
  }

  console.log('[migrate] Bắt đầu đồng bộ SQLite → MySQL:', sqlitePath);

  const counts = {};
  counts.users = await copyInBatches(src.User, dest.User, 'users');
  counts.groups = await copyInBatches(src.Group, dest.Group, 'groups');
  counts.campaigns = await copyInBatches(src.Campaign, dest.Campaign, 'campaigns');
  counts.keyword_filters = await copyInBatches(
    src.KeywordFilter,
    dest.KeywordFilter,
    'keyword_filters'
  );
  counts.posts = await copyInBatches(src.Post, dest.Post, 'posts');
  counts.campaign_phones = await copyInBatches(
    src.CampaignPhone,
    dest.CampaignPhone,
    'campaign_phones'
  );
  counts.activity_logs = await copyInBatches(
    src.ActivityLog,
    dest.ActivityLog,
    'activity_logs'
  );

  const sessionRows = await src.Session.findAll({ raw: true });
  if (sessionRows.length) {
    await dest.Session.bulkCreate(sessionRows, { ignoreDuplicates: true });
    counts.sessions = sessionRows.length;
    console.log(`[migrate] sessions: ${sessionRows.length}`);
  }

  const apiKeyRows = await src.ApiKey.findAll({ raw: true });
  if (apiKeyRows.length) {
    await dest.ApiKey.bulkCreate(apiKeyRows, { ignoreDuplicates: true });
    counts.api_keys = apiKeyRows.length;
    console.log(`[migrate] api_keys: ${apiKeyRows.length}`);
  }

  const settingRows = await src.AppSetting.findAll({ raw: true });
  if (settingRows.length) {
    await dest.AppSetting.bulkCreate(settingRows, { ignoreDuplicates: true });
    counts.app_settings = settingRows.length;
    console.log(`[migrate] app_settings: ${settingRows.length}`);
  }

  for (const table of [
    'users',
    'groups',
    'campaigns',
    'keyword_filters',
    'posts',
    'campaign_phones',
    'activity_logs',
    'api_keys',
  ]) {
    await bumpAutoIncrement(mysqlSequelize, table);
  }

  const backupPath = archiveSqliteFile(sqlitePath);
  writeMigrationMarker(dataDir, { sourcePath: sqlitePath, backupPath, counts });
  console.log('[migrate] Hoàn tất. SQLite đã lưu backup:', backupPath);

  await sqliteDb.close();
  return { ok: true, counts, backupPath };
}

module.exports = {
  migrateSqliteFileToMysql,
  migrationMarkerPath,
};
