const crypto = require('crypto');
const { Sequelize } = require('sequelize');
const { getModels } = require('../models');
const { hashPassword, verifyPassword } = require('../utils/password');
const { createSessionJwt, verifyJwt, isJwtShape } = require('../utils/jwt');
const { toPublicUser } = require('../utils/user');
const { recordActivity } = require('../utils/activityLog');

async function findUserByUsername(username) {
  const { User } = getModels();
  return User.findOne({
    where: Sequelize.where(
      Sequelize.fn('lower', Sequelize.col('username')),
      String(username || '').trim().toLowerCase()
    ),
  });
}

async function login(req, res, next) {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Thiếu tên đăng nhập hoặc mật khẩu' });
    }

    const user = await findUserByUsername(username);
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      return res.status(401).json({ ok: false, error: 'Sai tên đăng nhập hoặc mật khẩu' });
    }
    if (user.locked) {
      return res.status(403).json({ ok: false, error: 'Tài khoản đã bị khóa' });
    }

    const { Session } = getModels();
    const jti = crypto.randomBytes(16).toString('hex');
    const token = createSessionJwt({
      userId: user.id,
      username: user.username,
      role: user.role,
      jti,
    });

    await Session.create({
      token,
      userId: user.id,
      jti,
    });

    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
      .split(',')[0]
      .trim();
    await recordActivity({
      type: 'login',
      action: 'login',
      userId: user.id,
      username: user.username,
      summary: 'Đăng nhập',
      detail: ip ? { ip } : null,
    });

    res.json({
      ok: true,
      token,
      user: toPublicUser(user),
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const { Session } = getModels();
    if (req.token && req.authType !== 'apiKey') {
      await Session.destroy({ where: { token: req.token } });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

function me(req, res) {
  res.json({ ok: true, user: req.user });
}

async function changePassword(req, res, next) {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: 'Thiếu mật khẩu hiện tại hoặc mật khẩu mới' });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ ok: false, error: 'Mật khẩu mới tối thiểu 4 ký tự' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ ok: false, error: 'Mật khẩu mới phải khác mật khẩu hiện tại' });
    }

    const { User } = getModels();
    const dbUser = await User.findByPk(req.user.id);
    if (!dbUser) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy tài khoản' });
    }
    if (!verifyPassword(currentPassword, dbUser.passwordSalt, dbUser.passwordHash)) {
      return res.status(401).json({ ok: false, error: 'Mật khẩu hiện tại không đúng' });
    }

    const { salt, hash } = hashPassword(newPassword);
    dbUser.passwordHash = hash;
    dbUser.passwordSalt = salt;
    await dbUser.save();

    res.json({ ok: true, message: 'Đổi mật khẩu thành công' });
  } catch (err) {
    next(err);
  }
}

async function resolveUserFromSessionToken(token) {
  const { User, Session } = getModels();

  if (isJwtShape(token)) {
    const payload = verifyJwt(token);
    if (!payload) return null;

    const session = await Session.findOne({
      where: { token },
      include: [{ model: User, as: 'user' }],
    });
    if (!session || !session.user) return null;
    if (payload.jti && session.jti && payload.jti !== session.jti) return null;
    if (Number(payload.sub) !== Number(session.userId)) return null;
    if (session.user.locked) {
      await Session.destroy({ where: { token } });
      return null;
    }
    return { user: toPublicUser(session.user), authType: 'session' };
  }

  // Token cũ (hex) trước khi chuyển JWT
  const session = await Session.findByPk(token, {
    include: [{ model: User, as: 'user' }],
  });
  if (!session || !session.user) return null;
  if (session.user.locked) {
    await Session.destroy({ where: { token } });
    return null;
  }
  return { user: toPublicUser(session.user), authType: 'session' };
}

async function resolveUserFromApiKey(token) {
  const { User, ApiKey } = getModels();
  const row = await ApiKey.findOne({
    where: { key: token },
    include: [{ model: User, as: 'user' }],
  });
  if (!row || !row.user) return null;
  if (row.user.locked) return null;

  row.lastUsedAt = new Date();
  await row.save({ fields: ['lastUsedAt'] }).catch(() => {});

  return { user: toPublicUser(row.user), authType: 'apiKey', apiKeyId: row.id };
}

async function getUserByToken(token) {
  if (!token) return null;
  const raw = String(token).trim();
  if (!raw) return null;

  if (raw.startsWith('ls_')) {
    const resolved = await resolveUserFromApiKey(raw);
    return resolved ? resolved.user : null;
  }

  const resolved = await resolveUserFromSessionToken(raw);
  return resolved ? resolved.user : null;
}

