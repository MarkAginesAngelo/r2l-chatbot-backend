const { newDb } = require('pg-mem');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Creates a fresh in-memory Postgres instance loaded with the project's real
 * migrations (001_init.sql, 002_triage_flow.sql), and returns a `pg`-
 * compatible Pool wired to it. This runs real SQL — the same statements the
 * app issues against production Postgres — so integration tests catch schema
 * mismatches and query bugs that mocking db.query() entirely would hide.
 *
 * Two pg-mem-specific workarounds are applied to the migration SQL before
 * loading (the real migration files on disk are never touched):
 *  1. CREATE EXTENSION is stripped — pg-mem doesn't support real Postgres
 *     extensions, so uuid_generate_v4() is registered manually below instead.
 *  2. The roles seed insert gets explicit ids instead of relying on the
 *     column's own DEFAULT — pg-mem caches a DEFAULT expression's evaluated
 *     value per identical SQL text, so multiple rows relying on the same
 *     DEFAULT in one seed end up with duplicate ids. This only affects this
 *     one seed statement: every INSERT the application code itself issues
 *     already supplies its own id explicitly (via uuid.v4()), so this
 *     limitation never surfaces outside of this one-time schema seed.
 */
function createTestDb() {
  const db = newDb({ autoCreateForeignKeyIndices: true });

  db.public.registerFunction({
    name: 'uuid_generate_v4',
    returns: 'uuid',
    implementation: () => crypto.randomUUID(),
  });

  // pg-mem has no replace(); real Postgres does (used for title matching).
  for (const t of ['text', 'varchar']) {
    db.public.registerFunction({
      name: 'replace',
      args: [t, 'text', 'text'],
      returns: 'text',
      implementation: (str, from, to) => (str == null ? null : String(str).split(from).join(to)),
    });
  }

  const migrationsDir = path.join(__dirname, '../../src/db/migrations');

  let init = fs.readFileSync(path.join(migrationsDir, '001_init.sql'), 'utf-8');
  init = init.replace(/CREATE EXTENSION[^;]*;/gi, '');
  init = init.replace(
    /INSERT INTO roles \(name, description\) VALUES\s*([\s\S]*?);/i,
    () =>
      `INSERT INTO roles (id, name, description) VALUES
        ('${crypto.randomUUID()}', 'super_admin', 'Full system access'),
        ('${crypto.randomUUID()}', 'admin', 'Manage staff, clients, leads, knowledge base, analytics'),
        ('${crypto.randomUUID()}', 'staff', 'Handle conversations and human handoffs');`
  );
  db.public.none(init);

  const triageFlow = fs.readFileSync(path.join(migrationsDir, '002_triage_flow.sql'), 'utf-8');
  db.public.none(triageFlow);

  const handoffPriority = fs.readFileSync(path.join(migrationsDir, '003_handoff_priority.sql'), 'utf-8');
  db.public.none(handoffPriority);

  const scenarioAndSessionReset = fs.readFileSync(
    path.join(migrationsDir, '004_scenario_and_session_reset.sql'),
    'utf-8'
  );
  db.public.none(scenarioAndSessionReset);

  const { Pool } = db.adapters.createPg();
  return new Pool();
}

module.exports = { createTestDb };
