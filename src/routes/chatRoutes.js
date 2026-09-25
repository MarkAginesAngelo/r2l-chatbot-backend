const express = require('express');
const { chat } = require('../controllers/chatController');
const { validate } = require('../middlewares/validate');
const { chatSchema } = require('../schemas');

const router = express.Router();

router.post('/', validate(chatSchema), chat);

module.exports = router;
