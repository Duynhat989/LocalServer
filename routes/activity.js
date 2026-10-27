const express = require('express');
const activityController = require('../controllers/activityController');
const { requireAuth, requireStaff } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requireStaff, activityController.listActivity);
router.post('/excel', requireAuth, activityController.logExcelExport);

module.exports = router;
