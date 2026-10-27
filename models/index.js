const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const { defineUser } = require('./User');
const { defineSession } = require('./Session');
const { definePost } = require('./Post');
const { defineGroup } = require('./Group');
const { defineCampaign } = require('./Campaign');
const { defineCampaignPhone } = require('./CampaignPhone');
const { defineKeywordFilter } = require('./KeywordFilter');
const { defineAppSetting } = require('./AppSetting');
const { defineApiKey } = require('./ApiKey');
const { defineActivityLog } = require('./ActivityLog');
const { hashPassword } = require('../utils/password');
const { buildPostKeyword } = require('../utils/text');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'localserver.db');

let sequelize = null;
let User = null;
let Session = null;
let Post = null;
let Group = null;
let Campaign = null;
let CampaignPhone = null;
let KeywordFilter = null;
let AppSetting = null;
let ApiKey = null;
let ActivityLog = null;

function createSequelize() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  return new Sequelize({
    dialect: 'sqlite',
    storage: DB_PATH,
    logging: false,
    define: {
      underscored: false,
      freezeTableName: true,
    },
  });
}

function associateModels(models) {
  models.User.hasMany(models.Session, {
    foreignKey: 'userId',
    as: 'sessions',
    onDelete: 'CASCADE',
  });
  models.Session.belongsTo(models.User, {
    foreignKey: 'userId',
    as: 'user',
  });

  models.Campaign.hasMany(models.CampaignPhone, {
    foreignKey: 'campaignId',
    as: 'phones',
    onDelete: 'CASCADE',
  });
  models.CampaignPhone.belongsTo(models.Campaign, {
    foreignKey: 'campaignId',
    as: 'campaign',
  });

  models.User.hasMany(models.ApiKey, {
    foreignKey: 'userId',
    as: 'apiKeys',
    onDelete: 'CASCADE',
  });
  models.ApiKey.belongsTo(models.User, {
    foreignKey: 'userId',
    as: 'user',
  });
}

async function seedAdmin(UserModel) {
  const count = await UserModel.count();
  if (count > 0) return;

  const { salt, hash } = hashPassword('admin123');
  await UserModel.create({
    username: 'admin',
    passwordHash: hash,
    passwordSalt: salt,
    role: 'admin',
    locked: false,
  });
  console.log('Created default admin: admin / admin123');
}

async function seedSamplePost(PostModel) {
  const count = await PostModel.count();
  if (count > 0) return;

  await PostModel.create({
    postId: '1000832851236530_1849299173056556',
    postMessage:
      '🔥 49,5 TỶ SỞ HỮU BIỆT THỰ LÔ GÓC HÀM NGHI – 131M², 6 TẦNG, MẶT TIỀN 6M – VỈA HÈ 6M, 3 Ô TÔ TRÁNH NHAU! 🔥',
    postUrl:
      'https://www.facebook.com/groups/1000832851236530/permalink/1849299173056556/',
    groupId: '1000832851236530',
    groupName: '1000832851236530',
    fbUserId: '1269267869',
    userName: 'Nguyễn Minh Đức',
    userUrl: 'https://www.facebook.com/profile.php?id=1269267869',
    phone: '0913003917',
    thesame: 'ukUgxIrJL5aiGCIbBfDu',
    createdTime: '2026-10-25T12:01:33+0000',
    scannedAt: 1792929939923,
    keyword: buildPostKeyword({
      postMessage:
        '🔥 49,5 TỶ SỞ HỮU BIỆT THỰ LÔ GÓC HÀM NGHI – 131M², 6 TẦNG, MẶT TIỀN 6M – VỈA HÈ 6M, 3 Ô TÔ TRÁNH NHAU! 🔥',
      phone: '0913003917',
      userName: 'Nguyễn Minh Đức',
      groupName: '1000832851236530',
    }),
  });
}

function removeOldDbFiles() {
  for (const file of ['localserver.db', 'localserver.db-shm', 'localserver.db-wal']) {
    const full = path.join(DATA_DIR, file);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
}

async function ensureColumn(table, column, definition) {
  const [rows] = await sequelize.query(`PRAGMA table_info(${table})`);
  const exists = rows.some((row) => row.name === column);
  if (exists) return;
  await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`Added column ${table}.${column}`);
}

async function ensureIndex(name, sql) {
  const [rows] = await sequelize.query(
    `SELECT name FROM sqlite_master WHERE type='index' AND name = ?`,
    { replacements: [name] }
  );
  if (rows.length) return;
  await sequelize.query(sql);
  console.log(`Added index ${name}`);
}

async function cleanupBackupTables() {
  const [rows] = await sequelize.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_backup'`
  );
  for (const row of rows) {
    await sequelize.query(`DROP TABLE IF EXISTS \`${row.name}\``);
  }
}

