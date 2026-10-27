const express = require('express');
const campaignController = require('../controllers/campaignController');
const { requireAuth, requireStaff } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, campaignController.listCampaigns);
router.get('/:id', requireAuth, campaignController.getCampaign);
router.get('/:id/phones', requireAuth, campaignController.listCampaignPhones);
router.get('/:id/steps', requireAuth, campaignController.listCampaignSteps);
router.post('/', requireAuth, requireStaff, campaignController.createCampaign);
router.patch('/:id', requireAuth, requireStaff, campaignController.updateCampaign);
router.post('/:id/phones', requireAuth, requireStaff, campaignController.addPhones);
router.post(
  '/:id/phones/mark-used',
  requireAuth,
  campaignController.markPhonesUsed
);
router.post(
  '/:id/phones/:phoneId/use',
  requireAuth,
  campaignController.markPhoneUsed
);
router.delete(
  '/:id/steps/:stepAdd',
  requireAuth,
  requireStaff,
  campaignController.undoStepAdd
);
router.delete('/:id/phones/:phoneId', requireAuth, requireStaff, campaignController.removePhone);

module.exports = router;
