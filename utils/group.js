const GROUP_STATUSES = ['pending', 'active', 'paused', 'done', 'error'];
const STOP_REASONS = ['exhausted', 'cutoff', 'duplicate_streak', 'error', 'manual', 'cancelled'];

function extractUidFromLink(link) {
  const raw = String(link || '').trim();
  if (!raw) return '';

  const patterns = [
    /facebook\.com\/groups\/([^/?#]+)/i,
    /fb\.com\/groups\/([^/?#]+)/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }
  return '';
}

function toPublicGroup(group, stats = null) {
  if (!group) return null;
  const json = typeof group.toJSON === 'function' ? group.toJSON() : group;
  const now = Date.now();
  const availableAt = json.availableAt ?? json.available_at ?? null;
  const status = json.status || 'pending';
  const isAvailable =
    status === 'pending' ||
    (status === 'done' && (availableAt == null || Number(availableAt) <= now));

  const postCount =
    stats && Number.isFinite(Number(stats.postCount))
      ? Number(stats.postCount)
      : typeof json.postCount === 'number'
        ? json.postCount
        : 0;
  const phoneCount =
    stats && Number.isFinite(Number(stats.phoneCount))
      ? Number(stats.phoneCount)
      : typeof json.phoneCount === 'number'
        ? json.phoneCount
        : 0;

  return {
    id: json.id,
    uid: json.uid,
    name: json.name || '',
    link: json.link || '',
    status: json.status || 'pending',
    scannedAt: json.scannedAt ?? null,
    claimedAt: json.claimedAt ?? json.claimed_at ?? null,
    claimedBy: json.claimedBy || json.claimed_by || '',
    availableAt,
    lastStopReason: json.lastStopReason || json.last_stop_reason || '',
    note: json.note || '',
    isAvailable,
    postCount,
    phoneCount,
    created_at: json.created_at || json.createdAt || null,
    updated_at: json.updated_at || json.updatedAt || null,
  };
}

function normalizeGroupInput(body = {}) {
  let uid = String(body.uid || '').trim();
  const link = body.link != null ? String(body.link).trim() : '';
  if (!uid && link) {
    uid = extractUidFromLink(link);
  }

  let status = String(body.status || 'pending').trim().toLowerCase();
  if (!GROUP_STATUSES.includes(status)) {
    status = 'pending';
  }

  let scannedAt = null;
  if (body.scannedAt != null && body.scannedAt !== '') {
    const n = Number(body.scannedAt);
    scannedAt = Number.isFinite(n) ? n : null;
  }

  let availableAt = undefined;
  if (body.availableAt !== undefined) {
    if (body.availableAt == null || body.availableAt === '') availableAt = null;
    else {
      const n = Number(body.availableAt);
      availableAt = Number.isFinite(n) ? n : null;
    }
  }

  const payload = {
    uid,
    name: body.name != null ? String(body.name).trim() : null,
    link: link || (uid ? `https://www.facebook.com/groups/${uid}` : null),
    status,
    scannedAt,
    ...(availableAt !== undefined ? { availableAt } : {}),
    note: body.note != null ? String(body.note).trim() : null,
  };

  if (body.claimedAt !== undefined) {
    if (body.claimedAt == null || body.claimedAt === '') payload.claimedAt = null;
    else {
      const n = Number(body.claimedAt);
      payload.claimedAt = Number.isFinite(n) ? n : null;
    }
  }
  if (body.claimedBy !== undefined) {
    payload.claimedBy =
      body.claimedBy == null ? null : String(body.claimedBy).trim() || null;
  }

  return payload;
}

module.exports = {
  GROUP_STATUSES,
  STOP_REASONS,
  extractUidFromLink,
  toPublicGroup,
  normalizeGroupInput,
};
