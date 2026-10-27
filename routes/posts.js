const express = require('express');
const postController = require('../controllers/postController');
const { requireAuth, requireStaff } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requireStaff, postController.listPosts);
router.post('/exists', requireAuth, postController.checkPostsExist);
router.delete(
  '/by-group/:groupId',
  requireAuth,
  requireStaff,
  postController.deletePostsByGroup
);
router.post('/', requireAuth, postController.createPost);
router.post('/bulk', requireAuth, postController.createPostsBulk);

module.exports = router;
