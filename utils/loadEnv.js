const path = require('path');

let loaded = false;

function loadEnv() {
  if (loaded) return;
  loaded = true;
  try {
    require('dotenv').config({
      path: path.join(__dirname, '..', '.env'),
    });
  } catch (_) {
    /* dotenv optional until installed */
  }
}

module.exports = { loadEnv };
