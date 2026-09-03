const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { AppError } = require('./errorHandler');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError('Missing or invalid Authorization header', 401);
  }
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, env.jwt.secret);
    req.user = payload; // { id, email, role }
    next();
  } catch (err) {
    throw new AppError('Invalid or expired token', 401);
  }
}

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      throw new AppError('Forbidden: insufficient role', 403);
    }
    next();
  };
}

module.exports = { authenticate, authorize };
