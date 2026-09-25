const express = require('express');
const { login, refresh } = require('../controllers/authController');
const { validate } = require('../middlewares/validate');
const { loginSchema, refreshSchema } = require('../schemas');

const router = express.Router();

router.post('/login', validate(loginSchema), login);
router.post('/refresh', validate(refreshSchema), refresh);

module.exports = router;
