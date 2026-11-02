const { Op } = require('sequelize');
const { getModels } = require('../models');
const { toPublicGroup, normalizeGroupInput, GROUP_STATUSES, STOP_REASONS } = require('../utils/group');
const { getScanSettingsRow } = require('./settingsController');
const { addCooldownMs } = require('../utils/settings');

const GROUP_LIST_LIMITS = [20, 50, 100, 200];

function parseGroupPagination(query = {}) {
  let limit = Number(query.limit);
  if (!GROUP_LIST_LIMITS.includes(limit)) limit = 20;
  let offset = Number(query.offset);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  return { limit, offset: Math.floor(offset) };
}

function parseDateOnly(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function dayStartMs(dateOnly) {
  const ms = new Date(`${dateOnly}T00:00:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function dayEndMs(dateOnly) {
  const ms = new Date(`${dateOnly}T23:59:59.999`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function buildGroupListWhere(query = {}) {
  const parts = [];
  const status = String(query.status || '').trim();
  if (status) parts.push({ status });

  const q = String(query.q || query.search || '').trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    parts.push({
      [Op.or]: [
        { uid: { [Op.like]: like } },
        { name: { [Op.like]: like } },
        { link: { [Op.like]: like } },
        { note: { [Op.like]: like } },
        { claimedBy: { [Op.like]: like } },
      ],
    });
  }

  const from = parseDateOnly(query.scannedFrom);
  const to = parseDateOnly(query.scannedTo);
  const fromMs = from ? dayStartMs(from) : null;
  const toMs = to ? dayEndMs(to) : null;
  if (fromMs != null || toMs != null) {
    let scannedAt;
    if (fromMs != null && toMs != null) scannedAt = { [Op.between]: [fromMs, toMs] };
    else if (fromMs != null) scannedAt = { [Op.gte]: fromMs };
    else scannedAt = { [Op.lte]: toMs };
    parts.push({ scannedAt: { [Op.and]: [{ [Op.ne]: null }, scannedAt] } });
  }

  if (!parts.length) return {};
  if (parts.length === 1) return parts[0];
  return { [Op.and]: parts };
}

const GROUP_POST_COUNT_SQL = `
  SELECT COUNT(
    DISTINCT CASE
      WHEN instr(post_id, '__') > 0
        THEN substr(post_id, 1, instr(post_id, '__') - 1)
      ELSE post_id
    END
  ) AS postCount
  FROM posts
  WHERE group_id IS NOT NULL AND trim(group_id) != ''
`;

const GROUP_PHONE_COUNT_SQL = `
  SELECT COUNT(DISTINCT CASE
    WHEN phone IS NOT NULL AND trim(phone) != '' THEN trim(phone)
    ELSE NULL
  END) AS phoneCount
  FROM posts
  WHERE group_id IS NOT NULL AND trim(group_id) != ''
`;

async function countPostsForGroupUid(Post, uid) {
  const key = String(uid || '').trim();
  if (!key) return 0;
  const [[row]] = await Post.sequelize.query(`${GROUP_POST_COUNT_SQL} AND group_id = ?`, {
    replacements: [key],
  });
  return Number(row?.postCount) || 0;
}

async function loadGlobalDistinctPostTotal(Post) {
  const [[row]] = await Post.sequelize.query(GROUP_POST_COUNT_SQL);
  return Number(row?.postCount) || 0;
}

async function countPhonesForGroupUid(Post, uid) {
  const key = String(uid || '').trim();
  if (!key) return 0;
  const [[row]] = await Post.sequelize.query(`${GROUP_PHONE_COUNT_SQL} AND group_id = ?`, {
    replacements: [key],
  });
  return Number(row?.phoneCount) || 0;
}

async function loadGlobalDistinctPhoneTotal(Post) {
  const [[row]] = await Post.sequelize.query(`
    SELECT COUNT(DISTINCT CASE
      WHEN phone IS NOT NULL AND trim(phone) != '' THEN trim(phone)
      ELSE NULL
    END) AS phoneCount
    FROM posts
    WHERE group_id IS NOT NULL AND trim(group_id) != ''
  `);
  return Number(row?.phoneCount) || 0;
}

async function getGroupPostStat(req, res, next) {
  try {
    const uid = String(req.query.uid || '').trim();
    if (!uid) {
      return res.status(400).json({ ok: false, error: 'Thiếu uid' });
    }
    const { Post } = getModels();
    const postCount = await countPostsForGroupUid(Post, uid);
    res.json({ ok: true, uid, postCount });
  } catch (err) {
    next(err);
  }
}

async function getGroupsPostsTotal(req, res, next) {
  try {
    const { Post } = getModels();
    const postCount = await loadGlobalDistinctPostTotal(Post);
    res.json({ ok: true, postCount });
  } catch (err) {
    next(err);
  }
}

async function getGroupPhoneStat(req, res, next) {
  try {
    const uid = String(req.query.uid || '').trim();
    if (!uid) {
      return res.status(400).json({ ok: false, error: 'Thiếu uid' });
    }
    const { Post } = getModels();
    const phoneCount = await countPhonesForGroupUid(Post, uid);
    res.json({ ok: true, uid, phoneCount });
  } catch (err) {
    next(err);
  }
}

async function getGroupsPhonesTotal(req, res, next) {
  try {
    const { Post } = getModels();
    const phoneCount = await loadGlobalDistinctPhoneTotal(Post);
    res.json({ ok: true, phoneCount });
  } catch (err) {
    next(err);
  }
}

async function listGroups(req, res, next) {
  try {
    const { Group } = getModels();
    const picker = req.query.picker === '1' || req.query.picker === 'true';
    if (picker) {
      const rows = await Group.findAll({
        attributes: ['id', 'uid', 'name'],
        order: [
          ['name', 'ASC'],
          ['uid', 'ASC'],
        ],
        limit: 10_000,
      });
      return res.json({
        ok: true,
        groups: rows.map((row) => ({
          id: row.id,
          uid: row.uid,
          name: row.name || '',
        })),
      });
    }

    const { limit, offset } = parseGroupPagination(req.query);
    const where = buildGroupListWhere(req.query);

    const [rows, total, totalAll] = await Promise.all([
      Group.findAll({
        where,
        order: [['id', 'DESC']],
        limit,
        offset,
      }),
      Group.count({ where }),
      Group.count(),
    ]);

    const groups = rows.map((row) =>
      toPublicGroup(row, { postCount: null, phoneCount: null })
    );

    res.json({
      ok: true,
      groups,
      total,
      totalAll,
      limit,
      offset,
      page: Math.floor(offset / limit) + 1,
      totalPages: Math.max(1, Math.ceil(total / limit) || 1),
      totals: {
        posts: null,
        phones: null,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function createGroup(req, res) {
  try {
    const payload = normalizeGroupInput(req.body);
    if (!payload.uid) {
      return res.status(400).json({ ok: false, error: 'Thiếu uid hoặc link nhóm' });
    }

    const { Group } = getModels();
    const existed = await Group.findOne({ where: { uid: payload.uid } });
    if (existed) {
      return res.status(409).json({ ok: false, error: 'UID nhóm đã tồn tại' });
    }

    const group = await Group.create(payload);
    res.status(201).json({ ok: true, group: toPublicGroup(group) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không tạo được nhóm' });
  }
}

async function updateGroup(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }

    const { Group } = getModels();
    const group = await Group.findByPk(id);
    if (!group) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy nhóm' });
    }

    const payload = normalizeGroupInput({
      uid: req.body.uid != null ? req.body.uid : group.uid,
      name: req.body.name != null ? req.body.name : group.name,
      link: req.body.link != null ? req.body.link : group.link,
      status: req.body.status != null ? req.body.status : group.status,
      scannedAt: req.body.scannedAt !== undefined ? req.body.scannedAt : group.scannedAt,
      availableAt:
        req.body.availableAt !== undefined ? req.body.availableAt : group.availableAt,
      note: req.body.note != null ? req.body.note : group.note,
    });

    if (!payload.uid) {
      return res.status(400).json({ ok: false, error: 'Thiếu uid' });
    }

    if (payload.uid !== group.uid) {
      const clash = await Group.findOne({ where: { uid: payload.uid } });
      if (clash && clash.id !== group.id) {
        return res.status(409).json({ ok: false, error: 'UID nhóm đã tồn tại' });
      }
    }

    // Admin chuyển về "Chờ quét" → mở claim ngay (bỏ mốc khả dụng cũ)
    if (payload.status === 'pending' && group.status !== 'pending') {
      payload.availableAt = null;
      payload.claimedAt = null;
      payload.claimedBy = null;
    }

    await group.update(payload);
    res.json({ ok: true, group: toPublicGroup(group) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không cập nhật được nhóm' });
  }
}

async function createGroupsBulk(req, res) {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body?.groups;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ ok: false, error: 'Cần mảng groups' });
    }

    const { Group } = getModels();
    let created = 0;
    let updated = 0;

    for (const item of items) {
      const payload = normalizeGroupInput(item);
      if (!payload.uid) continue;
      const existed = await Group.findOne({ where: { uid: payload.uid } });
      if (existed) {
        await existed.update(payload);
        updated += 1;
      } else {
        await Group.create(payload);
        created += 1;
      }
    }

    const rows = await Group.findAll({ order: [['id', 'DESC']] });
    res.json({
      ok: true,
      created,
      updated,
      groups: rows.map(toPublicGroup),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không lưu được groups' });
  }
}

async function claimGroup(req, res) {
  try {
    const { Group, AppSetting } = getModels();
    const settings = await getScanSettingsRow(AppSetting);
    const now = Date.now();
    const staleBefore = now - settings.claimTimeoutMinutes * 60 * 1000;
    const claimedBy = String(req.user?.username || req.user?.id || 'ext').slice(0, 64);

    // pending = claim được ngay; done chỉ khi đã hết cooldown
    const availableWhere = {
      [Op.or]: [
        { status: 'pending' },
        {
          status: 'done',
          [Op.or]: [{ availableAt: null }, { availableAt: { [Op.lte]: now } }],
        },
      ],
    };

    // 1) Ưu tiên nhóm chưa quét lần nào
    let group = await Group.findOne({
      where: {
        ...availableWhere,
        scannedAt: null,
      },
      order: [['id', 'ASC']],
    });

    // 2) Rồi nhóm đã khả dụng, quét lâu nhất (scannedAt nhỏ nhất)
    if (!group) {
      group = await Group.findOne({
        where: {
          ...availableWhere,
          scannedAt: { [Op.ne]: null },
        },
        order: [
          ['scannedAt', 'ASC'],
          ['availableAt', 'ASC'],
          ['id', 'ASC'],
        ],
      });
    }

    // 3) Reclaim claim active bị treo quá timeout
    if (!group) {
      group = await Group.findOne({
        where: {
          status: 'active',
          [Op.or]: [{ claimedAt: null }, { claimedAt: { [Op.lt]: staleBefore } }],
        },
        order: [
          ['scannedAt', 'ASC'],
          ['claimedAt', 'ASC'],
          ['id', 'ASC'],
        ],
      });
    }

    if (!group) {
      return res.json({
        ok: true,
        available: false,
        group: null,
        settings,
        pollSeconds: settings.claimPollSeconds,
      });
    }

    await group.update({
      status: 'active',
      claimedAt: now,
      claimedBy,
      scannedAt: now,
      lastStopReason: null,
    });

    res.json({
      ok: true,
      available: true,
      group: toPublicGroup(group),
      settings,
      pollSeconds: settings.claimPollSeconds,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không lấy được nhóm' });
  }
}

async function releaseGroup(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }

    let reason = String(req.body?.reason || 'manual').trim().toLowerCase();
    if (!STOP_REASONS.includes(reason)) reason = 'manual';

    const { Group, AppSetting } = getModels();
    const group = await Group.findByPk(id);
    if (!group) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy nhóm' });
    }

    const settings = await getScanSettingsRow(AppSetting);
    const now = Date.now();
    const availableAt = addCooldownMs(
      now,
      settings.groupCooldownValue,
      settings.groupCooldownUnit
    );

    await group.update({
      status: 'done',
      scannedAt: now,
      claimedAt: null,
      claimedBy: null,
      availableAt,
      lastStopReason: reason,
      note:
        req.body?.note != null
          ? String(req.body.note).trim()
          : group.note,
    });

    res.json({
      ok: true,
      group: toPublicGroup(group),
      settings,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không trả nhóm' });
  }
}

async function deleteGroup(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Nhóm không hợp lệ' });
    }

    const { Group, Post } = getModels();
    const group = await Group.findByPk(id);
    if (!group) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy nhóm' });
    }

    const uid = String(group.uid || '').trim();
    const deletedPosts = uid ? await Post.destroy({ where: { groupId: uid } }) : 0;
    await group.destroy();

    res.json({
      ok: true,
      id,
      uid,
      deletedPosts,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không xóa được nhóm' });
  }
}

module.exports = {
  listGroups,
  getGroupPostStat,
  getGroupsPostsTotal,
  getGroupPhoneStat,
  getGroupsPhonesTotal,
  createGroup,
  updateGroup,
  createGroupsBulk,
  claimGroup,
  releaseGroup,
  deleteGroup,
  GROUP_STATUSES,
};
