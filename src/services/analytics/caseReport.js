const db = require('../../config/db');
const { CATEGORIES } = require('../triage/categories');
const { SCENARIOS_BY_CATEGORY } = require('../triage/scenarios');

const LANGUAGES = ['en', 'si', 'ta'];
const CHANNELS = ['website', 'whatsapp', 'messenger'];
const CATEGORY_KEYS = CATEGORIES.map((c) => c.key); // police, cyber, financial, land, family, danger
const LANGUAGE_NAMES = { en: 'English', si: 'Sinhala', ta: 'Tamil' };
const CHANNEL_NAMES = { website: 'Website', whatsapp: 'WhatsApp', messenger: 'Messenger' };

const categoryLabel = (key) => CATEGORIES.find((c) => c.key === key)?.label || (key ? key : 'Not chosen yet');
const scenarioLabel = (key) => {
  if (!key) return '';
  for (const list of Object.values(SCENARIOS_BY_CATEGORY)) {
    const s = list.find((x) => x.key === key);
    if (s) return s.label;
  }
  return key;
};

const startOfDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Turns ?period=today|7d|30d|90d|custom (+ from/to) into a [from, to] range. */
function resolveRange({ period, from, to }, now = new Date()) {
  const days = { today: 0, '7d': 6, '30d': 29, '90d': 89 }[period];
  if (days !== undefined) {
    return { from: new Date(startOfDay(now).getTime() - days * 86400000), to: new Date(now) };
  }
  const f = from ? new Date(from) : null;
  const t = to ? new Date(to) : null;
  if (f && Number.isNaN(f.getTime())) throw Object.assign(new Error('Invalid "from" date'), { statusCode: 400 });
  if (t && Number.isNaN(t.getTime())) throw Object.assign(new Error('Invalid "to" date'), { statusCode: 400 });
  // a bare date as "to" means the end of that day
  if (t && /^\d{4}-\d{2}-\d{2}$/.test(String(to))) t.setUTCHours(23, 59, 59, 999);
  return { from: f, to: t };
}

/** Validates the query string; throws a 400-style error for unknown values. */
function parseFilters(q = {}) {
  const bad = (m) => Object.assign(new Error(m), { statusCode: 400 });
  const f = {};
  if (q.language && q.language !== 'all') {
    if (!LANGUAGES.includes(q.language)) throw bad(`language must be one of ${LANGUAGES.join(', ')}`);
    f.language = q.language;
  }
  if (q.channel && q.channel !== 'all') {
    if (!CHANNELS.includes(q.channel)) throw bad(`channel must be one of ${CHANNELS.join(', ')}`);
    f.channel = q.channel;
  }
  if (q.category && q.category !== 'all') {
    if (!CATEGORY_KEYS.includes(q.category)) throw bad(`category must be one of ${CATEGORY_KEYS.join(', ')}`);
    f.category = q.category;
  }
  if (q.needsHuman && q.needsHuman !== 'all') {
    if (!['yes', 'no'].includes(q.needsHuman)) throw bad('needsHuman must be yes or no');
    f.needsHuman = q.needsHuman;
  }
  const range = resolveRange(q);
  if (range.from) f.from = range.from;
  if (range.to) f.to = range.to;
  return f;
}

async function fetchCases(filters, { limit = 50000 } = {}) {
  const where = [];
  const params = [];
  const add = (sql, v) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.from) add('c.created_at >= ?', filters.from);
  if (filters.to) add('c.created_at <= ?', filters.to);
  if (filters.language) add('c.language = ?', filters.language);
  if (filters.channel) add('c.channel = ?', filters.channel);
  if (filters.category) add('c.category = ?', filters.category);

  const { rows } = await db.query(
    `SELECT c.id, c.created_at, c.updated_at, c.channel, c.language, c.category, c.scenario, c.status,
            cl.name AS client_name
       FROM conversations c
       LEFT JOIN clients cl ON cl.id = c.client_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.created_at DESC
      LIMIT ${Number(limit)}`,
    params
  );
  // A case "needs a human" if it was flagged (status) or a handoff was raised.
  const { rows: handoffs } = await db.query('SELECT DISTINCT conversation_id FROM human_handoffs');
  const handedOff = new Set(handoffs.map((h) => h.conversation_id));

  const mapped = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    channel: r.channel,
    language: r.language,
    category: r.category,
    categoryLabel: categoryLabel(r.category),
    scenario: r.scenario,
    scenarioLabel: scenarioLabel(r.scenario),
    status: r.status,
    needsHuman: r.status === 'needs_human' || handedOff.has(r.id),
    clientName: r.client_name || '',
  }));
  if (filters.needsHuman === 'yes') return mapped.filter((r) => r.needsHuman);
  if (filters.needsHuman === 'no') return mapped.filter((r) => !r.needsHuman);
  return mapped;
}

const tally = (rows, keyFn, order) => {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    m.set(k, (m.get(k) || 0) + 1);
  }
  const keys = order ? [...new Set([...order, ...m.keys()])] : [...m.keys()];
  return keys.map((k) => ({ key: k, count: m.get(k) || 0 }));
};

function summarise(rows) {
  const day = (r) => new Date(r.createdAt).toISOString().slice(0, 10);
  const needs = rows.filter((r) => r.needsHuman).length;
  return {
    total: rows.length,
    needsHuman: needs,
    noHumanNeeded: rows.length - needs,
    byLanguage: tally(rows, (r) => r.language || 'en', LANGUAGES).map((x) => ({ ...x, label: LANGUAGE_NAMES[x.key] || x.key })),
    byChannel: tally(rows, (r) => r.channel, CHANNELS).map((x) => ({ ...x, label: CHANNEL_NAMES[x.key] || x.key })),
    byCategory: tally(rows, (r) => r.category || 'none', CATEGORY_KEYS).map((x) => ({
      ...x,
      label: x.key === 'none' ? 'Not chosen yet' : categoryLabel(x.key),
    })),
    byDay: tally(rows, day).sort((a, b) => (a.key < b.key ? -1 : 1)).map((x) => ({ date: x.key, count: x.count })),
  };
}

async function buildReport(query, { page = 1, pageSize = 25 } = {}) {
  const filters = parseFilters(query);
  const rows = await fetchCases(filters);
  const size = Math.min(Math.max(Number(pageSize) || 25, 1), 200);
  const pg = Math.max(Number(page) || 1, 1);
  return {
    filters: {
      ...filters,
      from: filters.from?.toISOString() || null,
      to: filters.to?.toISOString() || null,
    },
    summary: summarise(rows),
    cases: { page: pg, pageSize: size, total: rows.length, rows: rows.slice((pg - 1) * size, pg * size) },
    _allRows: rows, // for export; stripped before sending to the client
  };
}

module.exports = {
  buildReport, fetchCases, summarise, parseFilters, resolveRange,
  LANGUAGES, CHANNELS, CATEGORY_KEYS, LANGUAGE_NAMES, CHANNEL_NAMES, categoryLabel,
};
