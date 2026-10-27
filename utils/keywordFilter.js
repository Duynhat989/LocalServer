function safeParseJson(raw, fallback) {
  try {
    if (raw == null || raw === '') return fallback;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return fallback;
  }
}

function toPublicKeywordFilter(row) {
  if (!row) return null;
  const json = typeof row.toJSON === 'function' ? row.toJSON() : row;
  const nodes = safeParseJson(json.nodesJson ?? json.nodes_json, []);
  const edges = safeParseJson(json.edgesJson ?? json.edges_json, []);
  return {
    id: json.id,
    name: json.name || '',
    nodes: Array.isArray(nodes) ? nodes : [],
    edges: Array.isArray(edges) ? edges : [],
    created_at: json.created_at || json.createdAt || null,
    updated_at: json.updated_at || json.updatedAt || null,
  };
}

function normalizeKeywordFilterInput(body = {}) {
  const name = String(body.name || '').trim();
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const edges = Array.isArray(body.edges) ? body.edges : [];
  return {
    name,
    nodesJson: JSON.stringify(nodes),
    edgesJson: JSON.stringify(edges),
  };
}

module.exports = {
  toPublicKeywordFilter,
  normalizeKeywordFilterInput,
};
