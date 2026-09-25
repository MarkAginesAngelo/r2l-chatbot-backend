// One entry per scenario document in the knowledge base (see the 25
// scenario files uploaded to /api/documents). `titleKeywords` must be
// specific enough to match exactly ONE document within its category — these
// assume the documents are titled sensibly at upload time (e.g. "Police —
// Torture", "Family — Domestic Violence"); see the README for the exact
// recommended titles.
const SCENARIOS_BY_CATEGORY = {
  police: [
    { id: '1', key: 'police-torture', label: 'Physical assault / torture by police or prison officials', shortLabel: 'Torture / Assault', tokens: ['1', 'torture', 'assault', 'police-torture'], titleKeywords: ['torture'] },
    { id: '2', key: 'police-medical-negligence', label: 'Medical negligence / injuries not documented', shortLabel: 'Medical Negligence', tokens: ['2', 'medical negligence', 'jmo', 'police-medical-negligence'], titleKeywords: ['medical negligence'] },
    { id: '3', key: 'police-forced-confession', label: 'Forced statement or confession under duress', shortLabel: 'Forced Confession', tokens: ['3', 'forced confession', 'forced statement', 'duress', 'police-forced-confession'], titleKeywords: ['forced', 'duress'] },
    { id: '4', key: 'police-fabricated-charges-planted-drugs', label: 'Fabricated charges or planted drugs (PODDO)', shortLabel: 'Fabricated Charges', tokens: ['4', 'fabricated', 'planted drugs', 'poddo', 'police-fabricated-charges-planted-drugs'], titleKeywords: ['fabricated', 'planted drugs'] },
    { id: '5', key: 'police-bias-refusal', label: 'Police bias, harassment, or refusing a complaint', shortLabel: 'Bias / Refusal', tokens: ['5', 'bias', 'refusal', 'refuse', 'police-bias-refusal'], titleKeywords: ['bias', 'refusal'] },
    { id: '6', key: 'police-quick-actions', label: 'General help: R2L contact, Legal Aid, Know Your Rights', shortLabel: 'General Help', tokens: ['6', 'quick action', 'general help', 'police-quick-actions'], titleKeywords: ['quick action'] },
  ],
  cyber: [
    { id: '1', key: 'cyber-ncii-sextortion', label: 'Private photos, blackmail, or sextortion', shortLabel: 'NCII / Sextortion', tokens: ['1', 'sextortion', 'blackmail', 'nude', 'ncii', 'cyber-ncii-sextortion'], titleKeywords: ['sextortion', 'ncii'] },
    { id: '2', key: 'cyber-doxing-bullying', label: 'Cyberbullying or private info shared without consent', shortLabel: 'Bullying / Doxing', tokens: ['2', 'doxing', 'bullying', 'cyberbullying', 'cyber-doxing-bullying'], titleKeywords: ['doxing', 'bullying'] },
    { id: '3', key: 'cyber-death-threats', label: 'Death threats or threats of physical harm online', shortLabel: 'Death Threats', tokens: ['3', 'death threat', 'threats of physical harm', 'cyber-death-threats'], titleKeywords: ['death threat'] },
    { id: '4', key: 'cyber-hate-speech', label: 'Hate speech or incitement to violence', shortLabel: 'Hate Speech', tokens: ['4', 'hate speech', 'incitement', 'cyber-hate-speech'], titleKeywords: ['hate speech'] },
    { id: '5', key: 'cyber-hacking-impersonation', label: 'Hacked account or fake profile impersonating you', shortLabel: 'Hacking / Fake Profile', tokens: ['5', 'hacked', 'impersonation', 'fake profile', 'cyber-hacking-impersonation'], titleKeywords: ['hacking', 'impersonation'] },
    { id: '6', key: 'cyber-scams-phishing', label: 'Online scam, phishing, or financial fraud', shortLabel: 'Scams / Phishing', tokens: ['6', 'scam', 'phishing', 'cyber-scams-phishing'], titleKeywords: ['scam', 'phishing'] },
  ],
  financial: [
    { id: '1', key: 'financial-microfinance', label: 'Microfinance exploitation (sexual bribery / high interest)', shortLabel: 'Microfinance', tokens: ['1', 'microfinance', 'financial-microfinance'], titleKeywords: ['microfinance'] },
    { id: '2', key: 'financial-leasing-seizure', label: 'Vehicle/property seized illegally by a leasing company', shortLabel: 'Leasing Seizure', tokens: ['2', 'leasing', 'seizure', 'seized', 'financial-leasing-seizure'], titleKeywords: ['leasing', 'seizure'] },
    { id: '3', key: 'financial-labor-wage-theft', label: 'Unpaid wages, EPF/ETF issues', shortLabel: 'Wage Theft', tokens: ['3', 'wage theft', 'unpaid wages', 'epf', 'etf', 'financial-labor-wage-theft'], titleKeywords: ['wage theft', 'labor'] },
    { id: '4', key: 'financial-dismissal', label: 'Unfair dismissal or termination from a job', shortLabel: 'Unfair Dismissal', tokens: ['4', 'dismissal', 'terminated', 'financial-dismissal'], titleKeywords: ['dismissal'] },
    { id: '5', key: 'financial-foreign-employment-fraud', label: 'Foreign employment agency fraud, missing migrant worker', shortLabel: 'Foreign Employment Fraud', tokens: ['5', 'foreign employment', 'migrant worker', 'financial-foreign-employment-fraud'], titleKeywords: ['foreign employment'] },
  ],
  land: [
    { id: '1', key: 'land-state-transfers', label: 'State land transferred or permit cancelled arbitrarily', shortLabel: 'State Land Transfer', tokens: ['1', 'state land', 'permit cancel', 'land-state-transfers'], titleKeywords: ['state land', 'permit'] },
    { id: '2', key: 'land-local-government-disputes', label: 'Blocked road or shop removed without notice', shortLabel: 'Local Govt Dispute', tokens: ['2', 'road block', 'shop removed', 'pradeshiya', 'land-local-government-disputes'], titleKeywords: ['local government', 'road'] },
    { id: '3', key: 'land-environmental-elephant', label: 'Wildlife damage, elephants, or environmental harm', shortLabel: 'Environmental / Elephant', tokens: ['3', 'elephant', 'environmental', 'sand mining', 'land-environmental-elephant'], titleKeywords: ['environmental', 'elephant'] },
    { id: '4', key: 'land-documentation-denials', label: 'Denied a birth certificate or other official document', shortLabel: 'Documentation Denial', tokens: ['4', 'birth certificate', 'documentation', 'land-documentation-denials'], titleKeywords: ['documentation'] },
  ],
  family: [
    { id: '1', key: 'family-domestic-violence', label: 'Domestic violence or physical abuse at home', shortLabel: 'Domestic Violence', tokens: ['1', 'domestic violence', 'physical abuse', 'family-domestic-violence'], titleKeywords: ['domestic violence'] },
    { id: '2', key: 'family-child-custody', label: 'Denied access to your child / custody dispute', shortLabel: 'Child Custody', tokens: ['2', 'child custody', 'denial of access', 'family-child-custody'], titleKeywords: ['child custody'] },
    { id: '3', key: 'family-child-protection-abuse', label: 'A child being abused at school or elsewhere', shortLabel: 'Child Protection', tokens: ['3', 'child protection', 'child abuse', 'family-child-protection-abuse'], titleKeywords: ['child protection', 'child abuse'] },
  ],
};

