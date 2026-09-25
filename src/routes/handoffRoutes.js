const express = require('express');

const { authenticate, authorize } = require('../middlewares/auth');

const {
  listHandoffs,
  acceptHandoff,
} = require('../controllers/handoffController');

const router = express.Router();

router.use(authenticate, authorize('super_admin', 'admin', 'staff'));

router.get('/', listHandoffs);

router.post('/:id/accept', acceptHandoff);

module.exports = router;