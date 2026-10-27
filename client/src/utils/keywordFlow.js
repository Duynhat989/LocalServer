export function removeDiacritics(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function toKeyword(input) {
  return removeDiacritics(input).toLowerCase();
}

export function createDefaultFlow() {
  return {
    nodes: [
      {
        id: 'start',
        type: 'start',
        position: { x: 40, y: 160 },
        data: { label: 'START' },
        deletable: false,
        draggable: true,
      },
      {
        id: 'end',
        type: 'end',
        position: { x: 520, y: 160 },
        data: { label: 'END' },
        deletable: false,
        draggable: true,
      },
    ],
    edges: [],
  };
}

function buildAdj(edges) {
  const adj = new Map();
  for (const edge of edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source).push(edge.target);
  }
  return adj;
}

export function canReach(fromId, toId, edges) {
  if (fromId === toId) return true;
  const adj = buildAdj(edges);
  const seen = new Set([fromId]);
  const stack = [fromId];
  while (stack.length) {
    const cur = stack.pop();
    for (const next of adj.get(cur) || []) {
      if (next === toId) return true;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

export function wouldCreateCycle(source, target, edges) {
  if (source === target) return true;
  return canReach(target, source, edges);
}

export function findKeywordPaths(nodes, edges) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const adj = buildAdj(edges);
  const paths = [];

  function dfs(nodeId, trail, keywords) {
    if (nodeId === 'end') {
      if (keywords.length) paths.push([...keywords]);
      return;
    }
    for (const next of adj.get(nodeId) || []) {
      if (trail.has(next)) continue;
      const node = nodeMap.get(next);
      if (!node) continue;
      const nextTrail = new Set(trail);
      nextTrail.add(next);
      const nextKeywords = [...keywords];
      if (node.type === 'keyword') {
        const label = String(node.data?.label || '').trim();
        if (label) nextKeywords.push(label);
      }
      dfs(next, nextTrail, nextKeywords);
    }
  }

  dfs('start', new Set(['start']), []);
  return paths;
}

export function formatPathsExpression(paths) {
  if (!paths.length) return '';
  return paths
    .map((path) => path.map((k) => `"${k}"`).join(' AND '))
    .join('  OR  ');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchHaystackAgainstPaths(haystack, paths) {
  if (!paths.length) return true;
  const text = toKeyword(haystack);
  if (!text) return false;
  return paths.some((path) =>
    path.every((keyword) => {
      const needle = toKeyword(keyword);
      if (!needle) return false;
      const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(needle)}(?=$|[^a-z0-9])`);
      return re.test(text);
    })
  );
}

export function serializeFlow(nodes, edges) {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { label: n.data?.label || '' },
      deletable: n.deletable !== false && n.type === 'keyword',
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };
}

export function parseFlow(raw) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data?.nodes?.length) return createDefaultFlow();
    const hasStart = data.nodes.some((n) => n.id === 'start' || n.type === 'start');
    const hasEnd = data.nodes.some((n) => n.id === 'end' || n.type === 'end');
    if (!hasStart || !hasEnd) return createDefaultFlow();
    return {
      nodes: data.nodes.map((n) => ({
        ...n,
        deletable: n.type === 'keyword',
        data: {
          label:
            n.data?.label ||
            (n.type === 'start' ? 'START' : n.type === 'end' ? 'END' : ''),
        },
      })),
      edges: Array.isArray(data.edges) ? data.edges : [],
    };
  } catch {
    return createDefaultFlow();
  }
}

export const ACTIVE_FILTER_KEY = 'localserver_posts_active_filter_id';

export function getActiveFilterId() {
  const raw = localStorage.getItem(ACTIVE_FILTER_KEY);
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

export function setActiveFilterId(id) {
  if (id == null || id === '') {
    localStorage.removeItem(ACTIVE_FILTER_KEY);
    return null;
  }
  localStorage.setItem(ACTIVE_FILTER_KEY, String(id));
  return Number(id);
}

export function getActiveFilterPaths(filters, activeId) {
  if (activeId == null) return [];
  const item = (filters || []).find((i) => Number(i.id) === Number(activeId));
  if (!item) return [];
  return findKeywordPaths(item.nodes || [], item.edges || []);
}
