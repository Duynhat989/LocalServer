const { Op, col, literal } = require('sequelize');
const { getModels } = require('../models');
const { recordActivity } = require('../utils/activityLog');
const {
  toPublicCampaign,
  toPublicCampaignPhone,
  normalizeCampaignInput,
  normalizePhoneList,
  normalizePhone,
  phoneDigitVariants,
  generateStepAdd,
} = require('../utils/campaign');
const { toPublicPost, POST_LIST_LITE_ATTRIBUTES } = require('../utils/post');

const CAMPAIGN_PUSH_POST_ATTRIBUTES = [...POST_LIST_LITE_ATTRIBUTES, 'postMessage', 'keyword'];

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

function parseDateOnly(value) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function dayStart(dateOnly) {
  const date = new Date(`${dateOnly}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayEnd(dateOnly) {
  const date = new Date(`${dateOnly}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDateKey(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

async function listAddedDates(CampaignPhone, campaignId) {
  const rows = await CampaignPhone.findAll({
    where: { campaignId },
    attributes: [[col('created_at'), 'createdAt']],
    raw: true,
  });
  const days = new Set();
  for (const row of rows) {
    const key = localDateKey(row.createdAt);
    if (key) days.add(key);
  }
  return Array.from(days).sort((a, b) => b.localeCompare(a));
}

function buildCampaignPhoneWhere(campaignId, query = {}) {
  const where = { campaignId };
  const used = String(query.used || query.isUsed || 'all').trim().toLowerCase();
  if (used === 'unused' || used === '0' || used === 'false') {
    where.isUsed = false;
  } else if (used === 'used' || used === '1' || used === 'true') {
    where.isUsed = true;
  }

  const addedOn = parseDateOnly(query.addedOn);
  const addedFrom = addedOn || parseDateOnly(query.addedFrom || query.from);
  const addedTo = addedOn || parseDateOnly(query.addedTo || query.to);
  if (addedFrom || addedTo) {
    const { sequelize } = getModels();
    const createdRange = [];
    const from = addedFrom ? dayStart(addedFrom) : null;
    const to = addedTo ? dayEnd(addedTo) : null;
    if (from) createdRange.push(literal(`created_at >= ${sequelize.escape(from)}`));
    if (to) createdRange.push(literal(`created_at <= ${sequelize.escape(to)}`));
    if (createdRange.length) where[Op.and] = createdRange;
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

    const { Campaign, CampaignPhone, Post } = getModels();
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
    const displayRows = await backfillCampaignPhoneMetadata(Post, rows);
    const [{ phoneCount, unusedCount }, addedDates, filteredUnused] = await Promise.all([
      getCampaignCounts(CampaignPhone, campaignId),
      listAddedDates(CampaignPhone, campaignId),
      CampaignPhone.count({
        where: buildCampaignPhoneWhere(campaignId, { ...req.query, used: 'unused' }),
      }),
    ]);

    res.json({
      ok: true,
      phones: displayRows.map(toPublicCampaignPhone),
      total: count,
      filteredUnused,
      limit,
      offset,
      page: Math.floor(offset / limit) + 1,
      totalPages: Math.max(1, Math.ceil(count / limit) || 1),
      campaign: toPublicCampaign(campaign, phoneCount, unusedCount),
      addedDates,
      filters: {
        q: String(req.query.q || req.query.search || '').trim() || null,
        used: String(req.query.used || req.query.isUsed || 'all').trim().toLowerCase() || 'all',
        addedOn: parseDateOnly(req.query.addedOn),
      },
    });
  } catch (err) {
    next(err);
  }
}

function stepBatchSortMs(createdAt) {
  if (!createdAt) return 0;
  const raw = String(createdAt).includes('T')
    ? createdAt
    : String(createdAt).replace(' ', 'T');
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
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
      attributes: [
        'id',
        'phone',
        'userName',
        'stepAdd',
        [col('created_at'), 'createdAt'],
      ],
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
          createdAt: json.createdAt || json.created_at || null,
          maxId: 0,
          phones: [],
          userNames: new Set(),
        });
      }
      const batch = map.get(label);
      batch.count += 1;
      batch.phones.push(json.phone);
      const rowId = Number(json.id) || 0;
      if (rowId > batch.maxId) batch.maxId = rowId;
      if (json.userName || json.user_name) {
        batch.userNames.add(json.userName || json.user_name);
      }
      const createdAt = json.createdAt || json.created_at || null;
      if (createdAt) {
        const batchMs = stepBatchSortMs(batch.createdAt);
        const rowMs = stepBatchSortMs(createdAt);
        if (!batchMs || rowMs > batchMs) {
          batch.createdAt = createdAt;
        }
      }
    }

    const steps = Array.from(map.values())
      .map((batch) => ({
        stepAdd: batch.stepAdd,
        label: batch.label,
        count: batch.count,
        createdAt: batch.createdAt,
        maxId: batch.maxId,
        userNames: Array.from(batch.userNames),
        previewPhones: batch.phones.slice(0, 5),
        canUndo: Boolean(batch.stepAdd),
      }))
      .sort((a, b) => {
        const byTime = stepBatchSortMs(b.createdAt) - stepBatchSortMs(a.createdAt);
        if (byTime !== 0) return byTime;
        return (b.maxId || 0) - (a.maxId || 0);
      })
      .map(({ maxId, ...rest }) => rest);

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