async function safeSync({ force }) {
  // SQLite + alter thường gây FOREIGN KEY constraint failed.
  await sequelize.query('PRAGMA foreign_keys = OFF');
  try {
    if (force) {
      await sequelize.sync({ force: true });
      return;
    }

    await User.sync();
    await Session.sync();
    await Post.sync();
    await Group.sync();
    await Campaign.sync();
    await CampaignPhone.sync();
    await KeywordFilter.sync();
    await AppSetting.sync();
    await ApiKey.sync();
    await ActivityLog.sync();

    await ensureColumn('users', 'locked', 'TINYINT(1) NOT NULL DEFAULT 0');
    await ensureColumn('sessions', 'jti', 'VARCHAR(64)');
    await ensureIndex(
      'sessions_jti_unique',
      'CREATE UNIQUE INDEX `sessions_jti_unique` ON `sessions` (`jti`)'
    );
    await ensureColumn('posts', 'keyword', 'TEXT');
    await ensureColumn('groups', 'note', 'TEXT');
    await ensureColumn('groups', 'status', "VARCHAR(32) NOT NULL DEFAULT 'pending'");
    await ensureColumn('groups', 'scanned_at', 'BIGINT');
    await ensureColumn('groups', 'claimed_at', 'BIGINT');
    await ensureColumn('groups', 'claimed_by', 'VARCHAR(64)');
    await ensureColumn('groups', 'available_at', 'BIGINT');
    await ensureColumn('groups', 'last_stop_reason', 'VARCHAR(64)');
    await ensureColumn('campaigns', 'note', 'TEXT');
    await ensureColumn('campaigns', 'status', "VARCHAR(32) NOT NULL DEFAULT 'active'");
    await ensureColumn('campaign_phones', 'note', 'TEXT');
    await ensureColumn('campaign_phones', 'step_add', 'VARCHAR(20)');
    await ensureColumn('campaign_phones', 'post_id', 'VARCHAR(128)');
    await ensureColumn('campaign_phones', 'post_message', 'TEXT');
    await ensureColumn('campaign_phones', 'post_url', 'TEXT');
    await ensureColumn('campaign_phones', 'group_id', 'VARCHAR(64)');
    await ensureColumn('campaign_phones', 'group_name', 'VARCHAR(255)');
    await ensureColumn('campaign_phones', 'fb_user_id', 'VARCHAR(64)');
    await ensureColumn('campaign_phones', 'user_name', 'VARCHAR(255)');
    await ensureColumn('campaign_phones', 'user_url', 'TEXT');
    await ensureColumn('campaign_phones', 'thesame', 'VARCHAR(64)');
    await ensureColumn('campaign_phones', 'created_time', 'VARCHAR(64)');
    await ensureColumn('campaign_phones', 'scanned_at', 'BIGINT');
    await ensureColumn('campaign_phones', 'keyword', 'TEXT');
    await ensureColumn('campaign_phones', 'is_used', 'TINYINT(1) NOT NULL DEFAULT 0');
    await ensureIndex(
      'campaign_phones_step_add_idx',
      'CREATE INDEX `campaign_phones_step_add_idx` ON `campaign_phones` (`step_add`)'
    );
    await cleanupBackupTables();
  } finally {
    await sequelize.query('PRAGMA foreign_keys = ON');
  }
}

async function backfillPostKeywords(PostModel) {
  const rows = await PostModel.findAll({
    attributes: ['id', 'postMessage', 'keyword'],
  });
  const updates = [];
  for (const row of rows) {
    const next = buildPostKeyword({ postMessage: row.postMessage });
    if (row.keyword !== next) updates.push({ id: row.id, keyword: next });
  }
  if (!updates.length) return;

  const db = PostModel.sequelize;
  await db.transaction(async (transaction) => {
    for (const item of updates) {
      await PostModel.update(
        { keyword: item.keyword },
        { where: { id: item.id }, transaction }
      );
    }
  });
  console.log(`Updated post keywords from message only: ${updates.length}`);
}

async function initDatabase({ force } = {}) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const markerPath = path.join(DATA_DIR, '.sequelize');
  const shouldForce = typeof force === 'boolean' ? force : !fs.existsSync(markerPath);

  if (shouldForce) {
    removeOldDbFiles();
  }

  sequelize = createSequelize();
  User = defineUser(sequelize);
  Session = defineSession(sequelize);
  Post = definePost(sequelize);
  Group = defineGroup(sequelize);
  Campaign = defineCampaign(sequelize);
  CampaignPhone = defineCampaignPhone(sequelize);
  KeywordFilter = defineKeywordFilter(sequelize);
  AppSetting = defineAppSetting(sequelize);
  ApiKey = defineApiKey(sequelize);
  ActivityLog = defineActivityLog(sequelize);
  associateModels({
    User,
    Session,
    Post,
    Group,
    Campaign,
    CampaignPhone,
    KeywordFilter,
    AppSetting,
    ApiKey,
    ActivityLog,
  });

  await sequelize.authenticate();
  await safeSync({ force: shouldForce });
  await seedAdmin(User);
  await seedSamplePost(Post);
  await backfillPostKeywords(Post);

  if (shouldForce) {
    fs.writeFileSync(markerPath, new Date().toISOString());
    console.log('Sequelize tables recreated:', DB_PATH);
  }

  return {
    sequelize,
    User,
    Session,
    Post,
    Group,
    Campaign,
    CampaignPhone,
    KeywordFilter,
    AppSetting,
    ApiKey,
    ActivityLog,
    async close() {
      if (sequelize) {
        await sequelize.close();
        sequelize = null;
      }
    },
  };
}

function getModels() {
  if (
    !User ||
    !Session ||
    !Post ||
    !Group ||
    !Campaign ||
    !CampaignPhone ||
    !KeywordFilter ||
    !AppSetting ||
    !ApiKey ||
    !ActivityLog
  ) {
    throw new Error('Database chưa được khởi tạo. Gọi initDatabase() trước.');
  }
  return {
    sequelize,
    User,
    Session,
    Post,
    Group,
    Campaign,
    CampaignPhone,
    KeywordFilter,
    AppSetting,
    ApiKey,
    ActivityLog,
  };
}

module.exports = {
  initDatabase,
  getModels,
  DB_PATH,
};
