const COOLDOWN_UNITS = ['day', 'month', 'year'];

const DEFAULT_SCAN_SETTINGS = {
  groupCooldownValue: 1,
  groupCooldownUnit: 'month',
  scanCutoffDate: '2023-01-01',
  duplicateStreakLimit: 5,
  claimTimeoutMinutes: 120,
  claimPollSeconds: 15,
};

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeScanSettings(input = {}) {
  const src = { ...DEFAULT_SCAN_SETTINGS, ...input };

  let groupCooldownValue = Math.floor(Number(src.groupCooldownValue));
  if (!Number.isFinite(groupCooldownValue) || groupCooldownValue < 0) {
    groupCooldownValue = DEFAULT_SCAN_SETTINGS.groupCooldownValue;
  }

  let groupCooldownUnit = String(src.groupCooldownUnit || 'month').toLowerCase();
  if (!COOLDOWN_UNITS.includes(groupCooldownUnit)) {
    groupCooldownUnit = DEFAULT_SCAN_SETTINGS.groupCooldownUnit;
  }

  let scanCutoffDate = String(src.scanCutoffDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scanCutoffDate)) {
    scanCutoffDate = DEFAULT_SCAN_SETTINGS.scanCutoffDate;
  }

  let duplicateStreakLimit = Math.floor(Number(src.duplicateStreakLimit));
  if (!Number.isFinite(duplicateStreakLimit) || duplicateStreakLimit < 1) {
    duplicateStreakLimit = DEFAULT_SCAN_SETTINGS.duplicateStreakLimit;
  }

  let claimTimeoutMinutes = Math.floor(Number(src.claimTimeoutMinutes));
  if (!Number.isFinite(claimTimeoutMinutes) || claimTimeoutMinutes < 5) {
    claimTimeoutMinutes = DEFAULT_SCAN_SETTINGS.claimTimeoutMinutes;
  }

  let claimPollSeconds = Math.floor(Number(src.claimPollSeconds));
  if (!Number.isFinite(claimPollSeconds) || claimPollSeconds < 3) {
    claimPollSeconds = DEFAULT_SCAN_SETTINGS.claimPollSeconds;
  }

  return {
    groupCooldownValue,
    groupCooldownUnit,
    scanCutoffDate,
    duplicateStreakLimit,
    claimTimeoutMinutes,
    claimPollSeconds,
  };
}

function addCooldownMs(fromMs, value, unit) {
  const date = new Date(fromMs);
  const amount = Math.max(0, Number(value) || 0);
  if (unit === 'year') date.setFullYear(date.getFullYear() + amount);
  else if (unit === 'month') date.setMonth(date.getMonth() + amount);
  else date.setDate(date.getDate() + amount);
  return date.getTime();
}

module.exports = {
  COOLDOWN_UNITS,
  DEFAULT_SCAN_SETTINGS,
  parseJson,
  normalizeScanSettings,
  addCooldownMs,
};
