const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { createServer, PORT } = require('./server');
const { getLocalWebUrl } = require('./utils/network');
const { checkLicense } = require('./utils/license');

let mainWindow = null;
let httpServer = null;
let licensePollTimer = null;
let licenseCheckBusy = false;

let licenseStatus = {
  activated: false,
  checking: true,
  checkedAt: null,
  nextCheckAt: null,
  error: null,
};

let serverStatus = {
  running: false,
  port: PORT,
  url: getLocalWebUrl(PORT),
  error: null,
  startedAt: null,
};

const LICENSE_POLL_WAITING_MS = 60 * 1000;
const LICENSE_POLL_ACTIVE_MS = 10 * 60 * 1000;

async function buildReport() {
  const empty = { userCount: 0, adminCount: 0, users: [] };
  let stats = empty;
  if (
    licenseStatus.activated &&
    httpServer &&
    typeof httpServer.getReport === 'function'
  ) {
    try {
      stats = await httpServer.getReport();
    } catch (_) {
      stats = empty;
    }
  }

  return {
    ...serverStatus,
    url: getLocalWebUrl(serverStatus.port || PORT),
    ...stats,
    license: {
      activated: Boolean(licenseStatus.activated),
      checking: Boolean(licenseStatus.checking),
      checkedAt: licenseStatus.checkedAt,
      nextCheckAt: licenseStatus.nextCheckAt,
      pollIntervalMs: licenseStatus.activated
        ? LICENSE_POLL_ACTIVE_MS
        : LICENSE_POLL_WAITING_MS,
      error: licenseStatus.error,
    },
  };
}

async function broadcastStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('server:status-changed', await buildReport());
  }
}

const APP_ICON = path.join(__dirname, 'assets', 'logo.png');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 540,
    minWidth: 520,
    minHeight: 420,
    title: 'LocalServer — Báo cáo',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startHttpServer() {
  if (httpServer) return;
  try {
    httpServer = await createServer();
    const info = await httpServer.start();
    serverStatus = {
      running: true,
      port: info.port,
      url: info.url,
      error: null,
      startedAt: new Date().toISOString(),
    };
    console.log(`HTTP server listening on ${info.url}`);
  } catch (err) {
    httpServer = null;
    serverStatus = {
      running: false,
      port: PORT,
      url: getLocalWebUrl(PORT),
      error: err.message || String(err),
      startedAt: null,
    };
    console.error('Failed to start HTTP server:', err);
  }
  await broadcastStatus();
}

async function stopHttpServer() {
  if (!httpServer) {
    serverStatus = {
      running: false,
      port: PORT,
      url: getLocalWebUrl(PORT),
      error: null,
      startedAt: null,
    };
    return;
  }
  const server = httpServer;
  httpServer = null;
  try {
    await server.stop();
  } catch (err) {
    console.error('Failed to stop HTTP server:', err);
  }
  serverStatus = {
    running: false,
    port: PORT,
    url: getLocalWebUrl(PORT),
    error: null,
    startedAt: null,
  };
}

async function applyLicenseResult(result) {
  const wasActivated = licenseStatus.activated;
  licenseStatus = {
    activated: Boolean(result.activated),
    checking: false,
    checkedAt: result.checkedAt || new Date().toISOString(),
    nextCheckAt: licenseStatus.nextCheckAt,
    error: result.error || null,
  };

  if (licenseStatus.activated && !wasActivated) {
    await startHttpServer();
  } else if (!licenseStatus.activated && wasActivated) {
    await stopHttpServer();
  } else if (licenseStatus.activated && !serverStatus.running) {
    await startHttpServer();
  }

  await broadcastStatus();
}

async function refreshLicense({ force = false } = {}) {
  if (licenseCheckBusy && !force) return licenseStatus;
  licenseCheckBusy = true;
  licenseStatus = { ...licenseStatus, checking: true };
  await broadcastStatus();

  try {
    const result = await checkLicense();
    await applyLicenseResult(result);
    return licenseStatus;
  } catch (err) {
    await applyLicenseResult({
      activated: false,
      checkedAt: new Date().toISOString(),
      error: err.message || 'Không kiểm tra được kích hoạt',
    });
    return licenseStatus;
  } finally {
    licenseCheckBusy = false;
  }
}

function scheduleLicensePoll() {
  if (licensePollTimer) {
    clearTimeout(licensePollTimer);
    licensePollTimer = null;
  }
  const delay = licenseStatus.activated
    ? LICENSE_POLL_ACTIVE_MS
    : LICENSE_POLL_WAITING_MS;
  licenseStatus = {
    ...licenseStatus,
    nextCheckAt: new Date(Date.now() + delay).toISOString(),
  };
  licensePollTimer = setTimeout(() => {
    refreshLicense()
      .catch(() => {})
      .finally(() => {
        scheduleLicensePoll();
      });
  }, delay);
  broadcastStatus().catch(() => {});
}

ipcMain.handle('server:status', () => buildReport());

ipcMain.handle('server:open-web', async () => {
  if (!licenseStatus.activated || !serverStatus.running) {
    return { ok: false, error: 'Ứng dụng đang chờ kích hoạt' };
  }
  const url = getLocalWebUrl(serverStatus.port || PORT);
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle('license:check', async () => {
  await refreshLicense({ force: true });
  scheduleLicensePoll();
  return buildReport();
});

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(APP_ICON);
  }

  createWindow();
  await refreshLicense({ force: true });
  scheduleLicensePoll();

  setInterval(() => {
    if (serverStatus.running) {
      broadcastStatus();
    }
  }, 3000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', async (event) => {
  if (licensePollTimer) {
    clearTimeout(licensePollTimer);
    licensePollTimer = null;
  }
  if (!httpServer) return;
  event.preventDefault();
  const server = httpServer;
  httpServer = null;
  await server.stop();
  app.exit(0);
});