function pickFilled(current, fallback) {
  const a = current != null ? String(current).trim() : '';
  if (a) return current;
  const b = fallback != null ? String(fallback).trim() : '';
  return b || null;
}

const FILTER_JOIN_POST_ALIAS = 'post';

function phoneNormSql() {
  return `REPLACE(REPLACE(REPLACE(REPLACE(TRIM(\`phone\`), ' ', ''), '-', ''), '.', ''), '+', '')`;
}

function phoneNormSqlForAlias(alias) {
  return `REPLACE(REPLACE(REPLACE(REPLACE(TRIM(\`${alias}\`.\`phone\`), ' ', ''), '-', ''), '.', ''), '+', '')`;
}

function phoneDigitsMatchWhere(Post, phone) {
  const variants = phoneDigitVariants(phone);
  if (!variants.length) return { id: { [Op.eq]: -1 } };
  const { sequelize } = Post;
  const normSql = phoneNormSql();
  if (variants.length === 1) {
    return literal(`${normSql} = ${sequelize.escape(variants[0])}`);
  }
  return {
    [Op.or]: variants.map((v) => literal(`${normSql} = ${sequelize.escape(v)}`)),
  };
}

function phoneDigitsMatchWhereForAlias(Post, phone, alias = FILTER_JOIN_POST_ALIAS) {
  const variants = phoneDigitVariants(phone);
  if (!variants.length) return { id: { [Op.eq]: -1 } };
  const { sequelize } = Post;
  const normSql = phoneNormSqlForAlias(alias);
  if (variants.length === 1) {
    return literal(`${normSql} = ${sequelize.escape(variants[0])}`);
  }
  return {
    [Op.or]: variants.map((v) => literal(`${normSql} = ${sequelize.escape(v)}`)),
  };
}

function isEmptyWhere(where) {
  if (!where || typeof where !== 'object') return true;
  return (
    Object.keys(where).length === 0 &&
    Object.getOwnPropertySymbols(where).length === 0
  );
}

function andWhereClause(base, extra) {
  if (isEmptyWhere(extra)) return base || {};
  if (isEmptyWhere(base)) return extra;
  return { [Op.and]: [base, extra] };
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

/** Cùng phạm vi nhóm / ngày quét như màn Posts khi đẩy chiến dịch. */
function buildListScopeFromPushBody(body = {}) {
  const and = [];
  const groupId = String(body.groupId || '').trim();
  if (groupId) and.push({ groupId });

  const pushedFrom = parseDateOnly(body.pushedFrom || body.from);
  const pushedTo = parseDateOnly(body.pushedTo || body.to);
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
    if (hasRange) and.push({ scannedAt: scannedRange });
  }

  if (!and.length) return null;
  if (and.length === 1) return and[0];
  return { [Op.and]: and };
}

