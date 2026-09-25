const db = require('../config/db');

async function listHandoffs(req, res) {
  const { status = 'pending' } = req.query;

  const { rows } = await db.query(
    `SELECT
       h.id AS handoff_id, h.status, h.requested_at, h.accepted_at, h.resolved_at,
       h.accepted_by, au.name AS accepted_by_name,
       c.id AS conversation_id, c.channel, c.language, c.client_id,
       cl.name AS client_name, cl.phone AS client_phone,
       (SELECT content
        FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1) AS last_message
     FROM human_handoffs h
     JOIN conversations c ON c.id = h.conversation_id
     LEFT JOIN admin_users au ON au.id = h.accepted_by
     LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE h.status = $1
     ORDER BY h.requested_at ASC`,
    [status]
  );

  res.json({ handoffs: rows });
}

async function acceptHandoff(req, res) {
  const { id } = req.params;

  const { rows } = await db.query(
    `UPDATE human_handoffs
     SET status = 'accepted',
         accepted_at = NOW(),
         accepted_by = $1
     WHERE id = $2
       AND status = 'pending'
     RETURNING
       id AS handoff_id,
       status,
       requested_at,
       accepted_at,
       accepted_by,
       resolved_at`,
    [req.user.id, id]
  );

  if (rows.length === 0) {
    return res.status(404).json({
      error: {
        message: 'Pending handoff not found',
      },
    });
  }

  res.json({
    handoff: rows[0],
  });
}

module.exports = {
  listHandoffs,
  acceptHandoff,
};