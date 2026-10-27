const express = require('express');
const http = require('http');
const path = require('path');
const { initDatabase } = require('./models');
const apiRoutes = require('./routes');
const authController = require('./controllers/authController');
const { getLocalWebUrl } = require('./utils/network');
const {
  startGroupAvailabilityCron,
  stopGroupAvailabilityCron,
} = require('./jobs/groupAvailability');

const PORT = 6868;

async function createServer() {
  const app = express();
  const db = await initDatabase();

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', port: PORT });
  });

  app.use('/api', apiRoutes);

  app.use(express.static(path.join(__dirname, 'views')));

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Lỗi máy chủ' });
  });

  const server = http.createServer(app);

  return {
    app,
    server,
    port: PORT,
    async getReport() {
      return authController.getStats();
    },
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(PORT, '0.0.0.0', () => {
          server.removeListener('error', reject);
          startGroupAvailabilityCron();
          resolve({ port: PORT, url: getLocalWebUrl(PORT) });
        });
      });
    },
    async stop() {
      stopGroupAvailabilityCron();
      try {
        await db.close();
      } catch (_) {
        /* ignore */
      }
      if (!server.listening) return;
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

module.exports = { createServer, PORT };
