const { Sequelize } = require('sequelize');
const { getModels } = require('../models');
const { hashPassword } = require('../utils/password');
const { toPublicUser } = require('../utils/user');
const { DEFAULT_USER_PASSWORD } = require('../constants');

async function listUsers(req, res, next) {
  try {
    const { User } = getModels();
    const rows = await User.findAll({
      attributes: ['id', 'username', 'role', 'locked', 'created_at'],
      order: [['id', 'ASC']],
    });
    res.json({ ok: true, users: rows.map(toPublicUser) });
  } catch (err) {
    next(err);
  }
}

async function createUser(req, res) {
  try {
    const { username, password, role = 'user' } = req.body || {};
    const name = String(username || '').trim();
    const pass = String(password || '');
    const allowedRoles = new Set(['admin', 'manager', 'user']);
    const userRole = allowedRoles.has(role) ? role : 'user';

    if (!name || name.length < 3) {
      return res.status(400).json({ ok: false, error: 'Tên đăng nhập tối thiểu 3 ký tự' });
    }
    if (!pass || pass.length < 4) {
      return res.status(400).json({ ok: false, error: 'Mật khẩu tối thiểu 4 ký tự' });
    }

    const { User } = getModels();
    const existed = await User.findOne({
      where: Sequelize.where(
        Sequelize.fn('lower', Sequelize.col('username')),
        name.toLowerCase()
      ),
    });
    if (existed) {
      return res.status(409).json({ ok: false, error: 'Tên đăng nhập đã tồn tại' });
    }

    const { salt, hash } = hashPassword(pass);
    const user = await User.create({
      username: name,
      passwordHash: hash,
      passwordSalt: salt,
      role: userRole,
      locked: false,
    });

    res.status(201).json({ ok: true, user: toPublicUser(user) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Không tạo được user' });
  }
}

async function setLocked(req, res, next) {
  try {
    const id = Number(req.params.id);
    const locked = Boolean(req.body?.locked);
    const { User, Session } = getModels();

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }
    if (req.user.id === id) {
      return res.status(400).json({ ok: false, error: 'Không thể khóa chính tài khoản đang đăng nhập' });
    }

    const target = await User.findByPk(id);
    if (!target) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy user' });
    }

    target.locked = locked;
    await target.save();

    if (locked) {
      await Session.destroy({ where: { userId: id } });
    }

    res.json({
      ok: true,
      user: toPublicUser(target),
      message: locked ? 'Đã khóa user' : 'Đã mở khóa user',
    });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { User, Session } = getModels();

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }

    const target = await User.findByPk(id);
    if (!target) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy user' });
    }

    const { salt, hash } = hashPassword(DEFAULT_USER_PASSWORD);
    target.passwordHash = hash;
    target.passwordSalt = salt;
    await target.save();

    if (req.user.id !== id) {
      await Session.destroy({ where: { userId: id } });
    }

    res.json({
      ok: true,
      user: toPublicUser(target),
      defaultPassword: DEFAULT_USER_PASSWORD,
      message: `Đã đặt mật khẩu mặc định: ${DEFAULT_USER_PASSWORD}`,
    });
  } catch (err) {
    next(err);
  }
}

async function deleteUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { User, Session, ApiKey } = getModels();

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'ID không hợp lệ' });
    }
    if (req.user.id === id) {
      return res.status(400).json({
        ok: false,
        error: 'Không thể xóa chính tài khoản đang đăng nhập',
      });
    }

    const target = await User.findByPk(id);
    if (!target) {
      return res.status(404).json({ ok: false, error: 'Không tìm thấy user' });
    }

    if (target.role === 'admin') {
      const adminCount = await User.count({ where: { role: 'admin' } });
      if (adminCount <= 1) {
        return res.status(400).json({
          ok: false,
          error: 'Không thể xóa admin cuối cùng',
        });
      }
    }

    const username = target.username;
    await Session.destroy({ where: { userId: id } });
    await ApiKey.destroy({ where: { userId: id } });
    await target.destroy();

    res.json({
      ok: true,
      deletedId: id,
      message: `Đã xóa user “${username}”`,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listUsers,
  createUser,
  setLocked,
  resetPassword,
  deleteUser,
};
