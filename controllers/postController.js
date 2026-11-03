const { Op, fn, col, literal } = require('sequelize');
const { getModels } = require('../models');
const {
  toPublicPost,
  toPublicPostLite,
  normalizePostInput,
  POST_LIST_LITE_ATTRIBUTES,
} = require('../utils/post');
const {
  keywordPathsWhere,
  isFtsResultCacheError,
  resolveKeywordMatch,
} = require('../utils/postKeywordSearch');
const { queueAttachPosts, getFilterSyncPublic } = require('../jobs/filterPostsSync');
const { toKeyword } = require('../utils/text');
const { normalizePhone } = require('../utils/campaign');

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

function parseFilterId(query = {}) {
  const id = Number(query.filterId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function buildListWhere(
  query = {},
  { keywordMatch = 'fulltext', filterId = null, skipSavedFilterSubquery = false } = {}
) {
  const and = [];
  const savedFilterId = filterId ?? parseFilterId(query);

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
  if (savedFilterId && !skipSavedFilterSubquery) {
    const { sequelize } = getModels();
    and.push({
      id: {
        [Op.in]: literal(
          `(SELECT post_id FROM filter_posts WHERE filter_id = ${sequelize.escape(savedFilterId)})`
        ),
      },
    });
  } else if (!savedFilterId && paths.length) {
    const { sequelize } = getModels();
    const keywordWhere = keywordPathsWhere(paths, sequelize, keywordMatch);
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

function createdTimeToMs(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

async function countDistinctPhones(Post, where) {
  const row = await Post.findOne({
    attributes: [[literal(`COUNT(DISTINCT ${PHONE_KEY_SQL})`), 'cnt']],
    where,
    raw: true,
  });
  return Number(row?.cnt) || 0;
}

function whereForPhoneKey(sequelize, phoneKey) {
  const key = normalizePhoneKey(phoneKey);
  if (key === EMPTY_PHONE_LABEL) {
    return {
      [Op.or]: [{ phone: null }, { phone: '' }, literal("NULLIF(TRIM(`phone`), '') IS NULL")],
    };
  }
  return literal(`${PHONE_KEY_SQL} = ${sequelize.escape(key)}`);
}

async function attachUserNamesToPhoneGroups(Post, where, groups) {
  const { sequelize } = Post;
  if (!groups.length) return groups;

  const keyConditions = groups.map((g) => whereForPhoneKey(sequelize, g.phone));
  const rows = await Post.findAll({
    attributes: [
      [literal(PHONE_KEY_SQL), 'phoneKey'],
      ['user_name', 'userName'],
    ],
    where: andWhere(where, { [Op.or]: keyConditions }),
    group: [literal(PHONE_KEY_SQL), col('user_name')],
    raw: true,
  });

  const byPhone = new Map();
  for (const row of rows) {
    const key = normalizePhoneKey(row.phoneKey);
    if (!byPhone.has(key)) byPhone.set(key, []);
    const name = String(row.userName || '').trim();
    if (name) byPhone.get(key).push(name);
  }

  return groups.map((group) => ({
    ...group,
    userNames: (byPhone.get(group.phone) || []).sort((a, b) => a.localeCompare(b, 'vi')),
  }));
}

async function listPhoneGroupsPage(Post, where, limit, offset) {
  const rows = await Post.findAll({
    attributes: [
      [literal(PHONE_KEY_SQL), 'phone'],
      [fn('COUNT', col('id')), 'count'],
      [fn('MAX', col('scanned_at')), 'latestScannedAt'],
      [fn('MAX', col('created_time')), 'latestCreatedTime'],
      [fn('MIN', col('id')), 'sampleId'],
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

  const groups = rows.map((row) => {
    const samplePost = sampleMap.get(Number(row.sampleId)) || null;
    return {
      phone: normalizePhoneKey(row.phone),
      count: Number(row.count) || 0,
      userNames: [],
      latestTime: createdTimeToMs(row.latestCreatedTime),
      latestScannedAt:
        row.latestScannedAt != null && row.latestScannedAt !== ''
          ? Number(row.latestScannedAt)
          : null,
      samplePost,
      posts: samplePost ? [samplePost] : [],
    };
  });

  return attachUserNamesToPhoneGroups(Post, where, groups);
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

async function assembleListWhere(query, keywordMatch, filterId = null) {
  const { campaignId, membership } = parseCampaignMembership(query);
  return applyCampaignMembershipWhere(
    buildListWhere(query, { keywordMatch, filterId }),
    campaignId,
    membership
  );
}

/** Bộ lọc lưu: keyword qua JOIN filter_posts — chỉ điều kiện phone/nhóm/ngày/chiến dịch trên posts. */
async function assemblePostWhereForFilterJoin(query, filterId) {
  const { campaignId, membership } = parseCampaignMembership(query);
  return applyCampaignMembershipWhere(
    buildListWhere(query, { filterId, skipSavedFilterSubquery: true }),
    campaignId,
    membership
  );
}

const FILTER_JOIN_POST_ALIAS = 'post';

function phoneKeySqlForAlias(alias) {
  return `COALESCE(NULLIF(TRIM(\`${alias}\`.\`phone\`), ''), '${EMPTY_PHONE_LABEL}')`;
}

function whereForPhoneKeyOnAlias(sequelize, phoneKey, alias = FILTER_JOIN_POST_ALIAS) {
  const key = normalizePhoneKey(phoneKey);
  const expr = phoneKeySqlForAlias(alias);
  if (key === EMPTY_PHONE_LABEL) {
    return literal(`NULLIF(TRIM(\`${alias}\`.\`phone\`), '') IS NULL`);
  }
  return literal(`${expr} = ${sequelize.escape(key)}`);
}

function parseLoadPhase(query = {}) {
  const raw = String(query.loadPhase || 'all').trim().toLowerCase();
  if (
    raw === 'content' ||
    raw === 'stats' ||
    raw === 'phone-row' ||
    raw === 'phone-rows' ||
    raw === 'phone-counts' ||
    raw === 'bodies'
  ) {
    return raw;
  }
  return 'all';
}

function parsePostIdsQuery(query = {}) {
  const raw = String(query.ids || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((n) => Number(n))
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, 500);
}

function parsePhoneKeysQuery(query = {}) {
  const bulk = String(query.phoneKeys || '').trim();
  if (bulk) {
    return bulk
      .split(',')
      .map((s) => normalizePhoneKey(s.trim()))
      .filter(Boolean)
      .slice(0, 500);
  }
  const single = String(query.phoneKey || '').trim();
  if (single) return [normalizePhoneKey(single)];
  return [];
}

async function listPhoneGroupsPageMinimal(Post, where, limit, offset) {
  const rows = await Post.findAll({
    attributes: [
      [literal(PHONE_KEY_SQL), 'phone'],
      [fn('MAX', col('scanned_at')), 'latestScannedAt'],
      [fn('MAX', col('created_time')), 'latestCreatedTime'],
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

  return rows.map((row) => ({
    phone: normalizePhoneKey(row.phone),
    count: null,
    userNames: [],
    latestTime: createdTimeToMs(row.latestCreatedTime),
    latestScannedAt:
      row.latestScannedAt != null && row.latestScannedAt !== ''
        ? Number(row.latestScannedAt)
        : null,
    samplePost: null,
    posts: [],
  }));
}

async function fetchPhoneCountsBatchViaFilterPosts(Post, filterId, postWhere, phoneKeys) {
  const { FilterPost } = getModels();
  const { sequelize } = Post;
  const keys = [
    ...new Set(
      phoneKeys.map((k) => normalizePhoneKey(String(k || '').trim())).filter(Boolean)
    ),
  ];
  if (!keys.length) return [];

  const phoneExpr = phoneKeySqlForAlias(FILTER_JOIN_POST_ALIAS);
  const keyConditions = keys.map((k) => whereForPhoneKeyOnAlias(sequelize, k));
  const includeWhere = andWhere(postWhere, { [Op.or]: keyConditions });

  const rows = await FilterPost.findAll({
    attributes: [
      [literal(phoneExpr), 'phone'],
      [fn('COUNT', col('FilterPost.post_id')), 'count'],
    ],
    where: { filterId },
    include: [
      {
        model: Post,
        as: 'post',
        attributes: [],
        required: true,
        where: includeWhere,
      },
    ],
    group: [literal(phoneExpr)],
    raw: true,
    subQuery: false,
  });

  const countByPhone = new Map();
  for (const row of rows) {
    countByPhone.set(normalizePhoneKey(row.phone), Number(row.count) || 0);
  }

  return keys.map((phone) => ({
    phone,
    count: countByPhone.get(phone) ?? 0,
  }));
}

async function fetchPhoneCountsBatch(Post, where, phoneKeys, options = {}) {
  const keys = [
    ...new Set(
      phoneKeys.map((k) => normalizePhoneKey(String(k || '').trim())).filter(Boolean)
    ),
  ];
  if (!keys.length) return [];

  const savedFilterId = options.filterId ?? null;
  if (savedFilterId && options.query) {
    const postApplied = await assemblePostWhereForFilterJoin(options.query, savedFilterId);
    return fetchPhoneCountsBatchViaFilterPosts(
      Post,
      savedFilterId,
      postApplied.where,
      keys
    );
  }

  const { sequelize } = Post;
  const keyConditions = keys.map((k) => whereForPhoneKey(sequelize, k));
  const rowWhere = andWhere(where, { [Op.or]: keyConditions });

  const rows = await Post.findAll({
    attributes: [
      [literal(PHONE_KEY_SQL), 'phone'],
      [fn('COUNT', col('id')), 'count'],
    ],
    where: rowWhere,
    group: [literal(PHONE_KEY_SQL)],
    raw: true,
  });

  const countByPhone = new Map();
  for (const row of rows) {
    countByPhone.set(normalizePhoneKey(row.phone), Number(row.count) || 0);
  }

  return keys.map((phone) => ({
    phone,
    count: countByPhone.get(phone) ?? 0,
  }));
}

async function countDistinctPhonesViaFilterPosts(Post, filterId, postWhere) {
  const { FilterPost } = getModels();
  const phoneExpr = phoneKeySqlForAlias(FILTER_JOIN_POST_ALIAS);
  const row = await FilterPost.findOne({
    attributes: [[literal(`COUNT(DISTINCT ${phoneExpr})`), 'cnt']],
    where: { filterId },
    include: [
      {
        model: Post,
        as: 'post',
        attributes: [],
        required: true,
        where: postWhere,
      },
    ],
    raw: true,
    subQuery: false,
  });
  return Number(row?.cnt) || 0;
}

async function countPostsViaFilterPosts(Post, filterId, postWhere) {
  const { FilterPost } = getModels();
  return FilterPost.count({
    where: { filterId },
    include: [
      {
        model: Post,
        as: 'post',
        attributes: [],
        required: true,
        where: postWhere,
      },
    ],
    distinct: true,
    col: 'post_id',
  });
}

async function fetchPhoneRowDetail(Post, where, phoneKey) {
  const key = normalizePhoneKey(phoneKey);
  const [countRow] = await fetchPhoneCountsBatch(Post, where, [key]);
  const count = countRow?.count ?? 0;

  const { sequelize } = Post;
  const rowWhere = andWhere(where, whereForPhoneKey(sequelize, key));
  const sampleRow = await Post.findOne({
    where: rowWhere,
    order: [
      ['scannedAt', 'DESC'],
      ['id', 'DESC'],
    ],
  });
  const samplePost = sampleRow ? toPublicPost(sampleRow) : null;

  return {
    phone: key,
    count,
    userNames: [],
    samplePost,
  };
}

async function respondPhoneCountsBatch(
  Post,
  where,
  phoneKeys,
  respondPayload,
  { filterId = null, query = null } = {}
) {
  const phoneCounts = await fetchPhoneCountsBatch(Post, where, phoneKeys, {
    filterId,
    query,
  });
  return respondPayload({ view: 'phone', loadPhase: 'phone-counts', phoneCounts });
}

async function fetchPostBodies(Post, ids) {
  if (!ids.length) return {};
  const rows = await Post.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ['id', 'postMessage', 'keyword'],
  });
  const bodies = {};
  for (const row of rows) {
    const json = row.toJSON ? row.toJSON() : row;
    bodies[json.id] = {
      postMessage: json.postMessage,
      keyword: json.keyword || '',
    };
  }
  return bodies;
}

async function fetchPostsListPayload(
  Post,
  req,
  where,
  limit,
  offset,
  view,
  keywordMatch,
  loadPhase = 'all'
) {
  const { campaignId, membership } = parseCampaignMembership(req.query);

  if (view === 'phone') {
    if (loadPhase === 'stats') {
      const savedFilterId = parseFilterId(req.query);
      if (savedFilterId) {
        const postApplied = await assemblePostWhereForFilterJoin(req.query, savedFilterId);
        const postWhere = postApplied.where;
        const [total, matchedPostCount] = await Promise.all([
          countDistinctPhonesViaFilterPosts(Post, savedFilterId, postWhere),
          countPostsViaFilterPosts(Post, savedFilterId, postWhere),
        ]);
        return {
          view: 'phone',
          total,
          matchedPostCount,
          loadPhase: 'stats',
        };
      }
      const [total, matchedPostCount] = await Promise.all([
        countDistinctPhones(Post, where),
        Post.count({ where }),
      ]);
      return {
        view: 'phone',
        total,
        matchedPostCount,
        loadPhase: 'stats',
      };
    }

    const phoneGroups =
      loadPhase === 'content'
        ? await listPhoneGroupsPageMinimal(Post, where, limit, offset)
        : await listPhoneGroupsPage(Post, where, limit, offset);
    const base = {
      view: 'phone',
      posts: phoneGroups.flatMap((g) => g.posts),
      phoneGroups,
      loadPhase: loadPhase === 'content' ? 'content' : 'all',
    };

    if (loadPhase === 'content') {
      return {
        ...base,
        total: null,
        matchedPostCount: null,
        statsPending: true,
      };
    }

    const [total, matchedPostCount] = await Promise.all([
      countDistinctPhones(Post, where),
      Post.count({ where }),
    ]);
    return { ...base, total, matchedPostCount };
  }

  const phoneExact = String(req.query.phoneExact || '').trim();
  const includeUserNames = Boolean(phoneExact) || req.query.includeUserNames === '1';

  if (loadPhase === 'stats') {
    const count = await Post.count({ where });
    return {
      view: 'post',
      total: count,
      matchedPostCount: count,
      loadPhase: 'stats',
    };
  }

  const order = [
    ['createdTime', 'DESC'],
    ['id', 'DESC'],
  ];

  if (loadPhase === 'content') {
    const rows = await Post.findAll({
      where,
      order,
      limit,
      offset,
      attributes: POST_LIST_LITE_ATTRIBUTES,
    });
    return {
      view: 'post',
      posts: rows.map(toPublicPostLite),
      total: null,
      matchedPostCount: null,
      statsPending: true,
      loadPhase: 'content',
    };
  }

  const rowsPromise = Post.findAll({ where, order, limit, offset });
  const countPromise = Post.count({ where });
  const resultPromise = Promise.all([rowsPromise, countPromise]).then(([rows, count]) => ({
    rows,
    count,
  }));

  let userNamesPromise = Promise.resolve(undefined);
  if (includeUserNames) {
    userNamesPromise = (async () => {
      const nameWhereApplied = await assembleListWhere(
        { ...req.query, userName: '' },
        keywordMatch
      );
      return listDistinctUserNames(Post, nameWhereApplied.where);
    })();
  }

  const [result, userNames] = await Promise.all([resultPromise, userNamesPromise]);
  return {
    view: 'post',
    posts: result.rows.map(toPublicPost),
    total: result.count,
    matchedPostCount: result.count,
    userNames,
  };
}

async function listPosts(req, res, next) {
  try {
    const { Post } = getModels();
    const { limit, offset } = parsePagination(req.query);
    const view = String(req.query.view || 'post').toLowerCase() === 'phone' ? 'phone' : 'post';
    const loadPhase = parseLoadPhase(req.query);
    const { campaignId, membership } = parseCampaignMembership(req.query);

    const { sequelize } = getModels();
    const savedFilterId = parseFilterId(req.query);
    const filterPaths = savedFilterId ? [] : parsePaths(req.query.paths);
    let keywordMatch = savedFilterId
      ? 'fulltext'
      : resolveKeywordMatch(filterPaths, req.query, sequelize.getDialect());
    let campaignApplied = await assembleListWhere(req.query, keywordMatch, savedFilterId);
    let where = campaignApplied.where;

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
      campaignPhoneCount: campaignApplied.campaignPhoneCount,
      filterId: savedFilterId,
    };

    let filterSync = null;
    if (savedFilterId) {
      filterSync = await getFilterSyncPublic(savedFilterId);
    }

    const respondPayload = (payload) => {
      const totalForPages =
        payload.total != null && payload.total !== ''
          ? Number(payload.total) || 0
          : null;
      res.json({
        ok: true,
        ...payload,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        totalPages:
          totalForPages != null
            ? Math.max(1, Math.ceil(totalForPages / limit) || 1)
            : null,
        filters: filterMeta,
        filterSync,
      });
    };

    if (loadPhase === 'phone-counts' || loadPhase === 'phone-rows') {
      const phoneKeys = parsePhoneKeysQuery(req.query);
      if (!phoneKeys.length) {
        return res.status(400).json({ ok: false, error: 'Thiếu phoneKeys' });
      }
      try {
        return await respondPhoneCountsBatch(Post, where, phoneKeys, respondPayload, {
          filterId: savedFilterId,
          query: req.query,
        });
      } catch (err) {
        if (savedFilterId || !isFtsResultCacheError(err)) throw err;
        keywordMatch = 'substr';
        campaignApplied = await assembleListWhere(req.query, keywordMatch, savedFilterId);
        where = campaignApplied.where;
        return await respondPhoneCountsBatch(Post, where, phoneKeys, respondPayload, {
          filterId: savedFilterId,
          query: req.query,
        });
      }
    }

    if (loadPhase === 'phone-row') {
      const phoneKey = String(req.query.phoneKey || '').trim();
      if (!phoneKey) {
        return res.status(400).json({ ok: false, error: 'Thiếu phoneKey' });
      }
      try {
        const row = await fetchPhoneRowDetail(Post, where, phoneKey);
        return respondPayload({ view: 'phone', loadPhase: 'phone-row', phoneRow: row });
      } catch (err) {
        if (savedFilterId || !isFtsResultCacheError(err)) throw err;
        keywordMatch = 'substr';
        campaignApplied = await assembleListWhere(req.query, keywordMatch, savedFilterId);
        where = campaignApplied.where;
        const row = await fetchPhoneRowDetail(Post, where, phoneKey);
        return respondPayload({ view: 'phone', loadPhase: 'phone-row', phoneRow: row });
      }
    }

    if (loadPhase === 'bodies') {
      const ids = parsePostIdsQuery(req.query);
      const bodies = await fetchPostBodies(Post, ids);
      return respondPayload({ view: 'post', loadPhase: 'bodies', bodies });
    }

    let payload;
    try {
      payload = await fetchPostsListPayload(
        Post,
        req,
        where,
        limit,
        offset,
        view,
        keywordMatch,
        loadPhase
      );
    } catch (err) {
      if (savedFilterId || !isFtsResultCacheError(err)) throw err;
      console.warn('[posts] FULLTEXT vượt cache — lọc keyword bằng INSTR');
      keywordMatch = 'substr';
      campaignApplied = await assembleListWhere(req.query, keywordMatch, savedFilterId);
      where = campaignApplied.where;
      payload = await fetchPostsListPayload(
        Post,
        req,
        where,
        limit,
        offset,
        view,
        keywordMatch,
        loadPhase
      );
    }

    respondPayload(payload);
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
      await existed.reload();
      queueAttachPosts([{ id: existed.id, keyword: existed.keyword }]);
      return res.json({ ok: true, post: toPublicPost(existed), updated: true });
    }

    const post = await Post.create(payload);
    queueAttachPosts([{ id: post.id, keyword: post.keyword }]);
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
    const touchedPostIds = [];

    for (const item of items) {
      const payload = normalizePostInput(item);
      if (!payload.postId) continue;
      const existed = await Post.findOne({ where: { postId: payload.postId } });
      if (existed) {
        await existed.update(payload);
        touchedPostIds.push(existed.id);
        updated += 1;
      } else {
        const row = await Post.create(payload);
        touchedPostIds.push(row.id);
        created += 1;
      }
    }

    if (touchedPostIds.length) {
      const rows = await Post.findAll({
        where: { id: touchedPostIds },
        attributes: ['id', 'keyword'],
      });
      queueAttachPosts(rows);
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

async function resolveWhereForPhoneCollect(query = {}) {
  const { sequelize } = getModels();
  const savedFilterId = parseFilterId(query);
  const filterPaths = savedFilterId ? [] : parsePaths(query.paths);
  let keywordMatch = savedFilterId
    ? 'fulltext'
    : resolveKeywordMatch(filterPaths, query, sequelize.getDialect());
  try {
    const campaignApplied = await assembleListWhere(query, keywordMatch, savedFilterId);
    return campaignApplied.where;
  } catch (err) {
    if (savedFilterId || !isFtsResultCacheError(err)) throw err;
    keywordMatch = 'substr';
    const campaignApplied = await assembleListWhere(query, keywordMatch, savedFilterId);
    return campaignApplied.where;
  }
}

/** Toàn bộ SĐT khớp bộ lọc (không theo limit/offset trang Posts). */
async function collectPhonesForCampaignPush(query = {}) {
  const { Post } = getModels();
  const where = await resolveWhereForPhoneCollect(query);
  const distinctTotal = await countDistinctPhones(Post, where);
  const seen = new Set();
  const items = [];
  const batchSize = 500;

  for (let offset = 0; offset < distinctTotal; offset += batchSize) {
    const groups = await listPhoneGroupsPageMinimal(Post, where, batchSize, offset);
    if (!groups.length) break;
    for (const g of groups) {
      if (g.phone === EMPTY_PHONE_LABEL) continue;
      const phone = normalizePhone(g.phone);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      items.push({ phone });
    }
    if (groups.length < batchSize) break;
  }

  return { items, total: items.length, distinctTotal };
}

module.exports = {
  listPosts,
  createPost,
  createPostsBulk,
  checkPostsExist,
  deletePostsByGroup,
  collectPhonesForCampaignPush,
};
