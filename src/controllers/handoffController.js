const db = require('../config/db');

async function listHandoffs(req, res) {
  const { status = 'pending' } = req.query;

  const { rows } = await db.query(
    `SELECT
       h.id AS handoff_id, h.status, h.requested_at, h.accepted_at, h.resolved_at,
       h.accepted_by, au.name AS accepted_by_name,
       c.id AS conversation_id, c.channel, c.language, c.client_id,
       h.priority, c.handoff_status, c.consent_status, c.category,
       cl.name AS client_name, cl.age AS client_age, cl.location AS client_location,
       cl.contact_phone AS client_contact_phone, cl.phone AS client_raw_phone
     FROM human_handoffs h
     JOIN conversations c ON c.id = h.conversation_id
     LEFT JOIN admin_users au ON au.id = h.accepted_by
     LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE h.status = $1
     ORDER BY h.requested_at ASC`,
    [status]
  );

  // Only a number the person gave, or a WhatsApp number, is something staff can call.
  const handoffs = [];
  for (const { client_contact_phone, client_raw_phone, ...r } of rows) {
    const { rows: last } = await db.query(
      'SELECT content FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
      [r.conversation_id]
    );
    handoffs.push({
      ...r,
      last_message: last[0] ? last[0].content : null,
      client_phone: client_contact_phone || (r.channel === 'whatsapp' ? client_raw_phone : null),
    });
  }
  res.json({ handoffs });
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