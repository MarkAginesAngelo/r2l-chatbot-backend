const db = require('../config/db');
const { buildReport } = require('../services/analytics/caseReport');
const { toExcel, toPdf } = require('../services/analytics/exporters');

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

/** GET /api/analytics/cases — filtered case analytics.
 * Query: period=today|7d|30d|90d (or from/to as YYYY-MM-DD), language=en|si|ta,
 * category=police|cyber|financial|land|family|danger, needsHuman=yes|no,
 * channel=website|whatsapp|messenger, page, pageSize. Any filter can be "all". */
async function cases(req, res) {
  const report = await buildReport(req.query, { page: req.query.page, pageSize: req.query.pageSize });
  delete report._allRows;
  res.json(report);
}

/** GET /api/analytics/export?format=xlsx|pdf&<same filters> — downloads the
 * filtered cases (all of them, not just one page). */
async function exportCases(req, res) {
  const format = String(req.query.format || 'xlsx').toLowerCase();
  if (!['xlsx', 'pdf'].includes(format)) {
    return res.status(400).json({ message: 'format must be xlsx or pdf' });
  }
  const report = await buildReport(req.query);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'xlsx') {
    const buf = await toExcel(report);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="r2l-cases-${stamp}.xlsx"`);
    return res.send(buf);
  }
  const buf = await toPdf(report);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="r2l-cases-${stamp}.pdf"`);
  return res.send(buf);
}

module.exports = { summary, conversationsOverTime, cases, exportCases };
