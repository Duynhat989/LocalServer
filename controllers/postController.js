const { Op, fn, col, literal } = require('sequelize');
const { getModels } = require('../models');
const { toPublicPost, normalizePostInput } = require('../utils/post');
const { toKeyword } = require('../utils/text');

const ALLOWED_LIMITS = [50, 100, 200, 500, 1000, 10000];
const EMPTY_PHONE_LABEL = 'Không có SĐT';
const PHONE_KEY_SQL = `COALESCE(NULLIF(TRIM(phone), ''), '${EMPTY_PHONE_LABEL}')`;

function parsePagination(query = {}) {
  let limit = Number(query.limit);
  if (!ALLOWED_LIMITS.includes(limit)) limit = 100;

  let offset = Number(query.offset);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.floor(offset);

  return { limit, offset };
}

function isEmptyWhere(where) {
  if (!where || typeof where !== 'object') return true;
  return (
    Object.keys(where).length === 0 &&
    Object.getOwnPropertySymbols(where).length === 0
  );
}

function andWhere(base, extra) {
  if (isEmptyWhere(extra)) return base || {};
  if (isEmptyWhere(base)) return extra;
  return { [Op.and]: [base, extra] };
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function parsePaths(raw) {
  if (!raw) return [];
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(data)) return [];
    return data
      .map((path) => {
        if (Array.isArray(path)) {
          return {
            include: path.map((k) => toKeyword(k)).filter(Boolean),
            exclude: [],
          };
        }
        if (!path || typeof path !== 'object') return { include: [], exclude: [] };
        const include = Array.isArray(path.include) ? path.include : [];
        const exclude = Array.isArray(path.exclude) ? path.exclude : [];
        return {
          include: include.map((k) => toKeyword(k)).filter(Boolean),
          exclude: exclude.map((k) => toKeyword(k)).filter(Boolean),
        };
      })
      .filter((path) => path.include.length || path.exclude.length);
  } catch {
    return [];
  }
}

function ftsPhrase(needle) {
  return `"${String(needle).replace(/"/g, '""')}"`;
}

