const fs = require('fs');
const path = require('path');
const { Sequelize, Op } = require('sequelize');
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

/** Số dòng copy mỗi lần bulkCreate sang MySQL */
const BATCH = 10_000;

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

function logMigrate(message) {
  console.log(`[migrate] ${message}`);
}

async function copyInBatches(sourceModel, targetModel, label) {
  const total = await sourceModel.count();
  if (!total) {
    logMigrate(`${label}: 0 dòng — bỏ qua`);
    return 0;
  }

  logMigrate(`${label}: bắt đầu — ${total} dòng, mỗi lô tối đa ${BATCH}`);
  const started = Date.now();
  let copied = 0;
  let lastId = 0;
  let batchNo = 0;

  while (true) {
    const rows = await sourceModel.findAll({
      where: { id: { [Op.gt]: lastId } },
      order: [['id', 'ASC']],
      limit: BATCH,
      raw: true,
    });
    if (!rows.length) break;

    batchNo += 1;
    await targetModel.bulkCreate(rows, { ignoreDuplicates: true });
    copied += rows.length;
    lastId = rows[rows.length - 1].id;

    const pct = Math.min(100, Math.round((copied / total) * 100));
    logMigrate(`${label}: lô ${batchNo} — đã đẩy ${copied}/${total} (${pct}%)`);

    if (rows.length < BATCH) break;
  }

  const sec = ((Date.now() - started) / 1000).toFixed(1);
  logMigrate(`${label}: hoàn tất — ${copied}/${total} dòng (${sec}s)`);
  return copied;
}

async function copyAllRows(sourceModel, targetModel, label) {
  const rows = await sourceModel.findAll({ raw: true });
  if (!rows.length) {
    logMigrate(`${label}: 0 dòng — bỏ qua`);
    return 0;
  }
  logMigrate(`${label}: đẩy ${rows.length} dòng (một lần)`);
  await targetModel.bulkCreate(rows, { ignoreDuplicates: true });
  logMigrate(`${label}: xong — ${rows.length} dòng`);
  return rows.length;
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
  if (!fs.existsSync(sqlitePath)) {
    return { skipped: true, reason: 'no-sqlite-file' };
  }

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
    logMigrate('MySQL đã có dữ liệu. Bỏ qua quá trình đồng bộ dữ liệu từ SQLite.');
    logMigrate('[Nếu muốn import lại] Hãy xóa dữ liệu MySQL hoặc đặt DB_RESET=1.');
    await sqliteDb.close();
    return { skipped: true, reason: 'mysql-not-empty' };
  }

  const sqlitePostCount = await src.Post.count().catch(() => 0);
  if (sqliteUsers === 0 && sqlitePostCount === 0) {
    await sqliteDb.close();
    return { skipped: true, reason: 'sqlite-empty' };
  }

  const migrateStarted = Date.now();
  logMigrate('════════════════════════════════════════');
  logMigrate(`Bắt đầu SQLite → MySQL: ${sqlitePath}`);
  logMigrate(`Cấu hình: ${BATCH} dòng / lô bulkCreate`);
  logMigrate('════════════════════════════════════════');

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

  counts.sessions = await copyAllRows(src.Session, dest.Session, 'sessions');
  counts.api_keys = await copyAllRows(src.ApiKey, dest.ApiKey, 'api_keys');
  counts.app_settings = await copyAllRows(src.AppSetting, dest.AppSetting, 'app_settings');

  logMigrate('Đang cập nhật AUTO_INCREMENT…');
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

  const totalSec = ((Date.now() - migrateStarted) / 1000).toFixed(1);
  logMigrate('════════════════════════════════════════');
  logMigrate(`Hoàn tất đồng bộ (${totalSec}s). Backup SQLite: ${backupPath}`);
  logMigrate(`Tóm tắt: ${JSON.stringify(counts)}`);
  logMigrate('════════════════════════════════════════');

  await sqliteDb.close();
  return { ok: true, counts, backupPath };
}

module.exports = {
  migrateSqliteFileToMysql,
  migrationMarkerPath,
  BATCH,
};
