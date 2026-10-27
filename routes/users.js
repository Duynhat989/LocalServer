const express = require('express');
const userController = require('../controllers/userController');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requireAdmin, userController.listUsers);
router.post('/', requireAuth, requireAdmin, userController.createUser);
router.patch('/:id/lock', requireAuth, requireAdmin, userController.setLocked);
router.post('/:id/reset-password', requireAuth, requireAdmin, userController.resetPassword);
router.delete('/:id', requireAuth, requireAdmin, userController.deleteUser);

module.exports = router;
