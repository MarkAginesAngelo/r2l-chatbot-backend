// One entry per scenario document in the knowledge base (see the 25
// scenario files uploaded to /api/documents). `titleKeywords` must be
// specific enough to match exactly ONE document within its category — these
// assume the documents are titled sensibly at upload time (e.g. "Police —
// Torture", "Family — Domestic Violence"); see the README for the exact
// recommended titles.
const SCENARIOS_BY_CATEGORY = {
  police: [
    { id: '1', key: 'police-torture', label: 'Physical assault / torture by police or prison officials', i18n: { si: { label: 'පොලිසියෙන් හෝ බන්ධනාගාර නිලධාරීන්ගෙන් සිදුවන ශාරීරික පහරදීම් (වධහිංසා)' }, ta: { label: 'பொலிஸார் அல்லது சிறைச்சாலை அதிகாரிகளால் உடல் ரீதியான தாக்குதல் (சித்திரவதை)' } }, shortLabel: 'Torture / Assault', tokens: ['1', 'torture', 'assault', 'police-torture'], titleKeywords: ['torture'] },
    { id: '2', key: 'police-medical-negligence', label: 'Medical negligence / injuries not documented', i18n: { si: { label: 'වෛද්‍යවරුන්ගේ නොසැලකිල්ල / තුවාල නිසි ලෙස වාර්තා නොකිරීම' }, ta: { label: 'மருத்துவ அலட்சியம் / காயங்களை பதிவு செய்யத் தவறுதல்' } }, shortLabel: 'Medical Negligence', tokens: ['2', 'medical negligence', 'jmo', 'police-medical-negligence'], titleKeywords: ['medical negligence'] },
    { id: '3', key: 'police-forced-confession', label: 'Forced statement or confession under duress', i18n: { si: { label: 'බලපෑම් කර ලබාගන්නා කටඋත්තර සහ පාපොච්චාරණ' }, ta: { label: 'வற்புறுத்தலின் கீழ் கட்டாயப்படுத்தப்பட்ட அறிக்கைகள் மற்றும் வாக்குமூலங்கள்' } }, shortLabel: 'Forced Confession', tokens: ['3', 'forced confession', 'forced statement', 'duress', 'police-forced-confession'], titleKeywords: ['forced', 'duress'] },
    { id: '4', key: 'police-fabricated-charges', label: 'Fabricated (false) charges', i18n: { si: { label: 'ගොතන ලද බොරු චෝදනා එල්ල කිරීම' }, ta: { label: 'புனையப்பட்ட குற்றச்சாட்டுகள் (பொய்யான குற்றச்சாட்டுகள்)' } }, shortLabel: 'Fabricated Charges', tokens: ['4', 'fabricated', 'false charges', 'police-fabricated-charges'], titleKeywords: ['fabricated', 'planted drugs'] },
    { id: '5', key: 'police-planted-drugs', label: 'Drugs planted on you or a relative (PODDO Section 54)', i18n: { si: { label: 'මත්ද්‍රව්‍ය දමා අල්ලා ගැනීම (54 වැනි වගන්තිය / PODDO)' }, ta: { label: 'போதைப்பொருட்கள் வைக்கப்பட்டதாகக் கூறப்படும் வழக்குகள் (54ஆவது பிரிவு / PODDO)' } }, shortLabel: 'Planted Drugs', tokens: ['5', 'planted drugs', 'poddo', 'police-planted-drugs'], titleKeywords: ['planted drugs', 'fabricated'] },
    { id: '6', key: 'police-bias-refusal', label: 'Police bias, harassment, or refusing a complaint', i18n: { si: { label: 'පොලිසිය පක්ෂපාතීව කටයුතු කිරීම, හිරිහැර කිරීම් සහ පැමිණිලි භාරගැනීම ප්‍රතික්ෂේප කිරීම' }, ta: { label: 'பொலிஸாரின் பாரபட்சம், துன்புறுத்தல் மற்றும் முறைப்பாட்டை ஏற்க மறுத்தல்' } }, shortLabel: 'Bias / Refusal', tokens: ['6', 'bias', 'refusal', 'refuse', 'police-bias-refusal'], titleKeywords: ['bias', 'refusal'] },
  ],
  cyber: [
    { id: '1', key: 'cyber-ncii-sextortion', label: 'Private photos, blackmail, or sextortion', i18n: { si: { label: 'අවසරයකින් තොරව ලබාගත් පෞද්ගලික ඡායාරූප භාවිතා කිරීම සහ බ්ලැක්මේල් කිරීම් (ලිංගික කප්පම් ගැනීම්)' }, ta: { label: 'சம்மதமின்றி பகிரப்படும் அந்தரங்க படங்கள் (NCII) மற்றும் அச்சுறுத்தி பணம் பறித்தல் (Sextortion)' } }, shortLabel: 'NCII / Sextortion', tokens: ['1', 'sextortion', 'blackmail', 'nude', 'ncii', 'cyber-ncii-sextortion'], titleKeywords: ['sextortion', 'ncii'] },
    { id: '2', key: 'cyber-doxing-bullying', label: 'Cyberbullying or private info shared without consent', i18n: { si: { label: 'සයිබර් හිරිහැර සහ පෞද්ගලිකත්වය උල්ලංඝනය කිරීම් (ඩොක්සිං)' }, ta: { label: 'இணையவழி கொடுமைப்படுத்தல் மற்றும் தனியுரிமை மீறல் (Doxing)' } }, shortLabel: 'Bullying / Doxing', tokens: ['2', 'doxing', 'bullying', 'cyberbullying', 'cyber-doxing-bullying'], titleKeywords: ['doxing', 'bullying'] },
    { id: '3', key: 'cyber-death-threats', label: 'Death threats or threats of physical harm online', i18n: { si: { label: 'මරණ තර්ජන සහ ශාරීරික හානි කිරීමේ තර්ජන' }, ta: { label: 'கொலை மிரட்டல்கள் மற்றும் உடல் ரீதியான பாதிப்பை ஏற்படுத்துவதாக விடுக்கப்படும் அச்சுறுத்தல்கள்' } }, shortLabel: 'Death Threats', tokens: ['3', 'death threat', 'threats of physical harm', 'cyber-death-threats'], titleKeywords: ['death threat'] },
    { id: '4', key: 'cyber-hate-speech', label: 'Hate speech or incitement to violence', i18n: { si: { label: 'වෛරී ප්‍රකාශ සහ ප්‍රචණ්ඩත්වයට යොමු වන සේ ප්‍රකෝප කිරීම' }, ta: { label: 'வெறுப்புப் பேச்சு மற்றும் வன்முறைக்குத் தூண்டுதல்' } }, shortLabel: 'Hate Speech', tokens: ['4', 'hate speech', 'incitement', 'cyber-hate-speech'], titleKeywords: ['hate speech'] },
    { id: '5', key: 'cyber-hacking-impersonation', label: 'Hacked account or fake profile impersonating you', i18n: { si: { label: 'ගිණුම් හැක් කිරීම සහ වෙනත් අයෙකු ලෙස පෙනී සිටීම (ව්‍යාජ ගිණුම්/ප්‍රොෆයිල්)' }, ta: { label: 'கணக்கு ஊடுருவப்படல் மற்றும் ஆள்மாறாட்டம் (போலி கணக்குகள்)' } }, shortLabel: 'Hacking / Fake Profile', tokens: ['5', 'hacked', 'impersonation', 'fake profile', 'cyber-hacking-impersonation'], titleKeywords: ['hacking', 'impersonation'] },
    { id: '6', key: 'cyber-scams-phishing', label: 'Online scam, phishing, or financial fraud', i18n: { si: { label: 'මාර්ගගත වංචා, වංචනික නොමග යැවීම් (Phishing) සහ මූල්‍ය වංචා' }, ta: { label: 'இணையவழி மோசடிகள், Phishing மற்றும் நிதி மோசடி' } }, shortLabel: 'Scams / Phishing', tokens: ['6', 'scam', 'phishing', 'cyber-scams-phishing'], titleKeywords: ['scam', 'phishing'] },
  ],
  financial: [
    { id: '1', key: 'financial-microfinance', label: 'Microfinance exploitation (sexual bribery / high interest)', i18n: { si: { label: 'ක්ෂුද්‍ර මූල්‍ය සූරාකෑම්' }, ta: { label: 'நுண்நிதிச் சுரண்டல்' } }, shortLabel: 'Microfinance', tokens: ['1', 'microfinance', 'financial-microfinance'], titleKeywords: ['microfinance'] },
    { id: '2', key: 'financial-leasing-seizure', label: 'Vehicle/property seized illegally by a leasing company', i18n: { si: { label: 'නීති විරෝධී ලෙස ලීසිං වාහන අත්පත් කරගැනීම සහ ණය එකතු කිරීමේදී කරන හිරිහැර' }, ta: { label: 'சட்டவிரோத குத்தகைப் பொருள் பறிமுதல் மற்றும் கடன் வசூல் துன்புறுத்தல்' } }, shortLabel: 'Leasing Seizure', tokens: ['2', 'leasing', 'seizure', 'seized', 'financial-leasing-seizure'], titleKeywords: ['leasing', 'seizure'] },
    { id: '3', key: 'financial-labor-wage-theft', label: 'Unpaid wages, EPF/ETF issues', i18n: { si: { label: 'කම්කරු සූරාකෑම්, වැටුප් වංචා කිරීම සහ EPF/ETF ගැටලු' }, ta: { label: 'தொழிலாளர் சுரண்டல், ஊதிய மோசடி மற்றும் EPF/ETF தொடர்பான பிரச்சினைகள்' } }, shortLabel: 'Wage Theft', tokens: ['3', 'wage theft', 'unpaid wages', 'epf', 'etf', 'financial-labor-wage-theft'], titleKeywords: ['wage theft', 'labor'] },
    { id: '4', key: 'financial-dismissal', label: 'Unfair dismissal or termination from a job', i18n: { si: { label: 'රැකියාවෙන් පහ කිරීම' }, ta: { label: 'பணியிலிருந்து நீக்கப்படுதல்' } }, shortLabel: 'Unfair Dismissal', tokens: ['4', 'dismissal', 'terminated', 'financial-dismissal'], titleKeywords: ['dismissal'] },
    { id: '5', key: 'financial-foreign-employment-fraud', label: 'Foreign employment agency fraud, missing migrant worker', i18n: { si: { label: 'විදේශ රැකියා වංචා සහ අතුරුදහන් වූ සංක්‍රමණික ශ්‍රමිකයන්' }, ta: { label: 'வெளிநாட்டு வேலைவாய்ப்பு மோசடி மற்றும் காணாமல்போன புலம்பெயர் தொழிலாளர்கள்' } }, shortLabel: 'Foreign Employment Fraud', tokens: ['5', 'foreign employment', 'migrant worker', 'financial-foreign-employment-fraud'], titleKeywords: ['foreign employment'] },
  ],
  land: [
    { id: '1', key: 'land-state-transfers', label: 'State land transferred or permit cancelled arbitrarily', i18n: { si: { label: 'රජයේ ඉඩම් අත්තනෝමතික ලෙස පැවරීම සහ බලපත්‍ර අවලංගු කිරීම' }, ta: { label: 'அரச காணிகளை தன்னிச்சையாக வேறு நபர்களுக்கு மாற்றுதல் மற்றும் அனுமதிப்பத்திரங்களை இரத்துச் செய்தல்' } }, shortLabel: 'State Land Transfer', tokens: ['1', 'state land', 'permit cancel', 'land-state-transfers'], titleKeywords: ['state land', 'permit'] },
    { id: '2', key: 'land-local-government-disputes', label: 'Blocked road or shop removed without notice', i18n: { si: { label: 'පළාත් පාලන ආරවුල් (මාර්ග අවහිර කිරීම් සහ වෙළඳසැල් ඉවත් කිරීම්)' }, ta: { label: 'உள்ளூராட்சி மன்றம் தொடர்பான தகராறுகள் (வீதித் தடைகள் மற்றும் கடைகளை அகற்றுதல்)' } }, shortLabel: 'Local Govt Dispute', tokens: ['2', 'road block', 'shop removed', 'pradeshiya', 'land-local-government-disputes'], titleKeywords: ['local government', 'road'] },
    { id: '3', key: 'land-environmental-elephant', label: 'Wildlife damage, elephants, or environmental harm', i18n: { si: { label: 'පාරිසරික නොසැලකිල්ල සහ අලි-මිනිස් ගැටුම' }, ta: { label: 'சுற்றுச்சூழல் அலட்சியம் மற்றும் மனித யானை மோதல்' } }, shortLabel: 'Environmental / Elephant', tokens: ['3', 'elephant', 'environmental', 'sand mining', 'land-environmental-elephant'], titleKeywords: ['environmental', 'elephant'] },
    { id: '4', key: 'land-documentation-denials', label: 'Denied a birth certificate or other official document', i18n: { si: { label: 'රජයේ ලියකියවිලි ලබාදීම ප්‍රතික්ෂේප කිරීම සහ ප්‍රමාද කිරීම' }, ta: { label: 'அரச ஆவணங்களை வழங்க மறுத்தல் மற்றும் தாமதப்படுத்தல்' } }, shortLabel: 'Documentation Denial', tokens: ['4', 'birth certificate', 'documentation', 'land-documentation-denials'], titleKeywords: ['documentation'] },
  ],
  family: [
    { id: '1', key: 'family-domestic-violence', label: 'Domestic violence or physical abuse at home', i18n: { si: { label: 'ගෘහස්ථ හිංසනය සහ ශාරීරික අපයෝජනය' }, ta: { label: 'குடும்ப வன்முறை மற்றும் உடல் ரீதியான துன்புறுத்தல்' } }, shortLabel: 'Domestic Violence', tokens: ['1', 'domestic violence', 'physical abuse', 'family-domestic-violence'], titleKeywords: ['domestic violence'] },
    { id: '2', key: 'family-child-custody', label: 'Denied access to your child / custody dispute', i18n: { si: { label: 'ළමයින්ගේ භාරකාරත්වය සහ ළමයින් බැලීමට ඉඩ නොදීම' }, ta: { label: 'பிள்ளையின் பாதுகாப்புப் பொறுப்பு மற்றும் சந்திக்கும் உரிமை மறுக்கப்படுதல்' } }, shortLabel: 'Child Custody', tokens: ['2', 'child custody', 'denial of access', 'family-child-custody'], titleKeywords: ['child custody'] },
    { id: '3', key: 'family-child-protection-abuse', label: 'A child being abused at school or elsewhere', i18n: { si: { label: 'ළමා ආරක්ෂාව සහ අපයෝජනය (පාසලේදී/නිවසේදී)' }, ta: { label: 'சிறுவர் பாதுகாப்பு மற்றும் துன்புறுத்தல் (பாடசாலை/வீடு)' } }, shortLabel: 'Child Protection', tokens: ['3', 'child protection', 'child abuse', 'family-child-protection-abuse'], titleKeywords: ['child protection', 'child abuse'] },
  ],
};

const OTHER_OPTION_LABEL = 'Something else — let me describe my situation';
const OTHER_OPTION_I18N = {
  si: { label: 'වෙනත් කරුණක් — මගේ තත්වය විස්තර කිරීමට ඉඩ දෙන්න' },
  ta: { label: 'வேறு ஏதாவது — எனது நிலைமையை நானே விவரிக்கிறேன்' },
};

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
  OTHER_OPTION_I18N,
  getScenariosForCategory,
  resolveScenarioSelection,
  findScenarioByKey,
};
