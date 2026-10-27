function toPublicUser(user) {
  if (!user) return null;
  const json = typeof user.toJSON === 'function' ? user.toJSON() : user;
  return {
    id: json.id,
    username: json.username,
    role: json.role,
    locked: Boolean(json.locked),
    created_at: json.createdAt || json.created_at,
  };
}

module.exports = { toPublicUser };
