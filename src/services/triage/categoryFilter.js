const db = require('../../config/db');

/**
 * Shared by getQdrantFilterForCategory and getQdrantFilterForScenario: finds
 * processed documents whose title matches the given keywords AND whose
 * language matches the conversation's language (falling back to English if
 * no localized version exists yet), then returns a Qdrant filter scoped to
 * exactly those documents' ids — or undefined if none match, so the caller
 * degrades to an unfiltered search instead of returning nothing.
 */
async function buildTitleKeywordFilter(titleKeywords, language = 'en') {
  if (!titleKeywords || titleKeywords.length === 0) return undefined;

  const conditions = titleKeywords.map((_, i) => `replace(replace(title, '_', ' '), '-', ' ') ILIKE $${i + 1}`).join(' OR ');
  const params = titleKeywords.map((kw) => `%${kw}%`);

  const langParamIndex = params.length + 1;
  let { rows } = await db.query(
    `SELECT id FROM documents WHERE (${conditions}) AND status = 'processed' AND language = $${langParamIndex}`,
    [...params, language]
  );

  // Fall back to English documents if no localized version exists yet for
  // this topic — better to ground in the right topic, wrong language (the
  // reply is still translated at generation time) than find nothing.
  if (rows.length === 0 && language !== 'en') {
    ({ rows } = await db.query(
      `SELECT id FROM documents WHERE (${conditions}) AND status = 'processed' AND language = 'en'`,
      params
    ));
  }

  if (rows.length === 0) return undefined;

  return {
    should: rows.map((r) => ({ key: 'document_id', match: { value: r.id } })),
  };
}

/**
 * Builds a Qdrant filter restricting search to documents whose title matches
 * the selected category's keywords AND whose language matches the
 * conversation's language. Falls back to no filter (search everything) if
 * no matching documents exist yet — e.g. category 5 (family/welfare) before
 * R2L's dedicated document is uploaded — so the bot degrades gracefully
 * instead of returning nothing.
 *
 * Language matching matters once multiple language versions of the same
 * document exist (e.g. "Police - Torture" uploaded separately in en/si/ta
 * with identical titles): without this, an English query could retrieve
 * Sinhala-language chunks purely because the title keywords matched,
 * producing a grounded-but-wrong-language answer.
 */
async function getQdrantFilterForCategory(category, language = 'en') {
  if (!category || !category.titleKeywords || category.titleKeywords.length === 0) {
    return undefined;
  }
  return buildTitleKeywordFilter(category.titleKeywords, language);
}

/**
 * Same as getQdrantFilterForCategory, but scoped to a single scenario's
 * titleKeywords (e.g. ['sextortion', 'ncii'] for the NCII/blackmail
 * scenario) rather than the whole category. Used once a user has picked a
 * specific scenario, so a follow-up free-text question stays grounded in
 * THAT scenario's document — and its contact numbers/referrals — instead of
 * potentially surfacing another scenario's details from the same category
 * (e.g. giving a sextortion victim the wage-theft hotline because both are
 * filed under a broader category).
 */
async function getQdrantFilterForScenario(scenario, language = 'en') {
  if (!scenario || !scenario.titleKeywords || scenario.titleKeywords.length === 0) {
    return undefined;
  }
  return buildTitleKeywordFilter(scenario.titleKeywords, language);
}

module.exports = { getQdrantFilterForCategory, getQdrantFilterForScenario };
