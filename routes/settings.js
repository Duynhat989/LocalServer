const express = require('express');
const settingsController = require('../controllers/settingsController');
const { requireAuth, requireStaff } = require('../middleware/auth');

const router = express.Router();

router.get('/scan', requireAuth, settingsController.getScanSettings);
router.patch('/scan', requireAuth, requireStaff, settingsController.updateScanSettings);

module.exports = router;
