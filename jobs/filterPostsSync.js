const { Op } = require('sequelize');
const { getModels } = require('../models');
const { pathsFromFilterRow, postMatchesFilter } = require('../utils/keywordFlowServer');

const BATCH = 500;
const pendingByFilter = new Map();
let workerRunning = false;

async function readGeneration(filterId) {
  const { KeywordFilter } = getModels();
  const row = await KeywordFilter.findByPk(filterId, {
    attributes: ['syncGeneration'],
  });
  return Number(row?.syncGeneration) || 0;
}

async function isGenerationCurrent(filterId, generation) {
  return (await readGeneration(filterId)) === generation;
}

async function bumpAndClearFilter(filterId) {
  const { KeywordFilter, FilterPost, sequelize } = getModels();
  return sequelize.transaction(async (transaction) => {
    const row = await KeywordFilter.findByPk(filterId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!row) return null;

    const generation = (Number(row.syncGeneration) || 0) + 1;
    await row.update(
      {
        syncGeneration: generation,
        syncStatus: 'running',
        syncStartedAt: new Date(),
        syncFinishedAt: null,
        syncProcessed: 0,
        syncMatched: 0,
        syncError: null,
      },
      { transaction }
    );
    await FilterPost.destroy({ where: { filterId }, transaction });
    return generation;
  });
}

async function finishSync(filterId, generation, { cancelled, errorMessage }) {
  const { KeywordFilter } = getModels();
  if (!(await isGenerationCurrent(filterId, generation))) return;

  if (cancelled) {
    await KeywordFilter.update(
      {
        syncStatus: 'idle',
        syncFinishedAt: new Date(),
        syncError: null,
      },
      { where: { id: filterId, syncGeneration: generation } }
    );
    return;
  }

  await KeywordFilter.update(
    {
      syncStatus: errorMessage ? 'failed' : 'idle',
      syncFinishedAt: new Date(),
      syncError: errorMessage || null,
    },
    { where: { id: filterId, syncGeneration: generation } }
  );
}

async function runFullRescan(filterId, generation) {
  const { KeywordFilter, Post, FilterPost } = getModels();
  const filter = await KeywordFilter.findByPk(filterId);
  if (!filter || !(await isGenerationCurrent(filterId, generation))) {
    return { cancelled: true };
  }

  const paths = pathsFromFilterRow(filter);
  if (!paths.length) {
    await finishSync(filterId, generation, { cancelled: false });
    return { ok: true, matched: 0 };
  }

  let lastId = 0;
  let processed = 0;
  let matched = 0;

  try {
    while (true) {
      if (!(await isGenerationCurrent(filterId, generation))) {
        await finishSync(filterId, generation, { cancelled: true });
        console.log(`[filter-sync] Hủy filter #${filterId} gen=${generation}`);
        return { cancelled: true };
      }

      const rows = await Post.findAll({
        where: { id: { [Op.gt]: lastId } },
        order: [['id', 'ASC']],
        limit: BATCH,
        attributes: ['id', 'keyword'],
      });
      if (!rows.length) break;

      const inserts = [];
      for (const row of rows) {
        if (postMatchesFilter(row, paths)) {
          inserts.push({ filterId, postId: row.id });
        }
      }
      if (inserts.length) {
        await FilterPost.bulkCreate(inserts, { ignoreDuplicates: true });
        matched += inserts.length;
      }

      processed += rows.length;
      lastId = rows[rows.length - 1].id;

      await KeywordFilter.update(
        { syncProcessed: processed, syncMatched: matched },
        { where: { id: filterId, syncGeneration: generation } }
      );
    }

    await finishSync(filterId, generation, { cancelled: false });
    console.log(
      `[filter-sync] Xong filter #${filterId} gen=${generation}: ${matched}/${processed} khớp`
    );
    return { ok: true, matched, processed };
  } catch (err) {
    const msg = err.message || String(err);
    console.error(`[filter-sync] Lỗi filter #${filterId}:`, msg);
    if (await isGenerationCurrent(filterId, generation)) {
      await finishSync(filterId, generation, { cancelled: false, errorMessage: msg });
    }
    return { error: msg };
  }
}

function enqueueResync(filterId, generation) {
  pendingByFilter.set(filterId, generation);
  setImmediate(() => drainWorker());
}

