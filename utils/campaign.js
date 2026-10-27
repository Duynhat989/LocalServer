const crypto = require('crypto');

const CAMPAIGN_STATUSES = ['active', 'paused', 'done'];
const STEP_ADD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function normalizePhone(input) {
  return String(input || '')
    .replace(/[^\d+]/g, '')
    .trim();
}

function generateStepAdd(length = 20) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += STEP_ADD_CHARS[bytes[i] % STEP_ADD_CHARS.length];
  }
  return out;
}

function toPublicCampaignPhone(row) {
  if (!row) return null;
  const json = typeof row.toJSON === 'function' ? row.toJSON() : row;
  return {
    id: json.id,
    campaignId: json.campaignId,
    phone: json.phone,
    stepAdd: json.stepAdd || json.step_add || '',
    postId: json.postId || json.post_id || '',
    postMessage: json.postMessage || json.post_message || '',
    postUrl: json.postUrl || json.post_url || '',
    groupId: json.groupId || json.group_id || '',
    groupName: json.groupName || json.group_name || '',
    userId: json.fbUserId || json.fb_user_id || json.userId || '',
    userName: json.userName || json.user_name || '',
    userUrl: json.userUrl || json.user_url || '',
    thesame: json.thesame || '',
    created_time: json.createdTime || json.created_time || '',
    scannedAt: json.scannedAt ?? json.scanned_at ?? null,
    keyword: json.keyword || '',
    note: json.note || '',
    isUsed: Boolean(json.isUsed ?? json.is_used),
    created_at: json.created_at || json.createdAt || null,
  };
}

function toPublicCampaign(campaign, phoneCount, unusedCount) {
  if (!campaign) return null;
  const json = typeof campaign.toJSON === 'function' ? campaign.toJSON() : campaign;
  const phones = Array.isArray(json.phones)
    ? json.phones.map(toPublicCampaignPhone)
    : undefined;

  const resolvedPhoneCount =
    typeof phoneCount === 'number'
      ? phoneCount
      : phones
        ? phones.length
        : typeof json.phoneCount === 'number'
          ? json.phoneCount
          : 0;

  const resolvedUnusedCount =
    typeof unusedCount === 'number'
      ? unusedCount
      : phones
        ? phones.filter((p) => !p.isUsed).length
        : typeof json.unusedCount === 'number'
          ? json.unusedCount
          : undefined;

  return {
    id: json.id,
    name: json.name,
    status: json.status || 'active',
    note: json.note || '',
    phoneCount: resolvedPhoneCount,
    unusedCount: resolvedUnusedCount,
    phones,
    created_at: json.created_at || json.createdAt || null,
    updated_at: json.updated_at || json.updatedAt || null,
  };
}

function normalizeCampaignInput(body = {}) {
  let status = String(body.status || 'active').trim().toLowerCase();
  if (!CAMPAIGN_STATUSES.includes(status)) status = 'active';

  return {
    name: String(body.name || '').trim(),
    status,
    note: body.note != null ? String(body.note).trim() : null,
  };
}

function pickText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeCampaignPhoneItem(item = {}, fallbackNote = null) {
  const phone = normalizePhone(
    typeof item === 'object' && item ? item.phone : item
  );
  if (!phone) return null;

  const source = typeof item === 'object' && item ? item : {};

  return {
    phone,
    postId: pickText(source.postId),
    postMessage: source.postMessage != null ? String(source.postMessage) : null,
    postUrl: pickText(source.postUrl),
    groupId: pickText(source.groupId),
    groupName: pickText(source.groupName),
    fbUserId: pickText(source.userId || source.fbUserId),
    userName: pickText(source.userName),
    userUrl: pickText(source.userUrl),
    thesame: pickText(source.thesame),
    createdTime: pickText(source.created_time || source.createdTime),
    scannedAt:
      source.scannedAt != null && Number.isFinite(Number(source.scannedAt))
        ? Number(source.scannedAt)
        : null,
    keyword: pickText(source.keyword),
    note:
      source.note != null
        ? String(source.note).trim() || null
        : fallbackNote,
  };
}

function normalizePhoneList(body = {}) {
  const note = body.note != null ? String(body.note).trim() : null;
  const raw = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.phones)
      ? body.phones
      : body.phone != null
        ? [body.phone]
        : typeof body.text === 'string'
          ? body.text.split(/[\n,;]+/)
          : [];

  const seen = new Set();
  const phones = [];

  for (const item of raw) {
    const row = normalizeCampaignPhoneItem(item, note);
    if (!row || seen.has(row.phone)) continue;
    seen.add(row.phone);
    phones.push(row);
  }

  return phones;
}

module.exports = {
  CAMPAIGN_STATUSES,
  normalizePhone,
  generateStepAdd,
  toPublicCampaign,
  toPublicCampaignPhone,
  normalizeCampaignInput,
  normalizePhoneList,
  normalizeCampaignPhoneItem,
};
