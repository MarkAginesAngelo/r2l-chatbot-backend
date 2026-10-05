const { translateText } = require('../ai/openaiClient');
const { CATEGORIES, LANGUAGES } = require('./categories');
const { OTHER_OPTION_LABEL, OTHER_OPTION_I18N } = require('./scenarios');
const { getGoldenRule, getEmergencyMessage } = require('./localContent');

// Shown before we know the user's language, so it's trilingual by necessity.
// The options are also sent as real tappable buttons on every channel
// (website widget, WhatsApp interactive buttons/list, Messenger quick
// replies) — this text is intentionally just the question, not a repeated
// numbered list, since the buttons themselves already carry the choices
// (Messenger/WhatsApp cap a button's own label at 20 characters, so those
// buttons show a short form like "English" / "සිංහල" rather than a full
// sentence — see LANGUAGES.shortLabel in categories.js). Typing "1"/"2"/"3"
// still works as a fallback for anyone who can't see buttons.
const GREETING_MESSAGE =
  'Welcome to the Right to Life (R2L) Human Rights First Aid platform. ' +
  'Your safety is our absolute priority, and this chat is anonymous.\n\n' +
  'Which language would you prefer? Tap a button below.\n' +
  'ඔබ කැමති භාෂාව කුමක්ද? (බොත්තමක් ඔබන්න)\n' +
  'நீங்கள் விரும்பும் மொழி எது? (பொத்தானை அழுத்தவும்)';

// The numbered list is spelled out here in full (Messenger/WhatsApp button
// text is capped at 20 characters by the platform, so a button can only
// ever show an abbreviation like "2. Cybercrime" — this text is where the
// full sentence lives). The buttons themselves are then just the numbers
// (see messengerWebhookController.js), so tapping "2" and reading "2." in
// this list line up.
// Hand-written Sinhala wording for the fixed menu sentences. Machine-
// translating these (as is still done for Tamil) produced awkward Sinhala,
// and the option lines themselves come from each item's `i18n.si.label`
// (see categories.js / scenarios.js) rather than being translated at all.
const MENU_INTROS = {
  si: {
    category:
      'ස්තූතියි. ඔබගේ අනන්‍යතාවය සහ සංවාද ඉතිහාසය සම්පූර්ණයෙන්ම රහසිගතව පවතී. ' +
      'පහත අංකයක් ඔබන්න, නැතහොත් සම්පූර්ණ විස්තරය කියවන්න:',
    scenario:
      'මෙයින් ඔබේ තත්වයට වඩාත් ආසන්න වන්නේ කුමක්ද? පහත අංකයක් ඔබන්න, සම්පූර්ණ විස්තරය කියවන්න, ' +
      'නැතහොත් ඕනෑම අවස්ථාවක ඔබේ ප්‍රශ්නය සෘජුවම ටයිප් කරන්න.',
  },
  ta: {
    category:
      'நன்றி. உங்கள் அடையாளமும் உரையாடல் வரலாறும் முழுமையாக இரகசியமாகவே இருக்கும். ' +
      'கீழே உள்ள எண்ணை அழுத்தவும், அல்லது முழு விவரத்தையும் வாசிக்கவும்:',
    scenario:
      'இவற்றில் உங்கள் நிலைமைக்கு மிக நெருக்கமானது எது? கீழே உள்ள எண்ணை அழுத்தவும், முழு விவரத்தையும் ' +
      'வாசிக்கவும், அல்லது எந்த நேரத்திலும் உங்கள் கேள்வியை நேரடியாக தட்டச்சு செய்யவும்.',
  },
};

/** The option's wording in `language`: the hand-written i18n label when one
 * exists (Sinhala), otherwise the English label. */
function labelIn(item, language) {
  return item.i18n?.[language]?.label || item.label;
}

function buildCategoryMenuEnglish() {
  const lines = CATEGORIES.map((c) => `${c.id}. ${c.label}`);
  return (
    'Thank you. Your identity and chat history remain completely anonymous. ' +
    'Tap a number below, or read the full description:\n\n' +
    lines.join('\n')
  );
}

async function buildCategoryMenuMessage(language) {
  if (language === 'en') return buildCategoryMenuEnglish();
  if (MENU_INTROS[language]) {
    const lines = CATEGORIES.map((c) => `${c.id}. ${labelIn(c, language)}`);
    return `${MENU_INTROS[language].category}\n\n${lines.join('\n')}`;
  }
  return translateText(buildCategoryMenuEnglish(), language);
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
  lines.push(`${scenarios.length + 1}. ${OTHER_OPTION_LABEL}`);
  const goldenRulePart = category.goldenRule ? `${category.goldenRule}\n\n` : '';
  return (
    `${goldenRulePart}Which of these is closest to your situation? Tap a number below, read the full ` +
    `description, or just type your question directly at any point.\n\n${lines.join('\n')}`
  );
}

async function buildScenarioMenuMessage(category, scenarios, language) {
  if (language === 'en') return buildScenarioMenuEnglish(category, scenarios);
  if (MENU_INTROS[language]) {
    // Golden Rule: curated text when we have it, machine translation otherwise.
    const goldenText =
      getGoldenRule(category.key, language) ||
      (category.goldenRule ? await translateText(category.goldenRule, language) : null);
    const golden = goldenText ? `${goldenText}\n\n` : '';
    const lines = scenarios.map((s) => `${s.id}. ${labelIn(s, language)}`);
    lines.push(`${scenarios.length + 1}. ${OTHER_OPTION_I18N[language].label}`);
    return `${golden}${MENU_INTROS[language].scenario}\n\n${lines.join('\n')}`;
  }
  return translateText(buildScenarioMenuEnglish(category, scenarios), language);
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
  const curated = getEmergencyMessage(language);
  if (curated) return curated;
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
