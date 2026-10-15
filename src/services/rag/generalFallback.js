const { retrieveRelevantChunks } = require('./retrievalService');

/**
 * Last-resort widening for general questions ("what are my rights if I am
 * arrested?"). The scenario/category filters only cover the scenario
 * documents, so general reference material — the Fundamental Rights chapter
 * of the Constitution, the UDHR, anything else R2L uploads — is only found by
 * an unfiltered search. Runs only when the scoped search was weak, and keeps
 * whichever result scores best.
 *
 * For Sinhala/Tamil users the original-language text is searched as well as the
 * English translation: those documents are written in Sinhala, and matching
 * Sinhala to Sinhala usually scores higher than matching English to Sinhala.
 */
async function widenToAllDocuments({ query, originalText, language, topK, chunks, bestScore, threshold }) {
  if (chunks.length > 0 && bestScore >= threshold) return { chunks, bestScore };

  const queries = [query];
  if (language !== 'en' && originalText && originalText !== query) queries.push(originalText);

  let best = { chunks, bestScore };
  for (const q of queries) {
    const found = await retrieveRelevantChunks(q, { limit: topK });
    const score = found[0]?.score ?? 0;
    if (score > best.bestScore) best = { chunks: found, bestScore: score };
  }
  return best;
}

module.exports = { widenToAllDocuments };
