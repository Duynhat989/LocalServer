const authController = require('../controllers/authController');

function getToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

async function requireAuth(req, res, next) {
  try {
    const token = getToken(req);
    const resolved = await authController.resolveAuth(token);
    if (!resolved?.user) {
      return res.status(401).json({ ok: false, error: 'Chưa đăng nhập' });
    }
    req.user = resolved.user;
    req.token = token;
    req.authType = resolved.authType || 'session';
    req.apiKeyId = resolved.apiKeyId || null;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Chỉ admin mới có quyền này' });
  }
  next();
}

function requireStaff(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'manager')) {
    return res.status(403).json({ ok: false, error: 'Không có quyền truy cập' });
  }
  next();
}

module.exports = {
  getToken,
  requireAuth,
  requireAdmin,
  requireStaff,
};
