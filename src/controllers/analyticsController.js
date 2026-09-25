const db = require('../config/db');

async function summary(req, res) {
  const [
    { rows: totalConvos },
    { rows: activeConvos },
    { rows: escalated },
    { rows: totalClients },
    { rows: totalLeads },
    { rows: byLanguage },
    { rows: byChannel },
  ] = await Promise.all([
    db.query('SELECT COUNT(*) FROM conversations'),
    db.query(`SELECT COUNT(*) FROM conversations WHERE status IN ('open','needs_human')`),
    db.query(`SELECT COUNT(*) FROM human_handoffs WHERE status = 'pending'`),
    db.query('SELECT COUNT(*) FROM clients'),
    db.query(`SELECT COUNT(*) FROM leads WHERE status != 'closed'`),
    db.query('SELECT language, COUNT(*) FROM conversations GROUP BY language'),
    db.query('SELECT channel, COUNT(*) FROM conversations GROUP BY channel'),
  ]);

  res.json({
    totalConversations: parseInt(totalConvos[0].count, 10),
    activeConversations: parseInt(activeConvos[0].count, 10),
    pendingHandoffs: parseInt(escalated[0].count, 10),
    totalClients: parseInt(totalClients[0].count, 10),
    openLeads: parseInt(totalLeads[0].count, 10),
    byLanguage: byLanguage.map((r) => ({ language: r.language, count: parseInt(r.count, 10) })),
    byChannel: byChannel.map((r) => ({ channel: r.channel, count: parseInt(r.count, 10) })),
  });
}

async function conversationsOverTime(req, res) {
  const { days = 30 } = req.query;
  const { rows } = await db.query(
    `SELECT date_trunc('day', created_at) AS day, COUNT(*)
     FROM conversations
     WHERE created_at > now() - ($1 || ' days')::interval
     GROUP BY day ORDER BY day ASC`,
    [days]
  );
  res.json({ series: rows.map((r) => ({ date: r.day, count: parseInt(r.count, 10) })) });
}

module.exports = { summary, conversationsOverTime };
