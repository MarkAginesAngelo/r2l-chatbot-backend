const express = require('express');
const { authenticate, authorize } = require('../middlewares/auth');
const { summary, conversationsOverTime } = require('../controllers/analyticsController');

const router = express.Router();

router.use(authenticate, authorize('super_admin', 'admin'));

router.get('/summary', summary);
router.get('/conversations-over-time', conversationsOverTime);

module.exports = router;
