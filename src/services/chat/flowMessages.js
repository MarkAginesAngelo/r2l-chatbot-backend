// Fixed wording for the conversation flow (greeting, the human-representative
// question, consent, and the personal-details questions). English / Sinhala /
// Tamil. R2L should review this wording — especially the consent text.

const GREETING =
  'Hello, and welcome to Right to Life Sri Lanka (R2L). 💚 You can talk to me safely here — this chat is confidential, ' +
  'and you do not have to share personal details. Tell me what is happening, in English, සිංහල or தமிழ், and I will do my best to help.\n\n' +
  'ආයුබෝවන්, Right to Life Sri Lanka (R2L) වෙත සාදරයෙන් පිළිගනිමු. 💚 ඔබට මෙහි ආරක්ෂිතව කතා කළ හැක — මෙම සංවාදය රහසිගතයි, ' +
  'පෞද්ගලික තොරතුරු දීමට ඔබට බැඳීමක් නැත. ඔබට සිදුවන දේ සිංහලෙන්, ඉංග්‍රීසියෙන් හෝ දෙමළෙන් මට කියන්න.\n\n' +
  'வணக்கம், Right to Life Sri Lanka (R2L)-க்கு வரவேற்கிறோம். 💚 இங்கே நீங்கள் பாதுகாப்பாகப் பேசலாம் — இந்த உரையாடல் இரகசியமானது, ' +
  'தனிப்பட்ட விவரங்களைத் தர வேண்டிய கட்டாயம் இல்லை. உங்களுக்கு என்ன நடக்கிறது என்பதை தமிழ், சிங்களம் அல்லது ஆங்கிலத்தில் சொல்லுங்கள்.';

const M = {
  handoffQuestion: {
    en: 'Would you like to speak with an R2L representative?',
    si: 'ඔබට R2L නියෝජිතයෙකු සමඟ කතා කිරීමට අවශ්‍යද?',
    ta: 'R2L பிரதிநிதி ஒருவருடன் பேச விரும்புகிறீர்களா?',
  },
  handoffAck: {
    en: 'Thank you. I have asked an R2L representative to follow up with you.',
    si: 'ස්තූතියි. R2L නියෝජිතයෙකු ඔබ හා සම්බන්ධ වන ලෙස මම දැනුම් දී ඇත.',
    ta: 'நன்றி. R2L பிரதிநிதி உங்களைத் தொடர்பு கொள்ளுமாறு நான் தெரிவித்துள்ளேன்.',
  },
  handoffDeclined: {
    en: 'No problem. If you need anything else, message me here at any time. Please take care.',
    si: 'කමක් නැහැ. ඔබට වෙනත් යමක් අවශ්‍ය නම්, ඕනෑම වේලාවක මෙහි පණිවිඩයක් එවන්න. ආරක්ෂාවෙන් සිටින්න.',
    ta: 'பரவாயில்லை. வேறு ஏதேனும் தேவைப்பட்டால் எப்போது வேண்டுமானாலும் இங்கே செய்தி அனுப்புங்கள். பாதுகாப்பாக இருங்கள்.',
  },
  consentQuestion: {
    en:
      'So that R2L can follow up with you, may we share your personal details (name, contact number, age and hometown) with Right to Life Sri Lanka? ' +
      'This is optional, and your details will only be used for follow-up and assistance.',
    si:
      'R2L හට ඔබ හා සම්බන්ධ වීමට හැකි වන පරිදි, ඔබේ පෞද්ගලික තොරතුරු (නම, සම්බන්ධ කර ගත හැකි දුරකථන අංකය, වයස, ගම/ප්‍රදේශය) Right to Life Sri Lanka සමඟ බෙදා ගැනීමට අපට ඔබේ අවසරය තිබේද? ' +
      'මෙය අනිවාර්ය නොවේ; ඔබේ තොරතුරු භාවිතා කරන්නේ පසු විපරම සහ සහාය සඳහා පමණි.',
    ta:
      'R2L உங்களைத் தொடர்பு கொள்ள, உங்கள் தனிப்பட்ட விவரங்களை (பெயர், தொடர்பு எண், வயது, சொந்த ஊர்) Right to Life Sri Lanka உடன் பகிர எங்களுக்கு உங்கள் சம்மதம் உள்ளதா? ' +
      'இது கட்டாயமில்லை; உங்கள் விவரங்கள் தொடர் நடவடிக்கை மற்றும் உதவிக்காக மட்டுமே பயன்படுத்தப்படும்.',
  },
  consentDeclined: {
    en: 'That is completely fine. I will not ask for any personal details. If you need anything else, message me here at any time.',
    si: 'කමක් නැහැ. මම කිසිදු පෞද්ගලික තොරතුරක් ඉල්ලන්නේ නැහැ. ඔබට වෙනත් යමක් අවශ්‍ය නම්, ඕනෑම වේලාවක මෙහි පණිවිඩයක් එවන්න.',
    ta: 'பரவாயில்லை. நான் எந்தத் தனிப்பட்ட விவரத்தையும் கேட்க மாட்டேன். வேறு ஏதேனும் தேவைப்பட்டால் எப்போது வேண்டுமானாலும் இங்கே செய்தி அனுப்புங்கள்.',
  },
  skipHint: {
    en: '(You can type "skip" if you prefer not to answer.)',
    si: '(පිළිතුරු දීමට අකමැති නම් "skip" ලෙස ටයිප් කරන්න.)',
    ta: '(பதில் அளிக்க விரும்பவில்லை என்றால் "skip" என்று தட்டச்சு செய்யுங்கள்.)',
  },
  askName: {
    en: 'Thank you. What is your name?',
    si: 'ස්තූතියි. ඔබේ නම කුමක්ද?',
    ta: 'நன்றி. உங்கள் பெயர் என்ன?',
  },
  askPhone: {
    en: 'What contact number can R2L reach you on?',
    si: 'R2L හට ඔබව සම්බන්ධ කර ගත හැකි දුරකථන අංකය කුමක්ද?',
    ta: 'R2L உங்களைத் தொடர்பு கொள்ளக்கூடிய தொலைபேசி எண் என்ன?',
  },
  badPhone: {
    en: 'That does not look like a phone number. Please type it again, for example 0771234567.',
    si: 'එය දුරකථන අංකයක් ලෙස නොපෙනේ. කරුණාකර නැවත ටයිප් කරන්න, උදා: 0771234567.',
    ta: 'அது தொலைபேசி எண்ணாகத் தெரியவில்லை. தயவுசெய்து மீண்டும் தட்டச்சு செய்யுங்கள், எ.கா. 0771234567.',
  },
  askAge: {
    en: 'How old are you?',
    si: 'ඔබේ වයස කීයද?',
    ta: 'உங்கள் வயது என்ன?',
  },
  badAge: {
    en: 'Please type your age as a number, for example 34.',
    si: 'කරුණාකර ඔබේ වයස ඉලක්කමකින් ටයිප් කරන්න, උදා: 34.',
    ta: 'உங்கள் வயதை எண்ணாகத் தட்டச்சு செய்யுங்கள், எ.கா. 34.',
  },
  askLocation: {
    en: 'Which town or area are you from?',
    si: 'ඔබ සිටින්නේ / පදිංචිව සිටින්නේ කුමන ගමේද / ප්‍රදේශයේද?',
    ta: 'நீங்கள் எந்த ஊர் / பகுதியைச் சேர்ந்தவர்?',
  },
  detailsDone: {
    en: 'Thank you. Your details have been shared with R2L, and a representative will be in touch. Please take care.',
    si: 'ස්තූතියි. ඔබේ තොරතුරු R2L සමඟ බෙදා ගන්නා ලදී; නියෝජිතයෙකු ඔබ හා සම්බන්ධ වනු ඇත. ආරක්ෂාවෙන් සිටින්න.',
    ta: 'நன்றி. உங்கள் விவரங்கள் R2L உடன் பகிரப்பட்டன; ஒரு பிரதிநிதி உங்களைத் தொடர்பு கொள்வார். பாதுகாப்பாக இருங்கள்.',
  },
  yes: { en: 'Yes', si: 'ඔව්', ta: 'ஆம்' },
  no: { en: 'No', si: 'නැහැ', ta: 'இல்லை' },
};

