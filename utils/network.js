const os = require('os');

function getLocalIPv4() {
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      const family = net.family === 'IPv4' || net.family === 4;
      if (family && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

function getLocalWebUrl(port) {
  return `http://${getLocalIPv4()}:${port}`;
}

module.exports = { getLocalIPv4, getLocalWebUrl };
