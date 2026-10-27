const { Op } = require('sequelize');
const { getModels } = require('../models');
const { recordActivity } = require('../utils/activityLog');
const {
  toPublicCampaign,
  toPublicCampaignPhone,
  normalizeCampaignInput,
  normalizePhoneList,
  normalizePhone,
  generateStepAdd,
} = require('../utils/campaign');

const PHONE_LIMIT_DEFAULT = 100;
const PHONE_LIMIT_MAX = 10000;

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function parsePhonePagination(query = {}) {
  let limit = Number(query.limit);
  if (!Number.isFinite(limit) || limit < 1) limit = PHONE_LIMIT_DEFAULT;
  limit = Math.min(PHONE_LIMIT_MAX, Math.floor(limit));
  let offset = Number(query.offset);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.floor(offset);
  return { limit, offset };
}

async function getCampaignCounts(CampaignPhone, campaignId) {
  const phoneCount = await CampaignPhone.count({ where: { campaignId } });
  const unusedCount = await CampaignPhone.count({
    where: { campaignId, isUsed: false },
  });
  return { phoneCount, unusedCount };
}

function buildCampaignPhoneWhere(campaignId, query = {}) {
  const where = { campaignId };
  const used = String(query.used || query.isUsed || 'all').trim().toLowerCase();
  if (used === 'unused' || used === '0' || used === 'false') {
    where.isUsed = false;
  } else if (used === 'used' || used === '1' || used === 'true') {
    where.isUsed = true;
  }

  const q = String(query.q || query.search || '').trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    where[Op.or] = [
      { phone: { [Op.like]: like } },
      { userName: { [Op.like]: like } },
      { stepAdd: { [Op.like]: like } },
      { groupName: { [Op.like]: like } },
      { postId: { [Op.like]: like } },
    ];
  }
  return where;
}

async function listCampaigns(req, res, next) {
  try {
    const { Campaign, CampaignPhone } = getModels();
    const rows = await Campaign.findAll({
      include: [{ model: CampaignPhone, as: 'phones', attributes: ['id', 'isUsed'] }],
      order: [['id', 'DESC']],
    });

    res.json({
      ok: true,
      campaigns: rows.map((row) => {
        const phones = row.phones || [];
        const unusedCount = phones.filter((p) => !p.isUsed).length;
        return toPublicCampaign(row, phones.length, unusedCount);
      }),
    });
  } catch (err) {
    next(err);
  }
}

async function getCampaign(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }

    const { Campaign, CampaignPhone } = getModels();
    const campaign = await Campaign.findByPk(id);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy chiến dịch' });
    }

    const { phoneCount, unusedCount } = await getCampaignCounts(CampaignPhone, id);
    res.json({
      ok: true,
      campaign: toPublicCampaign(campaign, phoneCount, unusedCount),
    });
  } catch (err) {
    next(err);
  }
}

async function listCampaignPhones(req, res, next) {
  try {
    const campaignId = Number(req.params.id);
    if (!Number.isFinite(campaignId)) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }

    const { Campaign, CampaignPhone } = getModels();
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy chiến dịch' });
    }

    const { limit, offset } = parsePhonePagination(req.query);
    const where = buildCampaignPhoneWhere(campaignId, req.query);
    const { count, rows } = await CampaignPhone.findAndCountAll({
      where,
      order: [['id', 'DESC']],
      limit,
      offset,
    });
    const { phoneCount, unusedCount } = await getCampaignCounts(CampaignPhone, campaignId);

    res.json({
      ok: true,
      phones: rows.map(toPublicCampaignPhone),
      total: count,
      limit,
      offset,
      page: Math.floor(offset / limit) + 1,
      totalPages: Math.max(1, Math.ceil(count / limit) || 1),
      campaign: toPublicCampaign(campaign, phoneCount, unusedCount),
      filters: {
        q: String(req.query.q || req.query.search || '').trim() || null,
        used: String(req.query.used || req.query.isUsed || 'all').trim().toLowerCase() || 'all',
      },
    });
  } catch (err) {
    next(err);
  }
}