function t(key, language) {
  const entry = M[key];
  return entry[language] || entry.en;
}

function yesNoOptions(language) {
  return [
    { id: 'yes', key: 'yes', label: t('yes', language), shortLabel: t('yes', language) },
    { id: 'no', key: 'no', label: t('no', language), shortLabel: t('no', language) },
  ];
}

// --- Yes / no / skip recognition (English, Sinhala, Tamil) -----------------
const YES_WORDS = new Set([
  'y', 'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'sure', 'please', 'alright', 'definitely', 'ofcourse',
  'ඔව්', 'ඔව', 'හරි', 'ඔවු', 'කැමතියි', 'අවශ්‍යයි',
  'ஆம்', 'ஆமாம்', 'சரி', 'வேண்டும்', 'விரும்புகிறேன்',
]);
const NO_WORDS = new Set([
  'n', 'no', 'nope', 'nah', 'never', 'nothanks', 'notnow',
  'නැහැ', 'නැත', 'නෑ', 'එපා', 'නැ',
  'இல்லை', 'இல்ல', 'வேண்டாம்',
]);
const SKIP_WORDS = new Set(['skip', 'pass', 'none', 'na', 'n/a', '-']);

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[.,!?"'“”‘’()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** 'yes' | 'no' | null (not clearly either — treat as an ordinary message). */
function parseYesNo(text) {
  const tk = tokens(text);
  if (tk.length === 0 || tk.length > 6) return null;
  const joined = tk.join('');
  if (joined === 'nothanks' || joined === 'notnow') return 'no';
  if (tk[0] === 'no' || NO_WORDS.has(tk[0])) return 'no';
  if (YES_WORDS.has(tk[0])) return 'yes';
  if (tk.some((w) => YES_WORDS.has(w)) && !tk.some((w) => NO_WORDS.has(w))) return 'yes';
  return null;
}

function isSkip(text) {
  const tk = tokens(text);
  if (tk.length === 0) return false;
  return SKIP_WORDS.has(tk[0]) || NO_WORDS.has(tk[0]);
}

const GREETING_ONLY =
  /^(hi+|hello+|hey+|helo|hallo|good\s+(morning|afternoon|evening)|start|help|ayubowan|ආයුබෝවන්|හෙලෝ|හායි|හලෝ|සුබ\s+(උදෑසනක්|දහවලක්|සන්ධ්‍යාවක්)|வணக்கம்|ஹலோ|ஹாய்)(\s+(again|there|everyone|all|team))?[\s!.,]*$/i;

function isGreetingOnly(text) {
  const s = String(text || '').trim();
  return s.length > 0 && s.length <= 30 && GREETING_ONLY.test(s);
}

module.exports = { GREETING, t, yesNoOptions, parseYesNo, isSkip, isGreetingOnly };
