const db = require('../../config/db');

const normalise = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[_\-/&.,:()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The "SCENARIO: …" line of a document written in the R2L template — a
 * second place (besides the title) where a scenario's name appears. */
function scenarioLine(content) {
  const text = String(content || '');
  const m = /SCENARIO\s*:/i.exec(text.slice(0, 600));
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 200);
  return rest.split(/GOLDEN RULE|USER SITUATION|\n/i)[0];
}

/**
 * Finds processed documents for a scenario/category by keyword. A document
 * matches when a keyword appears in its TITLE or in the SCENARIO line at the
 * top of its text — so a file named e.g. "Land_State_Transfers" still matches
 * the scenario "State land transferred or permit cancelled" if its text says
 * "SCENARIO: State Land Transfers & Permit Cancellations". Title matches come
 * first, then newest.
 */
async function findMatchingDocuments(keywords, language = 'en') {
  if (!keywords || keywords.length === 0) return [];
  const { rows } = await db.query(
    `SELECT d.id, d.title, d.language, d.created_at, c.content AS first_content
       FROM documents d
       LEFT JOIN document_chunks c ON c.document_id = d.id AND c.chunk_index = 0
      WHERE d.status = 'processed' AND d.language = $1`,
    [language]
  );
  const wanted = keywords.map(normalise);
  const scored = [];
  for (const r of rows) {
    const title = normalise(r.title);
    const line = normalise(scenarioLine(r.first_content));
    const inTitle = wanted.some((k) => title.includes(k));
    const inLine = !inTitle && wanted.some((k) => line.includes(k));
    if (inTitle || inLine) scored.push({ ...r, rank: inTitle ? 0 : 1 });
  }
  scored.sort((a, b) => a.rank - b.rank || new Date(b.created_at) - new Date(a.created_at));
  return scored;
}

/** Same, with English fallback when no localised document exists yet. */
async function findDocumentsWithFallback(keywords, language = 'en') {
  let docs = await findMatchingDocuments(keywords, language);
  if (docs.length === 0 && language !== 'en') docs = await findMatchingDocuments(keywords, 'en');
  return docs;
}

module.exports = { findMatchingDocuments, findDocumentsWithFallback, normalise, scenarioLine };
