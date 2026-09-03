const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const env = require('../config/env');
const { AppError } = require('../middlewares/errorHandler');

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  const { rows } = await db.query(
    `SELECT au.id, au.name, au.email, au.password_hash, au.is_active, r.name AS role
     FROM admin_users au
     JOIN roles r ON r.id = au.role_id
     WHERE au.email = $1`,
    [email]
  );

  const user = rows[0];
  if (!user || !user.is_active) {
    throw new AppError('Invalid credentials', 401);
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new AppError('Invalid credentials', 401);
  }

  const payload = { id: user.id, email: user.email, role: user.role };
  const accessToken = jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn });
  const refreshToken = jwt.sign(payload, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshExpiresIn });

  await db.query('UPDATE admin_users SET last_login_at = now() WHERE id = $1', [user.id]);

  res.json({
    accessToken,
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
}

async function refresh(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new AppError('refreshToken is required', 400);

  try {
    const payload = jwt.verify(refreshToken, env.jwt.refreshSecret);
    const accessToken = jwt.sign(
      { id: payload.id, email: payload.email, role: payload.role },
      env.jwt.secret,
      { expiresIn: env.jwt.expiresIn }
    );
    res.json({ accessToken });
  } catch (err) {
    throw new AppError('Invalid or expired refresh token', 401);
  }
}

module.exports = { login, refresh };
