const express = require('express');
const { authenticate, authorize } = require('../middlewares/auth');
const { listLeads, createLead, updateLeadStatus } = require('../controllers/leadController');

const router = express.Router();

router.use(authenticate, authorize('super_admin', 'admin', 'staff'));

router.get('/', listLeads);
router.post('/', createLead);
router.patch('/:id/status', updateLeadStatus);

module.exports = router;
