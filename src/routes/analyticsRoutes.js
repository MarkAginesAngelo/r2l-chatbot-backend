const express = require('express');
const { authenticate, authorize } = require('../middlewares/auth');
const { summary, conversationsOverTime, cases, exportCases } = require('../controllers/analyticsController');

const router = express.Router();

router.use(authenticate, authorize('super_admin', 'admin'));

router.get('/summary', summary);
router.get('/conversations-over-time', conversationsOverTime);
router.get('/cases', cases);
router.get('/export', exportCases);

module.exports = router;
