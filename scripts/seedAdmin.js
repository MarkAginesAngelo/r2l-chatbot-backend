/**
 * Usage: node scripts/seedAdmin.js "Admin Name" admin@example.com "StrongPassword123!"
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('../src/config/db');

async function main() {
  const [, , name, email, password] = process.argv;
  if (!name || !email || !password) {
    console.error('Usage: node scripts/seedAdmin.js "Name" email@example.com password');
    process.exit(1);
  }

  const { rows: roleRows } = await db.query(`SELECT id FROM roles WHERE name = 'super_admin'`);
  if (!roleRows[0]) {
    console.error('super_admin role not found — did you run the migration (001_init.sql)?');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await db.query(
    `INSERT INTO admin_users (id, name, email, password_hash, role_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO NOTHING`,
    [uuidv4(), name, email, passwordHash, roleRows[0].id]
  );

  console.log(`Super admin created (or already existed): ${email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
