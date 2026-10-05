// Curated, human-reviewed answer text that ships with the bot (see
// src/content/siContent.json, built from R2L's "Digital Triage System —
// Sinhala" document). When a user's language has curated content for what
// they picked, it is used verbatim — no machine translation, no database
// lookup — so the wording is exactly what R2L approved. Anything not covered
// here falls back to the uploaded knowledge-base documents as before.
const CONTENT = {
  si: require('../../content/siContent.json'),
};

/** The answer for a scenario as an array of paragraphs, or null if there's no
 * curated text for this language/scenario. */
function getScenarioParts(scenarioKey, language) {
  const parts = CONTENT[language]?.scenarios?.[scenarioKey];
  return parts?.length ? parts : null;
}

function getGoldenRule(categoryKey, language) {
  return CONTENT[language]?.goldenRules?.[categoryKey] || null;
}

function getQuickActionResponse(actionId, language) {
  return CONTENT[language]?.quickActions?.[actionId] || null;
}

function getEmergencyMessage(language) {
  return CONTENT[language]?.emergency || null;
}

module.exports = { getScenarioParts, getGoldenRule, getQuickActionResponse, getEmergencyMessage };
