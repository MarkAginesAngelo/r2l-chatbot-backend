// Matches R2L's requested onboarding menu exactly (categories 1-6, category 6
// being the "immediate danger" escape hatch rather than a topic).
//
// `titleKeywords` are matched against uploaded documents' titles (case-
// insensitive) to scope retrieval to the right category once selected — see
// getQdrantFilterForCategory() in categoryFilter.js. This works with the
// existing document titles you already uploaded (e.g. "Police Harassment,
// Torture & Arbitrary Arrest") without needing a new documents.category
// column or re-uploading anything.
const CATEGORIES = [
  {
    id: '1',
    key: 'police',
    label: 'Police Harassment, Assault, or Arrest',
    i18n: { si: { label: 'පොලිස් හිරිහැර, වධහිංසා සහ අසාධාරණ ලෙස අත්අඩංගුවට ගැනීම් (සිවිල්, දේශපාලන සහ වධහිංසා)' }, ta: { label: 'பொலிஸாரின் துன்புறுத்தல், தாக்குதல் அல்லது கைது' } },
    shortLabel: '1. Police / Arrest',
    tokens: ['1', 'police', 'harassment', 'assault', 'arrest', 'cat_police'],
    titleKeywords: ['police', 'torture', 'arbitrary arrest'],
    goldenRule:
      'If you are currently in police custody or facing an immediate arrest, do not physically resist, ' +
      'as this may lead to further violence. Under the law, you have the right to be informed of the ' +
      'reason for your arrest. You may politely ask the officers why you are being detained. However, if ' +
      'they are aggressive, stay calm and silent. Try to memorize the badge numbers, names, and ranks of ' +
      'the officers, as well as the license plates of any vehicles used. If you are injured, your absolute ' +
      'first priority is to demand medical attention.',
  },
  {
    id: '2',
    key: 'cyber',
    label: 'Online Blackmail, Fake Profiles & Cybercrimes',
    i18n: { si: { label: 'අන්තර්ජාල බ්ලැක්මේල්, ව්‍යාජ ගිණුම් සහ සයිබර් අපරාධ' }, ta: { label: 'இணையவழியில் அச்சுறுத்தி பணம் பறித்தல், போலி சுயவிவரங்கள் மற்றும் இணையக் குற்றங்கள்' } },
    shortLabel: '2. Cybercrime',
    tokens: ['2', 'cyber', 'cybercrime', 'blackmail', 'fake profile', 'cat_cyber'],
    titleKeywords: ['cybercrime', 'digital harassment', 'privacy'],
    goldenRule:
      'Before taking any action, do NOT delete the messages, photos, videos, or the chat of the incident. ' +
      "Immediately take clear screenshots of everything, including the perpetrator's profile URL, phone " +
      'number, and the date/time. This is your evidence.',
  },
  {
    id: '3',
    key: 'financial',
    label: 'Financial Scams, Unpaid Wages, or Microfinance',
    i18n: { si: { label: 'මූල්‍ය, කම්කරු සහ ක්ෂුද්‍ර මූල්‍ය සූරාකෑම් (සමාජීය සහ ආර්ථික)' }, ta: { label: 'நிதி மோசடிகள், ஊதியம் வழங்கப்படாமை அல்லது நுண்நிதி' } },
    shortLabel: '3. Financial / Wages',
    tokens: ['3', 'financial', 'scam', 'wages', 'microfinance', 'cat_financial'],
    titleKeywords: ['financial', 'labor', 'microfinance'],
    goldenRule:
      'Do not sign any documents, blank papers, or agreements you do not understand or cannot read. Keep ' +
      'all receipts, bank deposit slips, and written correspondence. If you are being threatened ' +
      'physically, your safety comes first.',
  },
  {
    id: '4',
    key: 'land',
    label: 'Land, Housing, or Environmental Issues',
    i18n: { si: { label: 'ඉඩම්, නිවාස සහ පරිසරය (පළාත් පාලන සහ සිවිල් අයිතිවාසිකම්)' }, ta: { label: 'நிலம், வீடமைப்பு அல்லது சுற்றுச்சூழல் தொடர்பான பிரச்சினைகள்' } },
    shortLabel: '4. Land / Housing',
    tokens: ['4', 'land', 'housing', 'environment', 'environmental', 'cat_land'],
    titleKeywords: ['land', 'housing', 'environment'],
    goldenRule:
      'Do not sign over your land deeds, permits, or legal rights without consulting a lawyer. Keep ' +
      'physical and digital copies of all your permits, utility bills, and official letters. If you are ' +
      'facing an immediate threat of violence or forced illegal eviction, call the Police Emergency line (119).',
  },
  {
    id: '5',
    key: 'family',
    label: 'Domestic Violence, Family, or Child Welfare',
    i18n: { si: { label: 'කාන්තාවන්, ළමයින් සහ පවුල' }, ta: { label: 'குடும்ப வன்முறை, குடும்பம் அல்லது குழந்தை நலன்' } },
    shortLabel: '5. Family / Child',
    tokens: ['5', 'domestic', 'family', 'child', 'welfare', 'women', 'cat_family'],
    titleKeywords: ['women', 'children', 'family', 'welfare'],
    goldenRule:
      'If you or your child are in immediate physical danger, your safety is the absolute priority. Do not ' +
      "wait for a dispute to escalate. Call 119 or the Women's Help Line 1938 immediately. You do not have " +
      'to face this alone.',
  },
  {
    id: '6',
    key: 'danger',
    label: 'I am in immediate physical danger',
    i18n: { si: { label: 'ඔබ සිටින්නේ ක්ෂණික ශාරීරික අනතුරක නම්' }, ta: { label: 'நீங்கள் உடனடி உடல்ரீதியான ஆபத்தில் இருந்தால்' } },
    shortLabel: '6. Danger — Urgent',
    tokens: ['6', 'danger', 'emergency', 'help now', 'urgent', 'cat_danger'],
    titleKeywords: [],
    goldenRule: null,
  },
];

