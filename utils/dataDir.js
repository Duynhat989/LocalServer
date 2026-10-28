const fs = require('fs');
const path = require('path');

const PROJECT_DATA_DIR = path.join(__dirname, '..', 'data');

function appDataDir() {
  const { app } = require('electron');
  if (app && typeof app.setName === 'function') {
    app.setName('LocalServer');
  }
  return path.join(app.getPath('userData'), 'data');
}

function copyIfMissing(from, to) {
  if (!fs.existsSync(from) || fs.existsSync(to)) return;
  fs.copyFileSync(from, to);
}

function migrateProjectData(targetDir) {
  const sourceDb = path.join(PROJECT_DATA_DIR, 'localserver.db');
  const targetDb = path.join(targetDir, 'localserver.db');
  if (!fs.existsSync(sourceDb) || fs.existsSync(targetDb)) return;

  fs.mkdirSync(targetDir, { recursive: true });
  for (const name of [
    'localserver.db',
    'localserver.db-shm',
    'localserver.db-wal',
    '.jwt_secret',
    '.sequelize',
  ]) {
    copyIfMissing(path.join(PROJECT_DATA_DIR, name), path.join(targetDir, name));
  }
  console.log('Copied existing database to', targetDir);
}

function getDataDir() {
  try {
    const dir = appDataDir();
    migrateProjectData(dir);
    return dir;
  } catch (_) {
    return PROJECT_DATA_DIR;
  }
}

module.exports = { getDataDir };
