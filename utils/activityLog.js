const { getModels } = require('../models');

function safeDetail(detail) {
  if (!detail || typeof detail !== 'object') return null;
  try {
    return JSON.stringify(detail);
  } catch {
    return null;
  }
}

function parseDetail(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function toPublicActivity(row) {
  const json = typeof row.toJSON === 'function' ? row.toJSON() : row;
  return {
    id: json.id,
    type: json.type,
    action: json.action,
    userId: json.userId ?? json.user_id ?? null,
    username: json.username || '',
    summary: json.summary || '',
    detail: parseDetail(json.detailJson ?? json.detail_json),
    created_at: json.created_at || json.createdAt || null,
  };
}

async function recordActivity({ type, action, userId, username, summary, detail }) {
  try {
    const { ActivityLog } = getModels();
    await ActivityLog.create({
      type: String(type || '').slice(0, 32),
      action: String(action || type || '').slice(0, 32),
      userId: userId == null ? null : Number(userId) || null,
      username: String(username || '').slice(0, 64),
      summary: String(summary || '').slice(0, 1000),
      detailJson: safeDetail(detail),
    });
  } catch (err) {
    console.error('Không ghi được lịch sử:', err.message || err);
  }
}

module.exports = {
  recordActivity,
  toPublicActivity,
};
