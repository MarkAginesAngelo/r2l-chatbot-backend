const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  connectionString: env.db.connectionString,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] Unexpected error on idle client', err);
  process.exit(1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
