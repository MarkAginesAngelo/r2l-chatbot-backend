require('dotenv').config();

function required(name, fallback) {
  const val = process.env[name] ?? fallback;
  if (val === undefined) {
    // eslint-disable-next-line no-console
    console.warn(`[config] Missing env var: ${name}`);
  }
  return val;
}

module.exports = {
  nodeEnv: required('NODE_ENV', 'development'),
  port: parseInt(required('PORT', '4000'), 10),
  corsOrigin: required('CORS_ORIGIN', '*'),
  // Comma-separated list, e.g. "https://dashboard.r2l.org,https://right2lifelanka.org"
  // — the admin dashboard and the public website chat widget are two
  // separate frontends on two separate domains, so a single-origin string
  // isn't enough once both are live.
  corsOrigins: required('CORS_ORIGIN', '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  db: {
    connectionString: required('DATABASE_URL'),
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: required('JWT_EXPIRES_IN', '8h'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    refreshExpiresIn: required('JWT_REFRESH_EXPIRES_IN', '7d'),
  },

  qdrant: {
    url: required('QDRANT_URL', 'http://localhost:6333'),
    apiKey: process.env.QDRANT_API_KEY || undefined,
    collection: required('QDRANT_COLLECTION', 'r2l_knowledge_base'),
  },

  openai: {
    apiKey: required('OPENAI_API_KEY'),
    chatModel: required('OPENAI_CHAT_MODEL', 'gpt-4o-mini'),
    embeddingModel: required('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small'),
  },

  whatsapp: {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  },

  messenger: {
    verifyToken: process.env.MESSENGER_VERIFY_TOKEN,
    pageAccessToken: process.env.MESSENGER_PAGE_ACCESS_TOKEN,
    appSecret: process.env.MESSENGER_APP_SECRET,
  },

  uploads: {
    dir: required('UPLOAD_DIR', './uploads'),
    maxMb: parseInt(required('MAX_UPLOAD_MB', '20'), 10),
  },

  redis: {
    url: required('REDIS_URL', 'redis://localhost:6379'),
  },
};
