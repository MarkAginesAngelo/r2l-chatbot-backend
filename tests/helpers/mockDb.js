const { createTestDb } = require('./testDb');

let pool = createTestDb();

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool: { on: () => {} }, // the real module attaches an error listener; not exercised in tests
  __reset: () => {
    pool = createTestDb();
  },
};
