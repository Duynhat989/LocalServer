const FTS_TABLE = 'post_keyword_fts';
const INDEXED_TABLE = 'post_keyword_indexed';
const MYSQL_FT_INDEX = 'posts_keyword_fulltext';

async function ensureSqlitePostKeywordIndex(sequelize) {
  await sequelize.query(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(
      keyword,
      content='posts',
      content_rowid='id',
      tokenize='trigram'
    )
  `);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${INDEXED_TABLE} (
      post_id INTEGER PRIMARY KEY
    )
  `);

  await sequelize.query(`
    CREATE TRIGGER IF NOT EXISTS posts_keyword_ai
    AFTER INSERT ON posts
    BEGIN
      INSERT INTO ${FTS_TABLE}(rowid, keyword) VALUES (new.id, IFNULL(new.keyword, ''));
      INSERT OR IGNORE INTO ${INDEXED_TABLE}(post_id) VALUES (new.id);
    END
  `);
  await sequelize.query(`
    CREATE TRIGGER IF NOT EXISTS posts_keyword_ad
    AFTER DELETE ON posts
    BEGIN
      INSERT INTO ${FTS_TABLE}(${FTS_TABLE}, rowid, keyword)
      VALUES ('delete', old.id, IFNULL(old.keyword, ''));
      DELETE FROM ${INDEXED_TABLE} WHERE post_id = old.id;
    END
  `);
  await sequelize.query(`
    CREATE TRIGGER IF NOT EXISTS posts_keyword_au
    AFTER UPDATE OF keyword ON posts
    BEGIN
      INSERT INTO ${FTS_TABLE}(${FTS_TABLE}, rowid, keyword)
      VALUES ('delete', old.id, IFNULL(old.keyword, ''));
      INSERT INTO ${FTS_TABLE}(rowid, keyword) VALUES (new.id, IFNULL(new.keyword, ''));
      INSERT OR IGNORE INTO ${INDEXED_TABLE}(post_id) VALUES (new.id);
    END
  `);

  const [countRows] = await sequelize.query(`
    SELECT COUNT(*) AS missing
    FROM posts p
    LEFT JOIN ${INDEXED_TABLE} i ON i.post_id = p.id
    WHERE i.post_id IS NULL
  `);
  const missing = Number(countRows[0]?.missing) || 0;
  if (!missing) {
    console.log('Bảng tìm kiếm đã có đủ bài viết');
    return;
  }

  await sequelize.query(`
    INSERT INTO ${FTS_TABLE}(rowid, keyword)
    SELECT p.id, IFNULL(p.keyword, '')
    FROM posts p
    LEFT JOIN ${INDEXED_TABLE} i ON i.post_id = p.id
    WHERE i.post_id IS NULL
  `);
  await sequelize.query(`
    INSERT INTO ${INDEXED_TABLE}(post_id)
    SELECT p.id
    FROM posts p
    LEFT JOIN ${INDEXED_TABLE} i ON i.post_id = p.id
    WHERE i.post_id IS NULL
  `);
  console.log(`Đã đưa ${missing} bài vào bảng tìm kiếm`);
}

async function mysqlIndexExists(sequelize, indexName) {
  const [rows] = await sequelize.query(
    `SELECT 1 AS ok FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'posts' AND index_name = ?
     LIMIT 1`,
    { replacements: [indexName] }
  );
  return rows.length > 0;
}

async function ensureMysqlPostKeywordIndex(sequelize) {
  if (await mysqlIndexExists(sequelize, MYSQL_FT_INDEX)) {
    console.log('MySQL FULLTEXT keyword đã có');
    return;
  }
  try {
    await sequelize.query(
      `ALTER TABLE posts ADD FULLTEXT INDEX \`${MYSQL_FT_INDEX}\` (\`keyword\`) WITH PARSER ngram`
    );
    console.log('Đã tạo FULLTEXT ngram trên posts.keyword');
  } catch (err) {
    console.warn('FULLTEXT ngram không khả dụng, dùng FULLTEXT mặc định:', err.message || err);
    try {
      await sequelize.query(
        `ALTER TABLE posts ADD FULLTEXT INDEX \`${MYSQL_FT_INDEX}\` (\`keyword\`)`
      );
      console.log('Đã tạo FULLTEXT trên posts.keyword');
    } catch (err2) {
      console.warn(
        'Bỏ qua tạo FULLTEXT (có thể thiếu dung lượng đĩa / bảng posts đầy):',
        err2.message || err2
      );
    }
  }
}

async function ensurePostKeywordIndex(sequelize) {
  const dialect = sequelize.getDialect();
  if (dialect === 'mysql') {
    return ensureMysqlPostKeywordIndex(sequelize);
  }
  return ensureSqlitePostKeywordIndex(sequelize);
}

module.exports = { ensurePostKeywordIndex };
