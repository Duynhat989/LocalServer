const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const binding = path.join(root, 'node_modules/sqlite3/build/Release/node_sqlite3.node');
const outDir = path.join(root, 'native/sqlite3');
const darwinOut = path.join(outDir, `darwin-${process.arch}.node`);
const winOut = path.join(outDir, 'win32-x64.node');

fs.mkdirSync(path.dirname(binding), { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

execSync('npx electron-rebuild -f -w sqlite3', { cwd: root, stdio: 'inherit' });
fs.copyFileSync(binding, darwinOut);

execSync('node ../prebuild-install/bin.js -r napi --platform win32 --arch x64', {
  cwd: path.join(root, 'node_modules/sqlite3'),
  stdio: 'inherit',
});
fs.copyFileSync(binding, winOut);
fs.copyFileSync(darwinOut, binding);

console.log('sqlite ready:', darwinOut);
console.log('sqlite ready:', winOut);