async function drainWorker() {
  if (workerRunning) return;
  if (pendingByFilter.size === 0) return;

  workerRunning = true;
  try {
    while (pendingByFilter.size > 0) {
      const entry = pendingByFilter.entries().next().value;
      if (!entry) break;
      const [filterId, generation] = entry;
      pendingByFilter.delete(filterId);

      const currentGen = await readGeneration(filterId);
      if (currentGen !== generation) {
        if (pendingByFilter.has(filterId)) continue;
        continue;
      }

      await runFullRescan(filterId, generation);

      if (pendingByFilter.has(filterId)) {
        continue;
      }
    }
  } finally {
    workerRunning = false;
    if (pendingByFilter.size > 0) setImmediate(() => drainWorker());
  }
}

/**
 * Sau khi lưu / sửa bộ lọc: xóa filter_posts, tăng generation, chạy full rescan nền.
 */
async function scheduleFilterFullSync(filterId) {
  const id = Number(filterId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const generation = await bumpAndClearFilter(id);
  if (generation == null) return null;
  enqueueResync(id, generation);
  return generation;
}

let filtersCache = { at: 0, rows: [] };
const CACHE_MS = 60_000;

async function loadFiltersForMatch() {
  const now = Date.now();
  if (now - filtersCache.at < CACHE_MS && filtersCache.rows.length) {
    return filtersCache.rows;
  }
  const { KeywordFilter } = getModels();
  const rows = await KeywordFilter.findAll({
    attributes: ['id', 'nodesJson', 'edgesJson'],
  });
  const compiled = rows
    .map((row) => ({
      id: row.id,
      paths: pathsFromFilterRow(row),
    }))
    .filter((f) => f.paths.length);
  filtersCache = { at: now, rows: compiled };
  return compiled;
}

function invalidateFiltersCache() {
  filtersCache = { at: 0, rows: [] };
}

async function attachPostsToFilters(postRows) {
  if (!postRows?.length) return;
  const { FilterPost } = getModels();
  const filters = await loadFiltersForMatch();
  if (!filters.length) return;

  const inserts = [];
  for (const post of postRows) {
    const postId = Number(post.id);
    if (!Number.isFinite(postId)) continue;
    for (const filter of filters) {
      if (postMatchesFilter(post, filter.paths)) {
        inserts.push({ filterId: filter.id, postId });
      }
    }
  }
  if (!inserts.length) return;

  for (let i = 0; i < inserts.length; i += 200) {
    await FilterPost.bulkCreate(inserts.slice(i, i + 200), { ignoreDuplicates: true });
  }
}

function queueAttachPosts(postRows) {
  attachPostsToFilters(postRows).catch((err) => {
    console.error('[filter-sync] attach posts:', err.message || err);
  });
}

async function getFilterSyncPublic(filterId) {
  const { KeywordFilter, Post } = getModels();
  const id = Number(filterId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = await KeywordFilter.findByPk(id, {
    attributes: [
      'id',
      'syncGeneration',
      'syncStatus',
      'syncStartedAt',
      'syncFinishedAt',
      'syncProcessed',
      'syncMatched',
      'syncError',
    ],
  });
  if (!row) return null;
  const totalPosts = await Post.count();
  const json = row.toJSON();
  return {
    filterId: json.id,
    status: json.syncStatus || 'idle',
    generation: Number(json.syncGeneration) || 0,
    startedAt: json.syncStartedAt,
    finishedAt: json.syncFinishedAt,
    processed: Number(json.syncProcessed) || 0,
    matched: Number(json.syncMatched) || 0,
    totalPosts,
    error: json.syncError || null,
  };
}

async function recoverStaleRunningFilters() {
  const { KeywordFilter } = getModels();
  const rows = await KeywordFilter.findAll({
    where: { syncStatus: 'running' },
    attributes: ['id'],
  });
  for (const row of rows) {
    await scheduleFilterFullSync(row.id);
  }
}

async function bootstrapEmptyFilterIndexes() {
  const { KeywordFilter, FilterPost } = getModels();
  const filters = await KeywordFilter.findAll({ attributes: ['id', 'syncStatus'] });
  for (const filter of filters) {
    const count = await FilterPost.count({ where: { filterId: filter.id } });
    if (count === 0 && filter.syncStatus !== 'running') {
      await scheduleFilterFullSync(filter.id);
    }
  }
}

function startFilterPostsSyncWorker() {
  recoverStaleRunningFilters()
    .then(() => bootstrapEmptyFilterIndexes())
    .catch((err) => {
      console.error('[filter-sync] bootstrap:', err.message || err);
    });
  console.log('[filter-sync] Worker sẵn sàng');
}

function stopFilterPostsSyncWorker() {
  pendingByFilter.clear();
}

module.exports = {
  scheduleFilterFullSync,
  queueAttachPosts,
  invalidateFiltersCache,
  getFilterSyncPublic,
  startFilterPostsSyncWorker,
  stopFilterPostsSyncWorker,
};
