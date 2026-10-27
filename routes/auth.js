const express = require('express');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/login', authController.login);
router.post('/logout', requireAuth, authController.logout);
router.get('/me', requireAuth, authController.me);
router.post('/change-password', requireAuth, authController.changePassword);
router.get('/sessions', requireAuth, authController.listSessions);
router.delete('/sessions/others', requireAuth, authController.revokeOtherSessions);
router.delete('/sessions/:id', requireAuth, authController.revokeSession);

module.exports = router;
