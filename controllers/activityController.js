const { getModels } = require('../models');
const { recordActivity, toPublicActivity } = require('../utils/activityLog');

const TYPES = new Set(['login', 'excel', 'campaign_phone', 'filter']);
const PAGE_SIZE_MAX = 100;

function parsePage(query) {
  const limit = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(query.limit) || 40)
  );
  const offset = Math.max(0, Number(query.offset) || 0);
  return { limit, offset };
}

async function listActivity(req, res, next) {
  try {
    const { ActivityLog } = getModels();
    const { limit, offset } = parsePage(req.query);
    const type = String(req.query.type || '').trim();
    const where = TYPES.has(type) ? { type } : {};

    const { rows, count } = await ActivityLog.findAndCountAll({
      where,
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
    });

    res.json({
      ok: true,
      logs: rows.map(toPublicActivity),
      total: count,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
}

async function logExcelExport(req, res, next) {
  try {
    const campaignId = Number(req.body?.campaignId);
    const campaignName = String(req.body?.campaignName || '').trim().slice(0, 180);
    const count = Math.max(0, Math.floor(Number(req.body?.count) || 0));
    const marked = Math.max(0, Math.floor(Number(req.body?.marked) || 0));
    const selected = Boolean(req.body?.selected);
    const filename = String(req.body?.filename || '').trim().slice(0, 180);
    const phones = (Array.isArray(req.body?.phones) ? req.body.phones : [])
      .slice(0, 300)
      .map((item) => ({
        phone: String(item?.phone || '').trim(),
        userName: String(item?.userName || '').trim().slice(0, 120),
        groupName: String(item?.groupName || '').trim().slice(0, 160),
        isUsed: Boolean(item?.isUsed),
      }))
      .filter((item) => item.phone);

    if (!campaignName && !Number.isFinite(campaignId)) {
      return res.status(400).json({ ok: false, error: 'Thiếu chiến dịch' });
    }
    if (!count) {
      return res.status(400).json({ ok: false, error: 'Không có dòng để ghi lịch sử' });
    }

    const name = campaignName || `Chiến dịch #${campaignId}`;
    const scope = selected ? 'SĐT đã chọn' : 'theo bộ lọc';
    const markedText = marked ? ` · đánh dấu đã lấy ${marked}` : '';
    await recordActivity({
      type: 'excel',
      action: 'export',
      userId: req.user.id,
      username: req.user.username,
      summary: `Xuất Excel “${name}” · ${count} SĐT (${scope})${markedText}`,
      detail: {
        campaignId: Number.isFinite(campaignId) ? campaignId : null,
        campaignName: name,
        count,
        marked,
        selected,
        filename: filename || null,
        phones,
      },
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listActivity,
  logExcelExport,
};
