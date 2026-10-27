const { getModels } = require('../models');
const {
  DEFAULT_SCAN_SETTINGS,
  normalizeScanSettings,
  parseJson,
} = require('../utils/settings');

const SCAN_KEY = 'scan';

async function getScanSettingsRow(AppSetting) {
  const row = await AppSetting.findByPk(SCAN_KEY);
  const parsed = parseJson(row?.value, {});
  return normalizeScanSettings(parsed);
}

async function getScanSettings(req, res, next) {
  try {
    const { AppSetting } = getModels();
    const settings = await getScanSettingsRow(AppSetting);
    res.json({ ok: true, settings });
  } catch (err) {
    next(err);
  }
}

async function updateScanSettings(req, res) {
  try {
    const { AppSetting } = getModels();
    const current = await getScanSettingsRow(AppSetting);
    const settings = normalizeScanSettings({ ...current, ...req.body });
    await AppSetting.upsert({
      key: SCAN_KEY,
      value: JSON.stringify(settings),
    });
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không lưu được cài đặt' });
  }
}

module.exports = {
  SCAN_KEY,
  DEFAULT_SCAN_SETTINGS,
  getScanSettingsRow,
  getScanSettings,
  updateScanSettings,
};
