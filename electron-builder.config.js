const fs = require('fs');
const path = require('path');

const binding = path.join(__dirname, 'node_modules/sqlite3/build/Release/node_sqlite3.node');
const cacheDir = path.join(__dirname, 'native/sqlite3');
const hostBinary = path.join(cacheDir, `darwin-${process.arch}.node`);

function archName(arch) {
  if (arch === 3 || arch === 'arm64') return 'arm64';
  return 'x64';
}

function binaryFor(platform, arch) {
  return path.join(cacheDir, `${platform}-${archName(arch)}.node`);
}

module.exports = {
  appId: 'com.bdshanoi.localserver',
  productName: 'LocalServer',
  directories: {
    output: 'dist',
  },
  files: ['**/*', '!data/**', '!dist/**', '!client/**', '!native/**'],
  asarUnpack: ['**/node_modules/sqlite3/**'],
  npmRebuild: false,
  buildDependenciesFromSource: false,
  beforePack(context) {
    const src = binaryFor(context.electronPlatformName, context.arch);
    if (!fs.existsSync(src)) {
      throw new Error(`Thiếu file sqlite cho ${context.electronPlatformName}: ${src}`);
    }
    fs.copyFileSync(src, binding);
  },
  afterPack() {
    if (fs.existsSync(hostBinary)) fs.copyFileSync(hostBinary, binding);
  },
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }],
    icon: 'assets/logo.png',
    category: 'public.app-category.utilities',
    identity: '-',
  },
  win: {
    target: [{ target: 'portable', arch: ['x64'] }],
    icon: 'assets/logo.png',
  },
};
