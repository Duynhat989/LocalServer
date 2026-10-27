const express = require('express');
const keywordFilterController = require('../controllers/keywordFilterController');
const { requireAuth, requireStaff } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requireStaff, keywordFilterController.listFilters);
router.get('/:id', requireAuth, requireStaff, keywordFilterController.getFilter);
router.post('/', requireAuth, requireStaff, keywordFilterController.createFilter);
router.patch('/:id', requireAuth, requireStaff, keywordFilterController.updateFilter);
router.delete('/:id', requireAuth, requireStaff, keywordFilterController.deleteFilter);

module.exports = router;
