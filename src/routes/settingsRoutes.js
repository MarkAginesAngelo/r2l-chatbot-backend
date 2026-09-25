const express = require('express');
const { authenticate, authorize } = require('../middlewares/auth');
const { listSettings, updateSetting } = require('../controllers/settingsController');

const router = express.Router();

router.use(authenticate, authorize('super_admin', 'admin'));

router.get('/', listSettings);
router.put('/:key', updateSetting);

module.exports = router;
