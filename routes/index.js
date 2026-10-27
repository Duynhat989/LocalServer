const express = require('express');
const authRoutes = require('./auth');
const userRoutes = require('./users');
const postRoutes = require('./posts');
const groupRoutes = require('./groups');
const campaignRoutes = require('./campaigns');
const filterRoutes = require('./filters');
const settingsRoutes = require('./settings');
const apiKeyRoutes = require('./apiKeys');
const statsRoutes = require('./stats');
const activityRoutes = require('./activity');

const router = express.Router();

router.use(authRoutes);
router.use('/users', userRoutes);
router.use('/posts', postRoutes);
router.use('/groups', groupRoutes);
router.use('/campaigns', campaignRoutes);
router.use('/filters', filterRoutes);
router.use('/settings', settingsRoutes);
router.use('/api-keys', apiKeyRoutes);
router.use('/stats', statsRoutes);
router.use('/activity', activityRoutes);

module.exports = router;
