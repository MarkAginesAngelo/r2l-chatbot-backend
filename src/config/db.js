const { Pool } = require('pg');
const env = require('./env');
const logger = require('./logger');

const pool = new Pool({
  connectionString: env.db.connectionString,
});

pool.on('error', (err) => {
  logger.error('[db] Unexpected error on idle client', { error: err.message });
  process.exit(1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
