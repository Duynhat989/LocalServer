const express = require('express');
const statsController = require('../controllers/statsController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/home', requireAuth, statsController.homeStats);

module.exports = router;
