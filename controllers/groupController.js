const { Op } = require('sequelize');
const { getModels } = require('../models');
const { toPublicGroup, normalizeGroupInput, GROUP_STATUSES, STOP_REASONS } = require('../utils/group');
const { getScanSettingsRow } = require('./settingsController');
const { addCooldownMs } = require('../utils/settings');

async function loadGroupPostStats(Post) {
  const [rows] = await Post.sequelize.query(`
    SELECT
      group_id AS groupId,
      COUNT(
        DISTINCT CASE
          WHEN instr(post_id, '__') > 0
            THEN substr(post_id, 1, instr(post_id, '__') - 1)
          ELSE post_id
        END
      ) AS postCount,
      COUNT(DISTINCT CASE
        WHEN phone IS NOT NULL AND trim(phone) != '' THEN trim(phone)
        ELSE NULL
      END) AS phoneCount
    FROM posts
    WHERE group_id IS NOT NULL AND trim(group_id) != ''
    GROUP BY group_id
  `);

  const map = new Map();
  for (const row of rows || []) {
    const key = String(row.groupId || '').trim();
    if (!key) continue;
    map.set(key, {
      postCount: Number(row.postCount) || 0,
      phoneCount: Number(row.phoneCount) || 0,
    });
  }
  return map;
}

async function listGroups(req, res, next) {
  try {
    const { Group, Post } = getModels();
    const [rows, statsMap] = await Promise.all([
      Group.findAll({ order: [['id', 'DESC']] }),
      loadGroupPostStats(Post),
    ]);

    const groups = rows.map((row) => {
      const publicGroup = toPublicGroup(row);
      const stats = statsMap.get(String(publicGroup.uid || '').trim()) || {
        postCount: 0,
        phoneCount: 0,
      };
      return toPublicGroup(row, stats);
    });

    res.json({
      ok: true,
      groups,
      totals: {
        posts: groups.reduce((sum, g) => sum + (g.postCount || 0), 0),
        phones: groups.reduce((sum, g) => sum + (g.phoneCount || 0), 0),
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
  createGroup,
  updateGroup,
  createGroupsBulk,
  claimGroup,
  releaseGroup,
  deleteGroup,
  GROUP_STATUSES,
};
