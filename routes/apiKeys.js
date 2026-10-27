const express = require('express');
const apiKeyController = require('../controllers/apiKeyController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, apiKeyController.listApiKeys);
router.post('/', requireAuth, apiKeyController.createApiKey);
router.delete('/:id', requireAuth, apiKeyController.deleteApiKey);

module.exports = router;
