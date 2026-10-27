const crypto = require('crypto');
const { getModels } = require('../models');

function toPublicApiKey(row, { includeKey = false } = {}) {
  if (!row) return null;
  const json = typeof row.toJSON === 'function' ? row.toJSON() : row;
  return {
    id: json.id,
    name: json.name,
    keyPrefix: json.keyPrefix || json.key_prefix,
    key: includeKey ? json.key : undefined,
    lastUsedAt: json.lastUsedAt || json.last_used_at || null,
    created_at: json.created_at || json.createdAt || null,
  };
}

function generateApiKey() {
  const body = crypto.randomBytes(24).toString('hex');
  return `ls_${body}`;
}

async function listApiKeys(req, res, next) {
  try {
    const { ApiKey } = getModels();
    const rows = await ApiKey.findAll({
      where: { userId: req.user.id },
      order: [['id', 'DESC']],
    });
    res.json({
      ok: true,
      apiKeys: rows.map((row) => toPublicApiKey(row)),
    });
  } catch (err) {
    next(err);
  }
}

async function createApiKey(req, res, next) {
  try {
    const name = String(req.body?.name || '').trim() || 'API Key';
    if (name.length > 120) {
      return res.status(400).json({ ok: false, error: 'Tên API key tối đa 120 ký tự' });
    }

    const { ApiKey } = getModels();
    const key = generateApiKey();
    const row = await ApiKey.create({
      userId: req.user.id,
      name,
      key,
      keyPrefix: `${key.slice(0, 10)}…`,
    });

    res.status(201).json({
      ok: true,
      apiKey: toPublicApiKey(row, { includeKey: true }),
      message: 'Đã tạo API key. Hãy sao chép ngay — chỉ hiện một lần.',
    });
  } catch (err) {
    next(err);
  }
}

async function deleteApiKey(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }

    const { ApiKey } = getModels();
    const row = await ApiKey.findOne({
      where: { id, userId: req.user.id },
    });
    if (!row) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy API key' });
    }

    await row.destroy();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listApiKeys,
  createApiKey,
  deleteApiKey,
};
