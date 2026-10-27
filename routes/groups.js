const express = require('express');
const groupController = require('../controllers/groupController');
const { requireAuth, requireStaff } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requireStaff, groupController.listGroups);
router.post('/claim', requireAuth, requireStaff, groupController.claimGroup);
router.post('/:id/release', requireAuth, requireStaff, groupController.releaseGroup);
router.post('/', requireAuth, requireStaff, groupController.createGroup);
router.patch('/:id', requireAuth, requireStaff, groupController.updateGroup);
router.delete('/:id', requireAuth, requireStaff, groupController.deleteGroup);
router.post('/bulk', requireAuth, groupController.createGroupsBulk);

module.exports = router;
