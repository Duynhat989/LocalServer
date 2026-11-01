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

/** Lô tối đa cho bảng nhẹ (users, groups, …) */
const BATCH_DEFAULT = 10_000;

/** Bảng có TEXT lớn — tránh vượt max_allowed_packet MySQL */
const BATCH_HEAVY = 400;

const BATCH_BY_LABEL = {
  posts: BATCH_HEAVY,
  campaign_phones: BATCH_HEAVY,
  activity_logs: 800,
  keyword_filters: 2000,
};

function batchSizeFor(label) {
  return BATCH_BY_LABEL[label] ?? BATCH_DEFAULT;
}

function isPacketTooLarge(err) {
  const p = err?.parent || err?.original || err;
  return (
    p?.errno === 1153 ||
    p?.code === 'ER_NET_PACKET_TOO_LARGE' ||
    /max_allowed_packet/i.test(String(p?.message || err?.message || ''))
  );
}

async function safeBulkCreate(targetModel, rows) {
  if (!rows.length) return;
  try {
    await targetModel.bulkCreate(rows, { ignoreDuplicates: true });
  } catch (err) {
    if (!isPacketTooLarge(err) || rows.length <= 1) throw err;
    const mid = Math.ceil(rows.length / 2);
    await safeBulkCreate(targetModel, rows.slice(0, mid));
    await safeBulkCreate(targetModel, rows.slice(mid));
  }
}

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

  const batchSize = batchSizeFor(label);
  logMigrate(`${label}: bắt đầu — ${total} dòng, đọc ${batchSize} dòng/lô (bulk tự chia nếu packet lớn)`);
  const started = Date.now();
  let copied = 0;
  let lastId = 0;
  let batchNo = 0;

  while (true) {
    const rows = await sourceModel.findAll({
      where: { id: { [Op.gt]: lastId } },
      order: [['id', 'ASC']],
      limit: batchSize,
      raw: true,
    });
    if (!rows.length) break;

    batchNo += 1;
    await safeBulkCreate(targetModel, rows);
    copied += rows.length;
    lastId = rows[rows.length - 1].id;

    const pct = Math.min(100, Math.round((copied / total) * 100));
    logMigrate(`${label}: lô ${batchNo} — đã đẩy ${copied}/${total} (${pct}%)`);

    if (rows.length < batchSize) break;
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
  logMigrate(`${label}: đẩy ${rows.length} dòng`);
  await safeBulkCreate(targetModel, rows);
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

const migrationState = {
  running: false,
  phase: 'idle',
  error: null,
  startedAt: null,
  promise: null,
};

function getSqliteMigrationStatus() {
  return {
    running: migrationState.running,
    phase: migrationState.phase,
    error: migrationState.error,
    startedAt: migrationState.startedAt,
  };
}

/**
 * Copy data from legacy SQLite file into active MySQL models.
 */
async function migrateSqliteFileToMysql(mysqlModels, sqlitePath, dataDir, hooks = {}) {
  const onPhase = hooks.onPhase || (() => {});
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
  logMigrate(
    `Cấu hình: bảng nhẹ ${BATCH_DEFAULT} dòng/lô · posts/campaign_phones ${BATCH_HEAVY} dòng/lô`
  );
  logMigrate('════════════════════════════════════════');

  const counts = {};

  onPhase('core');
  logMigrate('Bảng cấu hình / metadata (users, groups, …) — chạy nền');
  counts.users = await copyInBatches(src.User, dest.User, 'users');
  counts.groups = await copyInBatches(src.Group, dest.Group, 'groups');
  counts.campaigns = await copyInBatches(src.Campaign, dest.Campaign, 'campaigns');
  counts.keyword_filters = await copyInBatches(
    src.KeywordFilter,
    dest.KeywordFilter,
    'keyword_filters'
  );
  counts.sessions = await copyAllRows(src.Session, dest.Session, 'sessions');
  counts.api_keys = await copyAllRows(src.ApiKey, dest.ApiKey, 'api_keys');
  counts.app_settings = await copyAllRows(src.AppSetting, dest.AppSetting, 'app_settings');

  onPhase('posts');
  logMigrate('posts / campaign_phones / activity_logs — đồng bộ ngầm (server có thể dùng trước)');
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

  onPhase('finalize');

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

/**
 * Chạy SQLite → MySQL không chặn startup. Gọi onComplete khi xong hoặc bỏ qua.
 */
function startSqliteToMysqlMigration(mysqlModels, sqlitePath, dataDir, { onComplete } = {}) {
  if (migrationState.promise) {
    return migrationState.promise;
  }

  migrationState.running = true;
  migrationState.phase = 'starting';
  migrationState.error = null;
  migrationState.startedAt = new Date().toISOString();

  migrationState.promise = (async () => {
    try {
      const result = await migrateSqliteFileToMysql(mysqlModels, sqlitePath, dataDir, {
        onPhase(phase) {
          migrationState.phase = phase;
        },
      });

      migrationState.phase = result.skipped ? 'skipped' : 'done';
      if (typeof onComplete === 'function') {
        await onComplete(result);
      }
      return result;
    } catch (err) {
      migrationState.phase = 'error';
      migrationState.error = err.message || String(err);
      console.error('[migrate] Lỗi đồng bộ nền:', migrationState.error);
      if (typeof onComplete === 'function') {
        try {
          await onComplete({ skipped: true, reason: 'error', error: err });
        } catch (hookErr) {
          console.error('[migrate] onComplete:', hookErr.message || hookErr);
        }
      }
      throw err;
    } finally {
      migrationState.running = false;
    }
  })();

  return migrationState.promise;
}

module.exports = {
  migrateSqliteFileToMysql,
  startSqliteToMysqlMigration,
  getSqliteMigrationStatus,
  migrationMarkerPath,
  BATCH_DEFAULT,
  BATCH_HEAVY,
  safeBulkCreate,
};
