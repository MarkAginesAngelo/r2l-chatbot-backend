const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

async function listClients(req, res) {
  const { search, language, page = 1, pageSize = 20 } = req.query;
  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  if (language) {
    params.push(language);
    conditions.push(`preferred_language = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(parseInt(pageSize, 10) || 20, 100);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT * FROM clients ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const { rows: countRows } = await db.query(`SELECT COUNT(*) FROM clients ${where}`, params.slice(0, -2));

  res.json({ clients: rows, total: parseInt(countRows[0].count, 10), page: Number(page), pageSize: limit });
}

async function getClient(req, res) {
  const { rows } = await db.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw new AppError('Client not found', 404);

  const { rows: conversations } = await db.query(
    'SELECT id, channel, language, status, created_at FROM conversations WHERE client_id = $1 ORDER BY created_at DESC',
    [req.params.id]
  );

  res.json({ ...rows[0], conversations });
}

async function createClient(req, res) {
  const { name, phone, email, location, preferredLanguage = 'en', notes } = req.body;
  const id = uuidv4();
  const { rows } = await db.query(
    `INSERT INTO clients (id, name, phone, email, location, preferred_language, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, name, phone, email, location, preferredLanguage, notes]
  );
  res.status(201).json(rows[0]);
}

async function updateClient(req, res) {
  const { name, phone, email, location, preferredLanguage, notes } = req.body;
  const { rows } = await db.query(
    `UPDATE clients SET
       name = COALESCE($1, name),
       phone = COALESCE($2, phone),
       email = COALESCE($3, email),
       location = COALESCE($4, location),
       preferred_language = COALESCE($5, preferred_language),
       notes = COALESCE($6, notes),
       updated_at = now()
     WHERE id = $7 RETURNING *`,
    [name, phone, email, location, preferredLanguage, notes, req.params.id]
  );
  if (!rows[0]) throw new AppError('Client not found', 404);
  res.json(rows[0]);
}

async function deleteClient(req, res) {
  await db.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
  res.status(204).send();
}

module.exports = { listClients, getClient, createClient, updateClient, deleteClient };
