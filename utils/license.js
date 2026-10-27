const ACTIVATION_TOKEN =
  'b358c366ee61a0dda87b0b97ea7c86234309e57dcf1a648f5ee6dfdede34796e';

const SHEET_ID = '1FRSXKdrk_hytoazJIkwxQWvSlK8K0zT2BTCZAKzBpxs';

const SHEET_FETCH_URLS = [
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`,
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`,
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/pub?output=csv`,
];

const FETCH_TIMEOUT_MS = 15000;

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 LocalServerLicense/1.0',
        Accept: 'text/csv,text/plain,*/*',
      },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text: String(text || '') };
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeLoginOrBlocked(text) {
  const sample = String(text || '').slice(0, 4000).toLowerCase();
  return (
    sample.includes('accounts.google.com') ||
    sample.includes('sign in') ||
    sample.includes('đăng nhập') ||
    sample.includes('request-storage-access') ||
    sample.includes('<!doctype html')
  );
}

/**
 * Kiểm tra mã kích hoạt có trong Google Sheet hay không.
 * Sheet cần chia sẻ "Anyone with the link can view" để export CSV được.
 */
async function checkLicense() {
  const checkedAt = new Date().toISOString();
  let lastError = null;
  let sawContent = false;

  for (const url of SHEET_FETCH_URLS) {
    try {
      const { ok, status, text } = await fetchText(url);
      if (!ok || !text) {
        lastError = `HTTP ${status || 'error'}`;
        continue;
      }
      if (looksLikeLoginOrBlocked(text)) {
        lastError = 'license_source_unavailable';
        continue;
      }
      sawContent = true;
      if (text.includes(ACTIVATION_TOKEN)) {
        return {
          activated: true,
          checkedAt,
          token: ACTIVATION_TOKEN,
          sheetId: SHEET_ID,
          error: null,
        };
      }
    } catch (err) {
      lastError = err.name === 'AbortError' ? 'Hết thời gian chờ' : err.message || String(err);
    }
  }

  return {
    activated: false,
    checkedAt,
    token: ACTIVATION_TOKEN,
    sheetId: SHEET_ID,
    error: sawContent ? null : lastError || 'license_check_failed',
  };
}

module.exports = {
  ACTIVATION_TOKEN,
  SHEET_ID,
  checkLicense,
};