async function listCampaignSteps(req, res, next) {
  try {
    const campaignId = Number(req.params.id);
    if (!Number.isFinite(campaignId)) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }

    const { Campaign, CampaignPhone } = getModels();
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy chiến dịch' });
    }

    const rows = await CampaignPhone.findAll({
      where: { campaignId },
      attributes: ['phone', 'userName', 'stepAdd', 'created_at'],
      order: [['id', 'DESC']],
    });

    const map = new Map();
    for (const row of rows) {
      const json = typeof row.toJSON === 'function' ? row.toJSON() : row;
      const stepAdd = String(json.stepAdd || json.step_add || '').trim();
      const label = stepAdd || '(không có step_add)';
      if (!map.has(label)) {
        map.set(label, {
          stepAdd,
          label,
          count: 0,
          createdAt: json.created_at || json.createdAt || null,
          phones: [],
          userNames: new Set(),
        });
      }
      const batch = map.get(label);
      batch.count += 1;
      batch.phones.push(json.phone);
      if (json.userName || json.user_name) {
        batch.userNames.add(json.userName || json.user_name);
      }
      const createdAt = json.created_at || json.createdAt || null;
      if (createdAt && (!batch.createdAt || String(createdAt) > String(batch.createdAt))) {
        batch.createdAt = createdAt;
      }
    }

    const steps = Array.from(map.values())
      .map((batch) => ({
        stepAdd: batch.stepAdd,
        label: batch.label,
        count: batch.count,
        createdAt: batch.createdAt,
        userNames: Array.from(batch.userNames),
        previewPhones: batch.phones.slice(0, 5),
        canUndo: Boolean(batch.stepAdd),
      }))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    res.json({ ok: true, steps });
  } catch (err) {
    next(err);
  }
}

async function createCampaign(req, res) {
  try {
    const payload = normalizeCampaignInput(req.body);
    if (!payload.name) {
      return res.status(400).json({ ok: false, error: 'Thiếu tên chiến dịch' });
    }

    const { Campaign } = getModels();
    const campaign = await Campaign.create(payload);
    res.status(201).json({ ok: true, campaign: toPublicCampaign(campaign, 0) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không tạo được chiến dịch' });
  }
}

async function updateCampaign(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }

    const { Campaign, CampaignPhone } = getModels();
    const campaign = await Campaign.findByPk(id);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy chiến dịch' });
    }

    const payload = normalizeCampaignInput({
      name: req.body.name != null ? req.body.name : campaign.name,
      status: req.body.status != null ? req.body.status : campaign.status,
      note: req.body.note != null ? req.body.note : campaign.note,
    });
    if (!payload.name) {
      return res.status(400).json({ ok: false, error: 'Thiếu tên chiến dịch' });
    }

    await campaign.update(payload);
    const phoneCount = await CampaignPhone.count({ where: { campaignId: id } });
    res.json({ ok: true, campaign: toPublicCampaign(campaign, phoneCount) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không cập nhật được chiến dịch' });
  }
}

async function addPhones(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }

    const items = normalizePhoneList(req.body);
    if (!items.length) {
      return res.status(400).json({ ok: false, error: 'Thiếu số điện thoại' });
    }

    const { Campaign, CampaignPhone } = getModels();
    const campaign = await Campaign.findByPk(id);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy chiến dịch' });
    }

    const stepAdd = generateStepAdd(20);
    let added = 0;
    const duplicates = [];
    const created = [];

    for (const item of items) {
      const existed = await CampaignPhone.findOne({
        where: { campaignId: id, phone: item.phone },
      });
      if (existed) {
        duplicates.push(item.phone);
        continue;
      }
      try {
        const row = await CampaignPhone.create({
          campaignId: id,
          phone: item.phone,
          stepAdd,
          postId: item.postId,
          postMessage: item.postMessage,
          postUrl: item.postUrl,
          groupId: item.groupId,
          groupName: item.groupName,
          fbUserId: item.fbUserId,
          userName: item.userName,
          userUrl: item.userUrl,
          thesame: item.thesame,
          createdTime: item.createdTime,
          scannedAt: item.scannedAt,
          keyword: item.keyword,
          note: item.note,
          isUsed: false,
        });
        created.push(toPublicCampaignPhone(row));
        added += 1;
      } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError') {
          duplicates.push(item.phone);
          continue;
        }
        throw err;
      }
    }

    const { phoneCount, unusedCount } = await getCampaignCounts(CampaignPhone, id);

    const dupCount = duplicates.length;
    const dupText = dupCount ? ` · ${dupCount} số đã có` : '';
    await recordActivity({
      type: 'campaign_phone',
      action: 'add',
      userId: req.user?.id,
      username: req.user?.username,
      summary: `Chuyển ${added} SĐT vào “${campaign.name}”${dupText}`,
      detail: {
        campaignId: id,
        campaignName: campaign.name,
        added,
        duplicates: dupCount,
        phones: created.slice(0, 200).map((row) => ({
          phone: row.phone,
          userName: row.userName || '',
          groupName: row.groupName || '',
        })),
        duplicatePhones: duplicates.slice(0, 80),
      },
    });

    res.status(added ? 201 : 200).json({
      ok: true,
      added,
      duplicates,
      stepAdd: added ? stepAdd : null,
      created,
      campaign: toPublicCampaign(campaign, phoneCount, unusedCount),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không thêm được SĐT' });
  }
}

