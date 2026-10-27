const { getModels } = require('../models');
const { recordActivity } = require('../utils/activityLog');

function filterKeywords(nodesJson) {
  try {
    const nodes = JSON.parse(nodesJson || '[]');
    if (!Array.isArray(nodes)) return [];
    return nodes
      .filter((node) => node && node.type === 'keyword')
      .map((node) => String(node.data?.label || '').trim())
      .filter(Boolean)
      .slice(0, 40);
  } catch {
    return [];
  }
}
const {
  toPublicKeywordFilter,
  normalizeKeywordFilterInput,
} = require('../utils/keywordFilter');

async function listFilters(req, res, next) {
  try {
    const { KeywordFilter } = getModels();
    const rows = await KeywordFilter.findAll({ order: [['id', 'DESC']] });
    res.json({ ok: true, filters: rows.map(toPublicKeywordFilter) });
  } catch (err) {
    next(err);
  }
}

async function getFilter(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }
    const { KeywordFilter } = getModels();
    const row = await KeywordFilter.findByPk(id);
    if (!row) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy bộ lọc' });
    }
    res.json({ ok: true, filter: toPublicKeywordFilter(row) });
  } catch (err) {
    next(err);
  }
}

async function createFilter(req, res) {
  try {
    const payload = normalizeKeywordFilterInput(req.body);
    if (!payload.name) {
      return res.status(400).json({ ok: false, error: 'Thiếu tên bộ lọc' });
    }
    const { KeywordFilter } = getModels();
    const row = await KeywordFilter.create(payload);
    await recordActivity({
      type: 'filter',
      action: 'create',
      userId: req.user?.id,
      username: req.user?.username,
      summary: `Tạo bộ lọc “${payload.name}”`,
      detail: {
        filterId: row.id,
        name: payload.name,
        keywords: filterKeywords(payload.nodesJson),
      },
    });
    res.status(201).json({ ok: true, filter: toPublicKeywordFilter(row) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không tạo được bộ lọc' });
  }
}

async function updateFilter(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }
    const { KeywordFilter } = getModels();
    const row = await KeywordFilter.findByPk(id);
    if (!row) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy bộ lọc' });
    }

    const current = toPublicKeywordFilter(row);
    const payload = normalizeKeywordFilterInput({
      name: req.body.name != null ? req.body.name : current.name,
      nodes: req.body.nodes != null ? req.body.nodes : current.nodes,
      edges: req.body.edges != null ? req.body.edges : current.edges,
    });
    if (!payload.name) {
      return res.status(400).json({ ok: false, error: 'Thiếu tên bộ lọc' });
    }

    const previousName = current.name;
    await row.update(payload);
    const renamed = previousName && previousName !== payload.name;
    await recordActivity({
      type: 'filter',
      action: 'update',
      userId: req.user?.id,
      username: req.user?.username,
      summary: renamed
        ? `Sửa bộ lọc “${previousName}” thành “${payload.name}”`
        : `Sửa bộ lọc “${payload.name}”`,
      detail: {
        filterId: row.id,
        name: payload.name,
        previousName: renamed ? previousName : null,
        keywords: filterKeywords(payload.nodesJson),
      },
    });
    res.json({ ok: true, filter: toPublicKeywordFilter(row) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không cập nhật được bộ lọc' });
  }
}

async function deleteFilter(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }
    const { KeywordFilter } = getModels();
    const row = await KeywordFilter.findByPk(id);
    if (!row) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy bộ lọc' });
    }
    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không xóa được bộ lọc' });
  }
}

module.exports = {
  listFilters,
  getFilter,
  createFilter,
  updateFilter,
  deleteFilter,
};
