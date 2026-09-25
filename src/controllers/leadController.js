const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

async function listLeads(req, res) {
  const { status, source } = req.query;
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`l.status = $${params.length}`);
  }
  if (source) {
    params.push(source);
    conditions.push(`l.source = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT l.*, c.name AS client_name, c.phone AS client_phone, c.email AS client_email
     FROM leads l LEFT JOIN clients c ON c.id = l.client_id
     ${where} ORDER BY l.created_at DESC`,
    params
  );
  res.json({ leads: rows });
}

async function createLead(req, res) {
  const { clientId, source, requestType } = req.body;
  const id = uuidv4();
  const { rows } = await db.query(
    `INSERT INTO leads (id, client_id, source, request_type, status)
     VALUES ($1, $2, $3, $4, 'new') RETURNING *`,
    [id, clientId, source, requestType]
  );
  res.status(201).json(rows[0]);
}

async function updateLeadStatus(req, res) {
  const { status } = req.body;
  if (!['new', 'in_progress', 'closed'].includes(status)) {
    throw new AppError('Invalid status', 400);
  }
  const { rows } = await db.query(
    `UPDATE leads SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [status, req.params.id]
  );
  if (!rows[0]) throw new AppError('Lead not found', 404);
  res.json(rows[0]);
}

module.exports = { listLeads, createLead, updateLeadStatus };