const OTHER_OPTION_LABEL = 'Something else — let me describe my situation';

function getScenariosForCategory(categoryKey) {
  return SCENARIOS_BY_CATEGORY[categoryKey] || [];
}

/** Looks up a scenario's full definition (including titleKeywords, needed to
 * scope Qdrant retrieval) from the `scenario` key persisted on a
 * conversation row. Returns null if the category/key combination doesn't
 * exist (e.g. the scenario list changed after the conversation was created). */
function findScenarioByKey(categoryKey, scenarioKey) {
  if (!categoryKey || !scenarioKey) return null;
  return getScenariosForCategory(categoryKey).find((s) => s.key === scenarioKey) || null;
}

/**
 * Resolves a raw reply against a category's scenario list, or the trailing
 * "Other" option. Returns:
 *   { type: 'scenario', scenario }  — a specific scenario was picked
 *   { type: 'other' }               — user explicitly chose "describe it myself"
 *   null                            — no match; caller should treat the raw
 *                                      text as a real question, not re-prompt
 *                                      (people often type their situation
 *                                      directly instead of picking a number)
 */
function resolveScenarioSelection(categoryKey, rawInput) {
  const scenarios = getScenariosForCategory(categoryKey);
  const normalized = String(rawInput || '').trim().toLowerCase();
  const otherId = String(scenarios.length + 1);

  if (normalized === otherId || normalized === 'other' || normalized === `other-${categoryKey}`) {
    return { type: 'other' };
  }

  const exact = scenarios.find((s) => s.tokens.some((t) => t.toLowerCase() === normalized));
  if (exact) return { type: 'scenario', scenario: exact };

  const loose = scenarios.find((s) => s.tokens.some((t) => t.length >= 6 && normalized.includes(t.toLowerCase())));
  if (loose) return { type: 'scenario', scenario: loose };

  return null;
}

module.exports = {
  SCENARIOS_BY_CATEGORY,
  OTHER_OPTION_LABEL,
  getScenariosForCategory,
  resolveScenarioSelection,
  findScenarioByKey,
};
