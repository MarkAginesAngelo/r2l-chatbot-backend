const express = require('express');
const { authenticate, authorize } = require('../middlewares/auth');
const {
  listConversations,
  getConversation,
  staffReply,
  updateStatus,
  acceptHandoff,
} = require('../controllers/conversationController');

const router = express.Router();

router.use(authenticate, authorize('super_admin', 'admin', 'staff'));

router.get('/', listConversations);
router.get('/:id', getConversation);
router.post('/:id/reply', staffReply);
router.patch('/:id/status', updateStatus);
router.post('/:id/accept-handoff', acceptHandoff);

module.exports = router;