function parseFilterIdFromBody(body = {}) {
  const id = Number(body.filterId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function findLatestPostForPhone(
  Post,
  phone,
  { filterId = null, listWhere = null, filterPostsOnly = false } = {}
) {
  const { FilterPost } = getModels();
  const phoneWhere = phoneDigitsMatchWhere(Post, phone);
  const savedFilterId = filterId != null ? Number(filterId) : null;
  const plainOrder = [
    ['scannedAt', 'DESC'],
    ['id', 'DESC'],
  ];

  const findPlain = (extraWhere) =>
    Post.findOne({
      where: andWhereClause(phoneWhere, extraWhere),
      order: plainOrder,
    });

  /** Bắt đầu từ filter_posts (filter_id) → JOIN posts — bài mới nhất trong bộ lọc. */
  const findViaFilterPosts = async (extraWhere) => {
    if (!savedFilterId) return null;
    const postPhoneWhere = phoneDigitsMatchWhereForAlias(Post, phone, FILTER_JOIN_POST_ALIAS);
    const postWhere = andWhereClause(postPhoneWhere, extraWhere);

    const link = await FilterPost.findOne({
      where: { filterId: savedFilterId },
      include: [
        {
          model: Post,
          as: FILTER_JOIN_POST_ALIAS,
          required: true,
          where: postWhere,
        },
      ],
      order: [
        [{ model: Post, as: FILTER_JOIN_POST_ALIAS }, 'scannedAt', 'DESC'],
        [{ model: Post, as: FILTER_JOIN_POST_ALIAS }, 'id', 'DESC'],
      ],
      subQuery: false,
    });

    return link?.post || null;
  };

  if (filterPostsOnly && savedFilterId) {
    let post = await findViaFilterPosts(listWhere);
    if (post) return post;
    return findViaFilterPosts(null);
  }

  // Ưu tiên: filter_posts + phạm vi → chỉ filter_posts → phạm vi posts → toàn DB
  let post = await findViaFilterPosts(listWhere);
  if (post) return post;
  post = await findViaFilterPosts(null);
  if (post) return post;
  if (listWhere) {
    post = await findPlain(listWhere);
    if (post) return post;
  }
  return findPlain(null);
}

function campaignRowNeedsMetadata(row) {
  const pub = toPublicCampaignPhone(row);
  return (
    !String(pub.postUrl || '').trim() &&
    !String(pub.groupName || '').trim() &&
    !String(pub.userName || '').trim()
  );
}

async function backfillCampaignPhoneMetadata(Post, rows, options = {}) {
  const updated = [];
  for (const row of rows) {
    if (!campaignRowNeedsMetadata(row)) {
      updated.push(row);
      continue;
    }
    const phone = toPublicCampaignPhone(row)?.phone || row.phone;
    const item = await enrichCampaignItemFromPost(Post, { phone }, options);
    const hasMeta =
      pickFilled(item.postUrl, null) ||
      pickFilled(item.groupName, null) ||
      pickFilled(item.userName, null);
    if (!hasMeta) {
      updated.push(row);
      continue;
    }
    await row.update({
      postId: pickFilled(item.postId, row.postId),
      postMessage: item.postMessage ?? row.postMessage,
      postUrl: pickFilled(item.postUrl, row.postUrl),
      groupId: pickFilled(item.groupId, row.groupId),
      groupName: pickFilled(item.groupName, row.groupName),
      fbUserId: pickFilled(item.fbUserId, row.fbUserId),
      userName: pickFilled(item.userName, row.userName),
      userUrl: pickFilled(item.userUrl, row.userUrl),
      thesame: pickFilled(item.thesame, row.thesame),
      createdTime: pickFilled(item.createdTime, row.createdTime),
      scannedAt: item.scannedAt ?? row.scannedAt,
      keyword: pickFilled(item.keyword, row.keyword),
    });
    updated.push(row);
  }
  return updated;
}

function campaignItemFromPostRow(item, post) {
  if (!post) {
    return {
      phone: item.phone,
      note: item.note ?? null,
      postId: pickFilled(item.postId, null),
      postMessage: item.postMessage ?? null,
      postUrl: pickFilled(item.postUrl, null),
      groupId: pickFilled(item.groupId, null),
      groupName: pickFilled(item.groupName, null),
      fbUserId: pickFilled(item.fbUserId, null),
      userName: pickFilled(item.userName, null),
      userUrl: pickFilled(item.userUrl, null),
      thesame: pickFilled(item.thesame, null),
      createdTime: pickFilled(item.createdTime, null),
      scannedAt:
        item.scannedAt != null && Number.isFinite(Number(item.scannedAt))
          ? Number(item.scannedAt)
          : null,
      keyword: pickFilled(item.keyword, null),
    };
  }

  const p = toPublicPost(post);
  return {
    phone: item.phone,
    note: item.note ?? null,
    postId: pickFilled(item.postId, p.postId),
    postMessage:
      item.postMessage != null && String(item.postMessage).trim()
        ? item.postMessage
        : p.postMessage,
    postUrl: pickFilled(item.postUrl, p.postUrl),
    groupId: pickFilled(item.groupId, p.groupId),
    groupName: pickFilled(item.groupName, p.groupName),
    fbUserId: pickFilled(item.fbUserId, p.userId),
    userName: pickFilled(item.userName, p.userName),
    userUrl: pickFilled(item.userUrl, p.userUrl),
    thesame: pickFilled(item.thesame, p.thesame),
    createdTime: pickFilled(item.createdTime, p.created_time),
    scannedAt:
      item.scannedAt != null && Number.isFinite(Number(item.scannedAt))
        ? Number(item.scannedAt)
        : p.scannedAt,
    keyword: pickFilled(item.keyword, p.keyword),
  };
}

/** Client chỉ gửi SĐT — server lấy metadata từ bài mới nhất (ưu tiên trong bộ lọc đang dùng). */
async function enrichCampaignItemFromPost(Post, item, options = {}) {
  const post = await findLatestPostForPhone(Post, item.phone, options);
  return campaignItemFromPostRow(item, post);
}

const CAMPAIGN_PUSH_BATCH_SIZE = 500;

async function resolveFilterPostsWhereForPush(enrichOptions, listQuery) {
  const filterId = parseFilterIdFromBody({ filterId: enrichOptions.filterId });
  if (!filterId) return null;
  const { assemblePostWhereForFilterJoin } = require('./postController');
  const applied = await assemblePostWhereForFilterJoin(listQuery || {}, filterId);
  return andWhereClause(applied.where, enrichOptions.listWhere);
}

async function executeAddPhonesForTask(task) {
  const id = task.campaignId;
  const enrichOptions = task._enrichOptions || {};
  const savedFilterId = parseFilterIdFromBody({ filterId: enrichOptions.filterId });
  if (savedFilterId) {
    enrichOptions.filterPostsOnly = true;
  }
  const useFilterPostsBatch = Boolean(savedFilterId && enrichOptions.filterPostsOnly);
  const { Campaign, CampaignPhone, Post } = getModels();
  const campaign = await Campaign.findByPk(id);
  if (!campaign) {
    throw new Error('Không tìm thấy chiến dịch');
  }

  const stepAdd = generateStepAdd(20);
  let added = 0;
  const duplicatePhones = [];
  const created = [];

  const existingInCampaign = new Set(
    (
      await CampaignPhone.findAll({
        where: { campaignId: id },
        attributes: ['phone'],
        raw: true,
      })
    )
      .map((row) => normalizePhone(row.phone))
      .filter(Boolean)
  );

  const syncDuplicateReport = () => {
    task.duplicateCount = duplicatePhones.length;
    task.alreadyInCampaign = duplicatePhones.slice(0, 30);
  };

  let filterPostsPostWhere = null;
  if (useFilterPostsBatch) {
    filterPostsPostWhere = await resolveFilterPostsWhereForPush(
      enrichOptions,
      task._listQuery || {}
    );
  }

  const {
    forEachCampaignPushPhone,
    forEachCampaignPushPhoneFromFilterPosts,
    fetchLatestPostsBatchViaFilterPosts,
  } = require('./postController');

  const processPhoneBatchFilterPosts = async (rawItems) => {
    if (!rawItems.length) return;

    const candidates = [];
    for (const rawItem of rawItems) {
      const phone = rawItem.phone;
      if (existingInCampaign.has(phone)) {
        duplicatePhones.push(phone);
        syncDuplicateReport();
      } else {
        candidates.push(rawItem);
      }
    }

    let postByPhone = new Map();
    if (candidates.length) {
      const withPk = candidates.filter((r) => r.postPk);
      const needLookup = candidates.filter((r) => !r.postPk);
      const postByPk = new Map();

      const pkList = [
        ...new Set(
          withPk.map((r) => Number(r.postPk)).filter((n) => Number.isFinite(n) && n > 0)
        ),
      ];
      if (pkList.length) {
        const posts = await Post.findAll({
          where: { id: { [Op.in]: pkList } },
          attributes: CAMPAIGN_PUSH_POST_ATTRIBUTES,
        });
        for (const p of posts) postByPk.set(p.id, p);
      }

      for (const raw of withPk) {
        const post = postByPk.get(Number(raw.postPk));
        if (post) postByPhone.set(raw.phone, post);
      }

      if (needLookup.length) {
        const extra = await fetchLatestPostsBatchViaFilterPosts(
          Post,
          savedFilterId,
          filterPostsPostWhere,
          needLookup.map((r) => r.phone)
        );
        postByPhone = new Map([...postByPhone, ...extra]);
      }
    }

    const insertRows = [];
    for (const rawItem of candidates) {
      const item = campaignItemFromPostRow(rawItem, postByPhone.get(rawItem.phone) || null);
      insertRows.push({
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
    }

    if (insertRows.length) {
      await CampaignPhone.bulkCreate(insertRows, {
        validate: false,
        ignoreDuplicates: true,
      });
      for (const row of insertRows) {
        existingInCampaign.add(row.phone);
        added += 1;
        if (created.length < 200) {
          created.push({
            phone: row.phone,
            userName: row.userName || '',
            groupName: row.groupName || '',
          });
        }
      }
      if (added && !task.stepAdd) task.stepAdd = stepAdd;
    }

    task.processed += rawItems.length;
    task.added = added;
  };

  const processOnePhone = async (rawItem) => {
    const phone = rawItem.phone;
    try {
      if (existingInCampaign.has(phone)) {
        duplicatePhones.push(phone);
        syncDuplicateReport();
      } else {
        const item = await enrichCampaignItemFromPost(Post, rawItem, enrichOptions);
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
          existingInCampaign.add(item.phone);
          if (!task.stepAdd) task.stepAdd = stepAdd;
        } catch (err) {
          if (err.name === 'SequelizeUniqueConstraintError') {
            duplicatePhones.push(item.phone);
            existingInCampaign.add(item.phone);
            syncDuplicateReport();
          } else {
            throw err;
          }
        }
      }
    } finally {
      task.processed += 1;
      task.added = added;
    }
  };

  task.processed = 0;
  task.phase = 'pushing';

  if (task._pushAll) {
    const estimated = Math.max(0, Number(task.total) || 0);
    const listQuery = {
      ...(task._listQuery || {}),
      _pushEstimatedTotal: estimated,
    };
    task.phase = useFilterPostsBatch && estimated > 0 ? 'pushing' : 'collecting';
    const iteratePhones = savedFilterId
      ? forEachCampaignPushPhoneFromFilterPosts
      : forEachCampaignPushPhone;

    const iterateOpts = {
      onTotalReady: (total) => {
        task.total = Math.max(0, Number(total) || 0);
        task.phase = 'pushing';
      },
      pushBatchSize: CAMPAIGN_PUSH_BATCH_SIZE,
    };
    if (useFilterPostsBatch) {
      iterateOpts.onPhoneBatch = processPhoneBatchFilterPosts;
    }

    await iteratePhones(listQuery, processOnePhone, iterateOpts);
    if (task.processed > 0) {
      task.total = Math.max(Number(task.total) || 0, task.processed);
    }
    delete task._pushAll;
    delete task._listQuery;
  } else {
    const items = task._items || [];
    task.total = items.length;
    if (useFilterPostsBatch) {
      for (let i = 0; i < items.length; i += CAMPAIGN_PUSH_BATCH_SIZE) {
        await processPhoneBatchFilterPosts(items.slice(i, i + CAMPAIGN_PUSH_BATCH_SIZE));
      }
    } else {
      for (const rawItem of items) {
        await processOnePhone(rawItem);
      }
    }
    delete task._items;
  }

  const dupCount = duplicatePhones.length;
  const dupText = dupCount ? ` · ${dupCount} số đã có` : '';
  if (added || dupCount) {
    const activityPayload = {
      type: 'campaign_phone',
      action: 'add',
      userId: task.userId,
      username: task.username,
      summary: `Chuyển ${added} SĐT vào “${campaign.name}”${dupText}`,
      detail: {
        campaignId: id,
        campaignName: campaign.name,
        added,
        duplicateCount: dupCount,
        phones: created.slice(0, 200).map((row) => ({
          phone: row.phone,
          userName: row.userName || '',
          groupName: row.groupName || '',
        })),
        alreadyInCampaign: duplicatePhones.slice(0, 80),
      },
    };
    setImmediate(() => {
      recordActivity(activityPayload).catch(() => {});
    });
  }

  task.status = 'done';
  task.finishedAt = Date.now();
  task.added = added;
  task.duplicateCount = dupCount;
  task.alreadyInCampaign = duplicatePhones.slice(0, 30);
  task.phase = 'done';
  if (added && !task.stepAdd) task.stepAdd = stepAdd;

  delete task._items;
  delete task._enrichOptions;
}

function listQueryFromPushBody(body = {}) {
  const q = {};
  const phone = String(body.phone || '').trim();
  if (phone) q.phone = phone;
  const groupId = String(body.groupId || '').trim();
  if (groupId) q.groupId = groupId;
  const filterId = parseFilterIdFromBody(body);
  if (filterId) q.filterId = String(filterId);
  if (body.paths != null && String(body.paths).trim()) {
    q.paths = body.paths;
  }
  if (body.pushedFrom) q.pushedFrom = body.pushedFrom;
  if (body.pushedTo) q.pushedTo = body.pushedTo;
  if (body.campaignId != null) q.campaignId = body.campaignId;
  if (body.campaignMembership) q.campaignMembership = body.campaignMembership;
  return q;
}

async function addPhones(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }

    const pushAll = Boolean(req.body.all || req.body.pushAll);
    const items = pushAll ? [] : normalizePhoneList(req.body);
    console.log('items', items);
    if (!pushAll && !items.length) {
      return res.status(400).json({ ok: false, error: 'Thiếu số điện thoại' });
    }

    const { Campaign } = getModels();
    const campaign = await Campaign.findByPk(id);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy chiến dịch' });
    }

    const filterId = parseFilterIdFromBody(req.body);
    const listWhere = buildListScopeFromPushBody(req.body);
    const enrichOptions = { filterId, listWhere };
    // Chọn từng SĐT + bộ lọc lưu: chỉ bài mới nhất trong filter_posts (giống đẩy tất cả).
    if (filterId) {
      enrichOptions.filterPostsOnly = true;
    }

    const { createCampaignPhonePushTask } = require('../jobs/campaignPhonePushTask');
    const task = createCampaignPhonePushTask({
      campaignId: id,
      campaignName: campaign.name,
      userId: req.user?.id ?? null,
      username: req.user?.username ?? null,
      items,
      enrichOptions,
      pushAll,
      listQuery: pushAll ? listQueryFromPushBody(req.body) : null,
      estimatedTotal: pushAll ? Number(req.body.estimatedTotal) || 0 : items.length,
    });

    res.status(202).json({
      ok: true,
      async: true,
      taskId: task.id,
      total: task.total,
      status: task.status,
      task,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không thêm được SĐT' });
  }
}

async function getPhonePushTask(req, res) {
  try {
    const { getCampaignPhonePushTask } = require('../jobs/campaignPhonePushTask');
    const task = getCampaignPhonePushTask(req.params.taskId, req.user?.id ?? null);
    if (!task) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy task' });
    }
    res.json({ ok: true, task });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không đọc được task' });
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
  getPhonePushTask,
  executeAddPhonesForTask,
  removePhone,
  markPhoneUsed,
  markPhonesUsed,
  undoStepAdd,
};
