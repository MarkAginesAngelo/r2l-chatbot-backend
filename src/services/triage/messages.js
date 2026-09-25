const { translateText } = require('../ai/openaiClient');
const { CATEGORIES, LANGUAGES } = require('./categories');

// Shown before we know the user's language, so it's trilingual by necessity.
const GREETING_MESSAGE =
  'Welcome to the Right to Life (R2L) Human Rights First Aid platform. ' +
  'Your safety is our absolute priority, and this chat is anonymous.\n\n' +
  'Which language would you prefer?\n' +
  '1. English\n' +
  '2. සිංහල (Sinhala)\n' +
  '3. தமிழ் (Tamil)\n\n' +
  'ඔබ කැමති භාෂාව කුමක්ද? (1, 2, හෝ 3 ලෙස පිළිතුරු දෙන්න)\n' +
  'நீங்கள் விரும்பும் மொழி எது? (1, 2, அல்லது 3 எனப் பதிலளிக்கவும்)';

function buildCategoryMenuEnglish() {
  const lines = CATEGORIES.map((c) => `${c.id}. ${c.label}`);
  return (
    'Thank you. Your identity and chat history remain completely anonymous. ' +
    'Please select the option that best describes your situation:\n\n' +
    lines.join('\n')
  );
}

async function buildCategoryMenuMessage(language) {
  const english = buildCategoryMenuEnglish();
  if (language === 'en') return english;
  return translateText(english, language);
}

async function buildCategoryAckMessage(category, language) {
  const goldenRulePart = category.goldenRule ? `${category.goldenRule}\n\n` : '';
  const english =
    `${goldenRulePart}Thank you. I'll help you with information about "${category.label}". ` +
    'Please describe your situation or ask your question, and I will guide you using ' +
    "R2L's official guidance for this topic.";
  if (language === 'en') return english;
  return translateText(english, language);
}

function buildScenarioMenuEnglish(category, scenarios) {
  const lines = scenarios.map((s) => `${s.id}. ${s.label}`);
  lines.push(`${scenarios.length + 1}. Something else — let me describe my situation`);
  const goldenRulePart = category.goldenRule ? `${category.goldenRule}\n\n` : '';
  return (
    `${goldenRulePart}Which of these is closest to your situation? You can also just type ` +
    `your question directly at any point.\n\n${lines.join('\n')}`
  );
}

async function buildScenarioMenuMessage(category, scenarios, language) {
  const english = buildScenarioMenuEnglish(category, scenarios);
  if (language === 'en') return english;
  return translateText(english, language);
}

async function buildDescribeSituationMessage(language) {
  const english = "Of course. Please describe your situation or ask your question, and I'll do my best to help.";
  if (language === 'en') return english;
  return translateText(english, language);
}

async function buildScenarioNotAvailableMessage(language) {
  const english =
    "I don't have detailed guidance for that specific situation uploaded yet. Please describe what happened " +
    "in your own words and I'll do my best with what R2L has provided so far, or connect you with a human representative.";
  if (language === 'en') return english;
  return translateText(english, language);
}

// Emergency contacts are official names/numbers — kept untranslated (numbers
// and organization names don't need translation and shouldn't risk being
// altered by translation); only the short lead-in sentence is localized.
const EMERGENCY_CONTACTS_BLOCK = `
🚨 Police Emergency Response: 119
🚑 Suwaseriya Ambulance: 1990
🐘 Dept. of Wildlife Conservation (wildlife emergencies): 1992
🛑 Ministry of Women Affairs Help Line (domestic violence/abuse): 1938
🛑 Women In Need (WIN) 24/7 Crisis Line: 077-5676555
🛑 National Child Protection Authority: 1929
🛑 Police Children & Women's Bureau: 011-2444444
⚖️ Human Rights Commission of Sri Lanka (HRCSL) — police abuse/torture: 1996
⚖️ Police Sahana Mediriya (Relief Desk, Police HQ): 011-2433333
⚖️ Inspector General of Police (IGP) direct line: 071-8598888
📱 Sri Lanka CERT (cyber threats): 101
📱 CID Computer Crime Investigation Division (CCID): 011-2381045
🤝 R2L Human Rights First Aid Hotline: 011-2669100
🤝 R2L General Support: 0772255158`;

async function buildEmergencyMessage(language) {
  const intro =
    'Please contact the relevant emergency service immediately. Do not wait. ' +
    'If you cannot speak safely, try to move to a secure location first. ' +
    'An R2L human rights defender has also been notified and will follow up with you here shortly.';
  const localizedIntro = language === 'en' ? intro : await translateText(intro, language);
  return `${localizedIntro}\n${EMERGENCY_CONTACTS_BLOCK}`;
}

module.exports = {
  GREETING_MESSAGE,
  buildCategoryMenuMessage,
  buildCategoryAckMessage,
  buildEmergencyMessage,
  buildScenarioMenuMessage,
  buildDescribeSituationMessage,
  buildScenarioNotAvailableMessage,
  CATEGORIES,
  LANGUAGES,
};