function keywordPathsWhere(paths) {
  const { sequelize } = getModels();
  const groups = [];

  for (const path of paths) {
    const include = Array.isArray(path) ? path : path.include || [];
    const exclude = Array.isArray(path) ? [] : path.exclude || [];
    const phrases = [];
    const scans = [];
    for (const needle of include) {
      if (!needle) continue;
      if (needle.length >= 3) phrases.push(ftsPhrase(needle));
      else scans.push(`instr(IFNULL(keyword, ''), ${sequelize.escape(needle)}) > 0`);
    }

    const and = [];
    if (phrases.length) {
      const match = phrases.length === 1 ? phrases[0] : `(${phrases.join(' AND ')})`;
      and.push(
        `id IN (SELECT rowid FROM post_keyword_fts WHERE post_keyword_fts MATCH ${sequelize.escape(match)})`
      );
    }
    and.push(...scans);
    for (const needle of exclude) {
      if (!needle) continue;
      if (needle.length >= 3) {
        and.push(
          `id NOT IN (SELECT rowid FROM post_keyword_fts WHERE post_keyword_fts MATCH ${sequelize.escape(ftsPhrase(needle))})`
        );
      } else {
        and.push(`instr(IFNULL(keyword, ''), ${sequelize.escape(needle)}) = 0`);
      }
    }
    if (and.length) groups.push(and.length === 1 ? and[0] : `(${and.join(' AND ')})`);
  }

  if (!groups.length) return null;
  return literal(groups.join(' OR '));
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

function phoneExactWhere(phoneExact) {
  const exact = String(phoneExact || '').trim();
  if (!exact || exact === EMPTY_PHONE_LABEL) {
    return {
      [Op.or]: [{ phone: null }, { phone: '' }],
    };
  }
  return { phone: exact };
}

function buildListWhere(query = {}) {
  const and = [];

  const phoneExact = String(query.phoneExact || '').trim();
  if (phoneExact) {
    and.push(phoneExactWhere(phoneExact));
  } else {
    const phone = String(query.phone || '').trim();
    if (phone) {
      and.push({ phone: { [Op.like]: `%${escapeLike(phone)}%` } });
    }
  }

  const userName = String(query.userName || '').trim();
  if (userName) {
    and.push({ userName: { [Op.like]: `%${escapeLike(userName)}%` } });
  }

  const groupId = String(query.groupId || '').trim();
  if (groupId) {
    and.push({ groupId });
  }

  // Lọc theo ngày quét / đẩy lên LocalServer (scanned_at ms)
  // Lưu ý: Op.gte/Op.lte là Symbol — không dùng Object.keys() để check
  const pushedFrom = parseDateOnly(query.pushedFrom || query.from);
  const pushedTo = parseDateOnly(query.pushedTo || query.to);
  if (pushedFrom || pushedTo) {
    const scannedRange = {};
    let hasRange = false;
    if (pushedFrom) {
      const fromMs = dayStartMs(pushedFrom);
      if (fromMs != null) {
        scannedRange[Op.gte] = fromMs;
        hasRange = true;
      }
    }
    if (pushedTo) {
      const toMs = dayEndMs(pushedTo);
      if (toMs != null) {
        scannedRange[Op.lte] = toMs;
        hasRange = true;
      }
    }
    if (hasRange) {
      and.push({ scannedAt: scannedRange });
    }
  }

  const paths = parsePaths(query.paths);
  if (paths.length) {
    const keywordWhere = keywordPathsWhere(paths);
    if (keywordWhere) and.push(keywordWhere);
  }

  if (!and.length) return {};
  if (and.length === 1) return and[0];
  return { [Op.and]: and };
}

function normalizePhoneKey(phone) {
  const value = String(phone || '').trim();
  return value || 'Không có SĐT';
}

function parseCampaignMembership(query = {}) {
  const campaignId = Number(query.campaignId);
  const raw = String(query.campaignMembership || query.campaignIn || '')
    .trim()
    .toLowerCase();
  const membership = raw === 'in' || raw === 'out' ? raw : '';
  if (!Number.isFinite(campaignId) || campaignId <= 0 || !membership) {
    return { campaignId: null, membership: '' };
  }
  return { campaignId, membership };
}

async function loadCampaignPhoneSet(campaignId) {
  const { CampaignPhone } = getModels();
  const rows = await CampaignPhone.findAll({
    where: { campaignId },
    attributes: ['phone'],
  });
  const set = new Set();
  for (const row of rows) {
    const phone = String(row.phone || '').trim();
    if (phone) set.add(phone);
  }
  return set;
}

async function applyCampaignMembershipWhere(where, campaignId, membership) {
  if (!campaignId || !membership) {
    return { where, campaignPhoneCount: null };
  }

  const phoneSet = await loadCampaignPhoneSet(campaignId);
  const phones = Array.from(phoneSet);
  const campaignPhoneCount = phones.length;

  if (membership === 'in') {
    if (!phones.length) {
      return { where: { id: { [Op.eq]: -1 } }, campaignPhoneCount: 0 };
    }
    return {
      where: andWhere(where, { phone: { [Op.in]: phones } }),
      campaignPhoneCount,
    };
  }

  // membership === 'out'
  if (!phones.length) {
    return { where, campaignPhoneCount: 0 };
  }

  return {
    where: andWhere(where, {
      [Op.or]: [
        { phone: { [Op.notIn]: phones } },
        { phone: null },
        { phone: '' },
      ],
    }),
    campaignPhoneCount,
  };
}

function parseUserNamesRaw(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'vi'));
}

