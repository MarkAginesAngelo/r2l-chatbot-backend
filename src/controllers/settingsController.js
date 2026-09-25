const db = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');

const DEFAULTS = {
  low_confidence_threshold: 0.72,
  retrieval_top_k: 5,
  // How long a WhatsApp/Messenger conversation can sit idle before a new
  // incoming message starts it over from the language/category menu instead
  // of resuming the old stage — a returning user may have a completely
  // different case days later. Also seeded into the settings table by
  // migration 004 so it's editable via PUT /api/settings/session_reset_hours
  // without a redeploy (R2L asked to start at 24h and tune it from there).
  session_reset_hours: 24,
};

async function getSetting(key) {
  const { rows } = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
  if (rows[0]) return rows[0].value;
  return DEFAULTS[key];
}

async function listSettings(req, res) {
  const { rows } = await db.query('SELECT key, value, updated_at FROM settings');
  const merged = { ...DEFAULTS };
  rows.forEach((r) => {
    merged[r.key] = r.value;
  });
  res.json({ settings: merged });
}

async function updateSetting(req, res) {
  const { key } = req.params;
  const { value } = req.body;
  if (value === undefined) throw new AppError('value is required', 400);

  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
  res.json({ key, value });
}

module.exports = { getSetting, listSettings, updateSetting, DEFAULTS };
