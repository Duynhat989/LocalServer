const { buildPostKeyword } = require('./text');

function toPublicPost(post) {
  if (!post) return null;
  const json = typeof post.toJSON === 'function' ? post.toJSON() : post;
  return {
    id: json.id,
    postId: json.postId,
    postMessage: json.postMessage,
    postUrl: json.postUrl,
    groupId: json.groupId,
    groupName: json.groupName,
    userId: json.fbUserId || json.userId,
    userName: json.userName,
    userUrl: json.userUrl,
    phone: json.phone,
    thesame: json.thesame,
    created_time: json.createdTime || json.created_time,
    scannedAt: json.scannedAt,
    keyword: json.keyword || '',
  };
}

/** Danh sách bài — bỏ TEXT nặng; loadPhase=bodies bổ sung sau. */
function toPublicPostLite(post) {
  const row = toPublicPost(post);
  if (!row) return null;
  return {
    ...row,
    postMessage: null,
    keyword: null,
  };
}

function normalizePostInput(body = {}) {
  const payload = {
    postId: String(body.postId || '').trim(),
    postMessage: body.postMessage != null ? String(body.postMessage) : null,
    postUrl: body.postUrl != null ? String(body.postUrl) : null,
    groupId: body.groupId != null ? String(body.groupId) : null,
    groupName: body.groupName != null ? String(body.groupName) : null,
    fbUserId:
      body.userId != null
        ? String(body.userId)
        : body.fbUserId != null
          ? String(body.fbUserId)
          : null,
    userName: body.userName != null ? String(body.userName) : null,
    userUrl: body.userUrl != null ? String(body.userUrl) : null,
    phone: body.phone != null ? String(body.phone) : null,
    thesame: body.thesame != null ? String(body.thesame) : null,
    createdTime: body.created_time || body.createdTime || null,
    scannedAt: body.scannedAt != null ? Number(body.scannedAt) : null,
  };

  payload.keyword = buildPostKeyword(payload);

  return payload;
}

const POST_LIST_LITE_ATTRIBUTES = [
  'id',
  'postId',
  'postUrl',
  'groupId',
  'groupName',
  'fbUserId',
  'userName',
  'userUrl',
  'phone',
  'thesame',
  'createdTime',
  'scannedAt',
];

module.exports = {
  toPublicPost,
  toPublicPostLite,
  normalizePostInput,
  POST_LIST_LITE_ATTRIBUTES,
};
