const { loadEnv } = require('./loadEnv');

function isMysqlConfigured() {
  loadEnv();
  const host = String(process.env.DB_HOST || '').trim();
  const name = String(process.env.DB_NAME || '').trim();
  return Boolean(host && name);
}

function getMysqlConfig() {
  loadEnv();
  if (!isMysqlConfigured()) {
    throw new Error('Thiếu DB_HOST hoặc DB_NAME trong .env');
  }
  const port = Number(process.env.DB_PORT || 3306);
  return {
    host: String(process.env.DB_HOST).trim(),
    port: Number.isFinite(port) && port > 0 ? port : 3306,
    database: String(process.env.DB_NAME).trim(),
    username: String(process.env.DB_USER || 'root').trim(),
    password: process.env.DB_PASSWORD != null ? String(process.env.DB_PASSWORD) : '',
  };
}

function shouldResetDatabase() {
  loadEnv();
  return String(process.env.DB_RESET || '0').trim() === '1';
}

module.exports = {
  isMysqlConfigured,
  getMysqlConfig,
  shouldResetDatabase,
};
