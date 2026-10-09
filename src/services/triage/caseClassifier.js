const { classifyCase } = require('../ai/openaiClient');
const { CATEGORIES } = require('./categories');
const { SCENARIOS_BY_CATEGORY, findScenarioByKey } = require('./scenarios');
const { getScenarioParts } = require('./localContent');

// Below this the model is guessing; keep the current scenario instead of
// jumping to a doubtful one.
const MIN_CONFIDENCE = 0.6;

/** Flat list of every real scenario (the "Other" option is not a scenario). */
function buildCatalog() {
  const catalog = [];
  for (const [category, scenarios] of Object.entries(SCENARIOS_BY_CATEGORY)) {
    for (const s of scenarios) catalog.push({ key: s.key, label: s.label, category });
  }
  return catalog;
}

/**
 * Re-identifies the case from what the person just wrote (plus recent turns).
 * Returns { category, scenario, changed } when a confident, valid scenario is
 * found, or null to leave the conversation as it is.
 *   changed === true  -> the person moved to a different scenario than the
 *                        one stored on the conversation.
 */
async function detectCase({ message, history = [], currentCategory, currentScenario }) {
  if (!message || String(message).trim().length < 3) return null;

  const catalog = buildCatalog();
  const result = await classifyCase({ message, history, catalog, currentScenario });
  if (!result?.scenario || result.confidence < MIN_CONFIDENCE) return null;

  const entry = catalog.find((c) => c.key === result.scenario);
  if (!entry) return null; // model returned a key we don't have

  const category = CATEGORIES.find((c) => c.key === entry.category);
  if (!category) return null;

  return {
    category: entry.category,
    scenario: entry.key,
    changed: entry.key !== currentScenario || entry.category !== currentCategory,
  };
}

/** The approved Sinhala/Tamil text for a scenario as a context chunk, so the
 * model answers a free-text question from the reviewed wording (the uploaded
 * knowledge-base documents are English). */
function curatedContextChunk(scenarioKey, language) {
  const parts = getScenarioParts(scenarioKey, language);
  if (!parts) return null;
  return { score: 1, chunkId: null, documentId: null, title: scenarioKey, content: parts.join('\n\n') };
}

module.exports = { detectCase, curatedContextChunk, buildCatalog, MIN_CONFIDENCE };