function createdTimeToMs(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

async function countDistinctPhones(Post, where) {
  const rows = await Post.findAll({
    attributes: [[literal(PHONE_KEY_SQL), 'phoneKey']],
    where,
    group: [literal(PHONE_KEY_SQL)],
    raw: true,
  });
  return rows.length;
}

async function listPhoneGroupsPage(Post, where, limit, offset) {
  const rows = await Post.findAll({
    attributes: [
      [literal(PHONE_KEY_SQL), 'phone'],
      [fn('COUNT', col('id')), 'count'],
      [fn('MAX', col('scanned_at')), 'latestScannedAt'],
      [fn('MAX', col('created_time')), 'latestCreatedTime'],
      [fn('MIN', col('id')), 'sampleId'],
      [fn('GROUP_CONCAT', literal('DISTINCT user_name')), 'userNamesRaw'],
    ],
    where,
    group: [literal(PHONE_KEY_SQL)],
    order: [
      [literal('latestScannedAt'), 'DESC'],
      [literal(PHONE_KEY_SQL), 'ASC'],
    ],
    limit,
    offset,
    raw: true,
    subQuery: false,
  });

  const sampleIds = rows
    .map((r) => Number(r.sampleId))
    .filter((id) => Number.isFinite(id) && id > 0);
  const sampleMap = new Map();
  if (sampleIds.length) {
    const samples = await Post.findAll({
      where: { id: { [Op.in]: sampleIds } },
    });
    for (const post of samples) {
      sampleMap.set(post.id, toPublicPost(post));
    }
  }

  return rows.map((row) => {
    const samplePost = sampleMap.get(Number(row.sampleId)) || null;
    return {
      phone: normalizePhoneKey(row.phone),
      count: Number(row.count) || 0,
      userNames: parseUserNamesRaw(row.userNamesRaw),
      latestTime: createdTimeToMs(row.latestCreatedTime),
      latestScannedAt:
        row.latestScannedAt != null && row.latestScannedAt !== ''
          ? Number(row.latestScannedAt)
          : null,
      samplePost,
      posts: samplePost ? [samplePost] : [],
    };
  });
}

async function listDistinctUserNames(Post, where) {
  const rows = await Post.findAll({
    attributes: ['userName'],
    where,
    group: ['userName'],
    raw: true,
  });
  return rows
    .map((r) => String(r.userName || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'vi'));
}

async function listPosts(req, res, next) {
  try {
    const { Post } = getModels();
    const { limit, offset } = parsePagination(req.query);
    let where = buildListWhere(req.query);
    const view = String(req.query.view || 'post').toLowerCase() === 'phone' ? 'phone' : 'post';
    const { campaignId, membership } = parseCampaignMembership(req.query);

    const campaignApplied = await applyCampaignMembershipWhere(
      where,
      campaignId,
      membership
    );
    where = campaignApplied.where;
    const campaignPhoneCount = campaignApplied.campaignPhoneCount;

    const filterMeta = {
      phone: String(req.query.phone || '').trim() || null,
      phoneExact: String(req.query.phoneExact || '').trim() || null,
      userName: String(req.query.userName || '').trim() || null,
      groupId: String(req.query.groupId || '').trim() || null,
      pushedFrom: parseDateOnly(req.query.pushedFrom || req.query.from),
      pushedTo: parseDateOnly(req.query.pushedTo || req.query.to),
      paths: parsePaths(req.query.paths),
      campaignId,
      campaignMembership: membership || null,
      campaignPhoneCount,
    };

    if (view === 'phone') {
      const [total, matchedPostCount, phoneGroups] = await Promise.all([
        countDistinctPhones(Post, where),
        Post.count({ where }),
        listPhoneGroupsPage(Post, where, limit, offset),
      ]);

      return res.json({
        ok: true,
        view: 'phone',
        posts: phoneGroups.flatMap((g) => g.posts),
        phoneGroups,
        total,
        matchedPostCount,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        totalPages: Math.max(1, Math.ceil(total / limit) || 1),
        filters: filterMeta,
      });
    }

    const phoneExact = String(req.query.phoneExact || '').trim();
    const includeUserNames = Boolean(phoneExact) || req.query.includeUserNames === '1';

    const resultPromise = Post.findAndCountAll({
      where,
      order: [
        ['createdTime', 'DESC'],
        ['id', 'DESC'],
      ],
      limit,
      offset,
    });

    let userNamesPromise = Promise.resolve(undefined);
    if (includeUserNames) {
      // Dropdown ignores userName filter so options stay complete for the phone
      userNamesPromise = (async () => {
        const nameWhereBase = buildListWhere({ ...req.query, userName: '' });
        const nameWhereApplied = await applyCampaignMembershipWhere(
          nameWhereBase,
          campaignId,
          membership
        );
        return listDistinctUserNames(Post, nameWhereApplied.where);
      })();
    }

    const [result, userNames] = await Promise.all([resultPromise, userNamesPromise]);

    res.json({
      ok: true,
      view: 'post',
      posts: result.rows.map(toPublicPost),
      total: result.count,
      matchedPostCount: result.count,
      userNames,
      limit,
      offset,
      page: Math.floor(offset / limit) + 1,
      totalPages: Math.max(1, Math.ceil(result.count / limit) || 1),
      filters: filterMeta,
    });
  } catch (err) {
    next(err);
  }
}

async function createPost(req, res) {
  try {
    const payload = normalizePostInput(req.body);
    if (!payload.postId) {
      return res.status(400).json({ ok: false, error: 'Thiếu postId' });
    }

    const { Post } = getModels();
    const existed = await Post.findOne({ where: { postId: payload.postId } });
    if (existed) {
      await existed.update(payload);
      return res.json({ ok: true, post: toPublicPost(existed), updated: true });
    }

    const post = await Post.create(payload);
    res.status(201).json({ ok: true, post: toPublicPost(post) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không lưu được post' });
  }
}

async function createPostsBulk(req, res) {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body?.posts;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ ok: false, error: 'Cần mảng posts' });
    }

    const { Post } = getModels();
    let created = 0;
    let updated = 0;

    for (const item of items) {
      const payload = normalizePostInput(item);
      if (!payload.postId) continue;
      const existed = await Post.findOne({ where: { postId: payload.postId } });
      if (existed) {
        await existed.update(payload);
        updated += 1;
      } else {
        await Post.create(payload);
        created += 1;
      }
    }

    res.json({
      ok: true,
      created,
      updated,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không lưu được posts' });
  }
}

async function checkPostsExist(req, res) {
  try {
    const raw = Array.isArray(req.body?.ids)
      ? req.body.ids
      : Array.isArray(req.body?.postIds)
        ? req.body.postIds
        : [];
    const ids = raw.map((id) => String(id || '').trim()).filter(Boolean);
    if (!ids.length) {
      return res.json({ ok: true, existing: [] });
    }

    const { Post } = getModels();
    const { Op } = require('sequelize');
    const or = [];
    for (const id of ids.slice(0, 200)) {
      or.push({ postId: id });
      or.push({ postId: { [Op.like]: `${id}__%` } });
    }

    const rows = await Post.findAll({
      where: { [Op.or]: or },
      attributes: ['postId'],
    });

    const existing = new Set();
    for (const row of rows) {
      const postId = String(row.postId || '');
      for (const id of ids) {
        if (postId === id || postId.startsWith(`${id}__`)) existing.add(id);
      }
    }

    res.json({ ok: true, existing: Array.from(existing) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không kiểm tra được post' });
  }
}

async function deletePostsByGroup(req, res) {
  try {
    const groupId = String(req.params.groupId || req.body?.groupId || '').trim();
    if (!groupId) {
      return res.status(400).json({ ok: false, error: 'Thiếu groupId' });
    }

    const { Post } = getModels();
    const deleted = await Post.destroy({ where: { groupId } });
    res.json({
      ok: true,
      groupId,
      deleted,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không xóa được bài đăng' });
  }
}

module.exports = {
  listPosts,
  createPost,
  createPostsBulk,
  checkPostsExist,
  deletePostsByGroup,
};
