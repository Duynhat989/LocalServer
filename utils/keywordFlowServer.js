const { toKeyword } = require('./text');

function buildAdj(edges) {
  const adj = new Map();
  for (const edge of edges || []) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source).push(edge.target);
  }
  return adj;
}

function findKeywordPaths(nodes, edges) {
  const nodeMap = new Map((nodes || []).map((n) => [n.id, n]));
  const adj = buildAdj(edges);
  const paths = [];

  function dfs(nodeId, trail, include, exclude) {
    if (nodeId === 'end') {
      if (include.length || exclude.length) {
        paths.push({ include: [...include], exclude: [...exclude] });
      }
      return;
    }
    for (const next of adj.get(nodeId) || []) {
      if (trail.has(next)) continue;
      const node = nodeMap.get(next);
      if (!node) continue;
      const nextTrail = new Set(trail);
      nextTrail.add(next);
      const nextInclude = [...include];
      const nextExclude = [...exclude];
      const label = String(node.data?.label || '').trim();
      if (label && node.type === 'keyword') nextInclude.push(label);
      if (label && node.type === 'exclude') nextExclude.push(label);
      dfs(next, nextTrail, nextInclude, nextExclude);
    }
  }

  dfs('start', new Set(['start']), [], []);
  return paths;
}

function pathsFromFilterRow(filterRow) {
  if (!filterRow) return [];
  let nodes = [];
  let edges = [];
  try {
    nodes =
      typeof filterRow.nodesJson === 'string'
        ? JSON.parse(filterRow.nodesJson || '[]')
        : filterRow.nodesJson || [];
    edges =
      typeof filterRow.edgesJson === 'string'
        ? JSON.parse(filterRow.edgesJson || '[]')
        : filterRow.edgesJson || [];
  } catch {
    return [];
  }
  if (!Array.isArray(nodes)) nodes = [];
  if (!Array.isArray(edges)) edges = [];
  return findKeywordPaths(nodes, edges);
}

function matchHaystackAgainstPaths(haystack, paths) {
  if (!paths?.length) return true;
  const text = toKeyword(haystack);
  if (!text) return false;
  return paths.some((path) => {
    const include = Array.isArray(path) ? path : path.include || [];
    const exclude = Array.isArray(path) ? [] : path.exclude || [];
    const hasAll = include.every((keyword) => {
      const needle = toKeyword(keyword);
      return needle && text.includes(needle);
    });
    const hasBlocked = exclude.some((keyword) => {
      const needle = toKeyword(keyword);
      return needle && text.includes(needle);
    });
    return hasAll && !hasBlocked;
  });
}

function postMatchesFilter(post, paths) {
  const keyword = post?.keyword ?? post?.get?.('keyword') ?? '';
  return matchHaystackAgainstPaths(keyword, paths);
}

module.exports = {
  findKeywordPaths,
  pathsFromFilterRow,
  matchHaystackAgainstPaths,
  postMatchesFilter,
};
