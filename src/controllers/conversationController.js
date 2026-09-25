const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

async function listConversations(req, res) {
  const { status, channel, assignedToMe } = req.query;
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (channel) {
    params.push(channel);
    conditions.push(`channel = $${params.length}`);
  }
  if (assignedToMe === 'true') {
    params.push(req.user.id);
    conditions.push(`assigned_staff_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT id, client_id, channel, language, status, assigned_staff_id, created_at, updated_at
     FROM conversations ${where} ORDER BY updated_at DESC LIMIT 100`,
    params
  );
  res.json({ conversations: rows });
}

async function getConversation(req, res) {
  const { rows: convoRows } = await db.query('SELECT * FROM conversations WHERE id = $1', [req.params.id]);
  if (!convoRows[0]) throw new AppError('Conversation not found', 404);

  const { rows: messages } = await db.query(
    'SELECT id, sender_type, sender_id, content, language, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [req.params.id]
  );

  res.json({ ...convoRows[0], messages });
}

async function staffReply(req, res) {
  const { content } = req.body;
  if (!content) throw new AppError('content is required', 400);

  const { rows: convoRows } = await db.query('SELECT * FROM conversations WHERE id = $1', [req.params.id]);
  if (!convoRows[0]) throw new AppError('Conversation not found', 404);

  await db.query(
    `INSERT INTO messages (id, conversation_id, sender_type, sender_id, content, language)
     VALUES ($1, $2, 'staff', $3, $4, $5)`,
    [uuidv4(), req.params.id, req.user.id, content, convoRows[0].language]
  );

  await db.query(
    `UPDATE conversations SET assigned_staff_id = COALESCE(assigned_staff_id, $1), updated_at = now() WHERE id = $2`,
    [req.user.id, req.params.id]
  );

  res.status(201).json({ ok: true });
}

async function updateStatus(req, res) {
  const { status } = req.body;
  if (!['open', 'needs_human', 'resolved', 'closed'].includes(status)) {
    throw new AppError('Invalid status', 400);
  }

  const { rows } = await db.query(
    `UPDATE conversations SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [status, req.params.id]
  );
  if (!rows[0]) throw new AppError('Conversation not found', 404);

  if (status === 'resolved') {
    await db.query(
      `UPDATE human_handoffs SET resolved_at = now(), status = 'resolved'
       WHERE conversation_id = $1 AND status != 'resolved'`,
      [req.params.id]
    );
  }

  res.json(rows[0]);
}

async function acceptHandoff(req, res) {
  const { rows } = await db.query(
    `UPDATE human_handoffs SET status = 'accepted', accepted_by = $1, accepted_at = now()
     WHERE conversation_id = $2 AND status = 'pending' RETURNING *`,
    [req.user.id, req.params.id]
  );
  if (!rows[0]) throw new AppError('No pending handoff for this conversation', 404);

  await db.query(
    `UPDATE conversations SET assigned_staff_id = $1, updated_at = now() WHERE id = $2`,
    [req.user.id, req.params.id]
  );

  res.json(rows[0]);
}

module.exports = { listConversations, getConversation, staffReply, updateStatus, acceptHandoff };