const LANGUAGES = [
  { id: '1', code: 'en', label: 'English', shortLabel: 'English', tokens: ['1', 'english', 'en', 'lang_en'] },
  {
    id: '2',
    code: 'si',
    label: 'සිංහල (Sinhala)',
    shortLabel: 'සිංහල',
    tokens: ['2', 'sinhala', 'si', 'සිංහල', 'lang_si'],
  },
  {
    id: '3',
    code: 'ta',
    label: 'தமிழ் (Tamil)',
    shortLabel: 'தமிழ்',
    tokens: ['3', 'tamil', 'ta', 'தமிழ்', 'lang_ta'],
  },
];

function resolveLanguageSelection(rawInput) {
  const normalized = String(rawInput || '').trim().toLowerCase();
  const exact = LANGUAGES.find((l) => l.tokens.some((t) => t.toLowerCase() === normalized));
  if (exact) return exact.code;
  // fall back to substring match, but only for tokens specific enough to be safe (avoid "1"/"2" false-matching inside longer text)
  const loose = LANGUAGES.find((l) => l.tokens.some((t) => t.length >= 4 && normalized.includes(t.toLowerCase())));
  return loose ? loose.code : null;
}

function resolveCategorySelection(rawInput) {
  const normalized = String(rawInput || '').trim().toLowerCase();
  const exact = CATEGORIES.find((c) => c.tokens.some((t) => t.toLowerCase() === normalized));
  if (exact) return exact;
  const loose = CATEGORIES.find((c) => c.tokens.some((t) => t.length >= 4 && normalized.includes(t.toLowerCase())));
  return loose || null;
}

module.exports = { CATEGORIES, LANGUAGES, resolveLanguageSelection, resolveCategorySelection };
