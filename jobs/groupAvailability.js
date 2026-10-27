const { Op } = require('sequelize');
const { getModels } = require('../models');

const INTERVAL_MS = 60 * 1000;

let timer = null;

/**
 * Nhóm đã hết cooldown (available_at <= now, status=done)
 * → chuyển về pending để extension claim được.
 */
async function reopenAvailableGroups() {
  const { Group } = getModels();
  const now = Date.now();
  const [count] = await Group.update(
    {
      status: 'pending',
      availableAt: null,
      claimedAt: null,
      claimedBy: null,
    },
    {
      where: {
        status: 'done',
        availableAt: { [Op.and]: [{ [Op.ne]: null }, { [Op.lte]: now }] },
      },
    }
  );
  if (count > 0) {
    console.log(`[cron] Đã mở lại ${count} nhóm hết cooldown → pending`);
  }
  return count;
}

function startGroupAvailabilityCron() {
  if (timer) return;
  reopenAvailableGroups().catch((err) => {
    console.error('[cron] reopenAvailableGroups lỗi:', err.message || err);
  });
  timer = setInterval(() => {
    reopenAvailableGroups().catch((err) => {
      console.error('[cron] reopenAvailableGroups lỗi:', err.message || err);
    });
  }, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  console.log('[cron] Group availability chạy mỗi 60s');
}

function stopGroupAvailabilityCron() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = {
  reopenAvailableGroups,
  startGroupAvailabilityCron,
  stopGroupAvailabilityCron,
};
