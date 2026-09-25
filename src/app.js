require('express-async-errors');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const routes = require('./routes');
const whatsappWebhookRoutes = require('./routes/whatsappWebhookRoutes');
const messengerWebhookRoutes = require('./routes/messengerWebhookRoutes');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');
const logger = require('./config/logger');

const app = express();

// Required behind ngrok/reverse proxies so express-rate-limit reads the real
// client IP from X-Forwarded-For instead of rejecting it as unexpected.
app.set('trust proxy', 1);

app.use(helmet());
// Two separate frontends call this API on two separate origins — the admin
// dashboard and the public website chat widget — so origin is validated
// against a list rather than a single string. "*" in CORS_ORIGIN allows any
// origin (fine for local dev; set the real domains in production).
app.use(
  cors({
    origin: (origin, callback) => {
      if (env.corsOrigins.includes('*') || !origin || env.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(
  express.json({
    limit: '2mb',
    verify: (req, res, buf) => {
      req.rawBody = buf; // needed for Messenger's X-Hub-Signature-256 verification
    },
  })
);
app.use(
  morgan(env.nodeEnv === 'production' ? 'combined' : 'dev', {
    stream: { write: (msg) => (logger.http ? logger.http(msg.trim()) : logger.info(msg.trim())) },
  })
);

// Meta webhooks live outside /api — no JWT, Meta calls these directly. They get
// their own looser limiter (Meta can burst-retry) rather than the dashboard's.
// Rate limiting is skipped entirely in the test environment: automated tests
// legitimately fire far more requests per minute than any real client would
// (e.g. a single integration test walking through 4+ chat turns), and rate
// limiting there tests nothing useful while causing confusing, order-
// dependent failures unrelated to whatever the test actually checks.
if (env.nodeEnv !== 'test') {
  app.use(
    '/webhooks/',
    rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false })
  );
}
app.use('/webhooks/whatsapp', whatsappWebhookRoutes);
app.use('/webhooks/messenger', messengerWebhookRoutes);

if (env.nodeEnv !== 'test') {
  app.use(
    '/api/',
    rateLimit({
      windowMs: 60 * 1000,
      max: 60, // 60 requests/minute/IP — tune per channel later
      standardHeaders: true,
      legacyHeaders: false,
    })
  );
}

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