async function removePhone(req, res) {
  try {
    const campaignId = Number(req.params.id);
    const phoneId = Number(req.params.phoneId);
    if (!Number.isFinite(campaignId) || !Number.isFinite(phoneId)) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }

    const { Campaign, CampaignPhone } = getModels();
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy chiến dịch' });
    }

    const row = await CampaignPhone.findOne({ where: { id: phoneId, campaignId } });
    if (!row) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy SĐT' });
    }

    await row.destroy();
    const { phoneCount, unusedCount } = await getCampaignCounts(CampaignPhone, campaignId);
    res.json({
      ok: true,
      campaign: toPublicCampaign(campaign, phoneCount, unusedCount),
      removedPhone: normalizePhone(row.phone),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không xóa được SĐT' });
  }
}

async function markPhoneUsed(req, res) {
  try {
    const campaignId = Number(req.params.id);
    const phoneId = Number(req.params.phoneId);
    if (!Number.isFinite(campaignId) || !Number.isFinite(phoneId)) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }

    const { Campaign, CampaignPhone } = getModels();
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy chiến dịch' });
    }

    const row = await CampaignPhone.findOne({ where: { id: phoneId, campaignId } });
    if (!row) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy SĐT' });
    }

    if (row.isUsed) {
      return res.status(409).json({
        ok: false,
        error: 'SĐT này đã được lấy rồi',
        phone: toPublicCampaignPhone(row),
      });
    }

    await row.update({ isUsed: true });
    const { phoneCount, unusedCount } = await getCampaignCounts(CampaignPhone, campaignId);

    res.json({
      ok: true,
      phone: toPublicCampaignPhone(row),
      campaign: toPublicCampaign(campaign, phoneCount, unusedCount),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không đánh dấu được SĐT' });
  }
}

async function markPhonesUsed(req, res) {
  try {
    const campaignId = Number(req.params.id);
    if (!Number.isFinite(campaignId)) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }

    const rawIds = Array.isArray(req.body?.ids)
      ? req.body.ids
      : Array.isArray(req.body?.phoneIds)
        ? req.body.phoneIds
        : [];
    const ids = [
      ...new Set(
        rawIds
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
      ),
    ];
    if (!ids.length) {
      return res.status(400).json({ ok: false, error: 'Thiếu danh sách SĐT' });
    }

    const { Campaign, CampaignPhone } = getModels();
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy chiến dịch' });
    }

    const [updated] = await CampaignPhone.update(
      { isUsed: true },
      {
        where: {
          campaignId,
          id: { [Op.in]: ids },
          isUsed: false,
        },
      }
    );

    const { phoneCount, unusedCount } = await getCampaignCounts(CampaignPhone, campaignId);

    res.json({
      ok: true,
      updated,
      campaign: toPublicCampaign(campaign, phoneCount, unusedCount),
      message: updated
        ? `Đã đánh dấu đã lấy ${updated} SĐT`
        : 'Không có SĐT nào cần đánh dấu',
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không đánh dấu được SĐT' });
  }
}

async function undoStepAdd(req, res) {
  try {
    const campaignId = Number(req.params.id);
    const stepAdd = String(req.params.stepAdd || '').trim();
    if (!Number.isFinite(campaignId) || !stepAdd) {
      return res.status(400).json({ ok: false, error: 'ID / step_add không hợp lệ' });
    }

    const { Campaign, CampaignPhone } = getModels();
    const campaign = await Campaign.findByPk(campaignId);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy chiến dịch' });
    }

    const removed = await CampaignPhone.destroy({
      where: { campaignId, stepAdd },
    });
    if (!removed) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy đợt thêm này' });
    }

    const { phoneCount, unusedCount } = await getCampaignCounts(CampaignPhone, campaignId);

    res.json({
      ok: true,
      removed,
      stepAdd,
      campaign: toPublicCampaign(campaign, phoneCount, unusedCount),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không hoàn tác được đợt thêm' });
  }
}

module.exports = {
  listCampaigns,
  getCampaign,
  listCampaignPhones,
  listCampaignSteps,
  createCampaign,
  updateCampaign,
  addPhones,
  removePhone,
  markPhoneUsed,
  markPhonesUsed,
  undoStepAdd,
};
