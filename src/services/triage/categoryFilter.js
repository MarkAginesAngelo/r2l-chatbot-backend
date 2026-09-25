const db = require('../../config/db');

/**
 * Builds a Qdrant filter restricting search to documents whose title matches
 * the selected category's keywords. Falls back to no filter (search
 * everything) if no matching documents exist yet — e.g. category 5
 * (family/welfare) before R2L's dedicated document is uploaded — so the bot
 * degrades gracefully instead of returning nothing.
 */
async function getQdrantFilterForCategory(category) {
  if (!category || !category.titleKeywords || category.titleKeywords.length === 0) {
    return undefined;
  }

  const conditions = category.titleKeywords.map((_, i) => `title ILIKE $${i + 1}`).join(' OR ');
  const params = category.titleKeywords.map((kw) => `%${kw}%`);

  const { rows } = await db.query(
    `SELECT id FROM documents WHERE (${conditions}) AND status = 'processed'`,
    params
  );

  if (rows.length === 0) return undefined;

  return {
    should: rows.map((r) => ({ key: 'document_id', match: { value: r.id } })),
  };
}

module.exports = { getQdrantFilterForCategory };