async function resolveAuth(token) {
  if (!token) return null;
  const raw = String(token).trim();
  if (!raw) return null;

  if (raw.startsWith('ls_')) {
    return resolveUserFromApiKey(raw);
  }
  return resolveUserFromSessionToken(raw);
}

async function getStats() {
  const { User } = getModels();
  const all = await User.findAll({
    attributes: ['id', 'username', 'role', 'locked', 'created_at'],
    order: [['id', 'ASC']],
  });

  return {
    userCount: all.length,
    adminCount: all.filter((u) => u.role === 'admin').length,
    users: all.map(toPublicUser),
  };
}

function sessionPublicId(row) {
  if (row.jti) return String(row.jti);
  return crypto.createHash('sha256').update(String(row.token || '')).digest('hex').slice(0, 24);
}

function toPublicSession(row, currentToken) {
  const token = String(row.token || '');
  const preview =
    token.length > 18 ? `${token.slice(0, 10)}…${token.slice(-6)}` : token || '—';
  return {
    id: sessionPublicId(row),
    jti: row.jti || null,
    isCurrent: Boolean(currentToken && token === currentToken),
    tokenPreview: preview,
    created_at: row.created_at || row.createdAt || null,
  };
}

async function findSessionForUser(userId, sessionId) {
  const { Session } = getModels();
  const rows = await Session.findAll({ where: { userId } });
  return rows.find((row) => sessionPublicId(row) === String(sessionId || '')) || null;
}

async function listSessions(req, res, next) {
  try {
    if (req.authType === 'apiKey') {
      return res.status(403).json({
        ok: false,
        error: 'API key không quản lý được phiên đăng nhập',
      });
    }

    const { Session } = getModels();
    const rows = await Session.findAll({
      where: { userId: req.user.id },
      order: [['created_at', 'DESC']],
    });

    res.json({
      ok: true,
      sessions: rows.map((row) => toPublicSession(row, req.token)),
    });
  } catch (err) {
    next(err);
  }
}

async function assertCurrentPassword(req) {
  const password = String(req.body?.password || '');
  if (!password) {
    return { ok: false, status: 400, error: 'Nhập mật khẩu để xác minh' };
  }

  const { User } = getModels();
  const dbUser = await User.findByPk(req.user.id);
  if (!dbUser || !verifyPassword(password, dbUser.passwordSalt, dbUser.passwordHash)) {
    return { ok: false, status: 401, error: 'Mật khẩu không đúng' };
  }

  return { ok: true };
}

async function revokeSession(req, res, next) {
  try {
    if (req.authType === 'apiKey') {
      return res.status(403).json({
        ok: false,
        error: 'API key không quản lý được phiên đăng nhập',
      });
    }

    const passwordCheck = await assertCurrentPassword(req);
    if (!passwordCheck.ok) {
      return res.status(passwordCheck.status).json({ ok: false, error: passwordCheck.error });
    }

    const sessionId = String(req.params.id || '').trim();
    if (!sessionId) {
      return res.status(400).json({ ok: false, error: 'Thiếu session id' });
    }

    const row = await findSessionForUser(req.user.id, sessionId);
    if (!row) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy phiên' });
    }

    const isCurrent = row.token === req.token;
    await row.destroy();

    res.json({
      ok: true,
      revokedCurrent: isCurrent,
      message: isCurrent
        ? 'Đã thu hồi phiên hiện tại — cần đăng nhập lại'
        : 'Đã thu hồi phiên',
    });
  } catch (err) {
    next(err);
  }
}

async function revokeOtherSessions(req, res, next) {
  try {
    if (req.authType === 'apiKey') {
      return res.status(403).json({
        ok: false,
        error: 'API key không quản lý được phiên đăng nhập',
      });
    }

    const passwordCheck = await assertCurrentPassword(req);
    if (!passwordCheck.ok) {
      return res.status(passwordCheck.status).json({ ok: false, error: passwordCheck.error });
    }

    const { Session, Op } = (() => {
      const models = getModels();
      return { Session: models.Session, Op: require('sequelize').Op };
    })();

    const deleted = await Session.destroy({
      where: {
        userId: req.user.id,
        token: { [Op.ne]: req.token },
      },
    });

    res.json({
      ok: true,
      deleted,
      message: deleted
        ? `Đã thu hồi ${deleted} phiên khác`
        : 'Không có phiên khác để thu hồi',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  login,
  logout,
  me,
  changePassword,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  getUserByToken,
  resolveAuth,
  getStats,
  findUserByUsername,
  hashPassword,
};
