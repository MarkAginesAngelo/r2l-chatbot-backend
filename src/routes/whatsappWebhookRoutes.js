const express = require('express');
const { verifyWebhook, receiveWebhook } = require('../controllers/whatsappWebhookController');

const router = express.Router();

router.get('/', verifyWebhook);
router.post('/', receiveWebhook);

module.exports = router;
