const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

jest.mock('../src/config/db', () => require('./helpers/mockDb'));
jest.mock('../src/config/socket', () => ({ initSocket: jest.fn(), getIO: jest.fn(() => null), notifyStaff: jest.fn() }));
jest.mock('../src/services/ai/openaiClient', () => require('./helpers/openaiMock').createOpenAiMock());
jest.mock('../src/services/rag/retrievalService', () => ({ retrieveRelevantChunks: jest.fn() }));

jest.mock('../src/services/triage/localContent', () => {
  const real = jest.requireActual('../src/services/triage/localContent');
  return {
    ...real,
    getScenarioParts: jest.fn(real.getScenarioParts),
    getQuickActionResponse: jest.fn(real.getQuickActionResponse),
  };
});
const localContent = require('../src/services/triage/localContent');

const openaiClient = require('../src/services/ai/openaiClient');
const mockDb = require('./helpers/mockDb');
const app = require('../src/app');
const { splitIntoParagraphs, stripBoilerplate, buildReplyParts } = require('../src/services/triage/replyFormatter');
const { joinChunks } = require('../src/services/triage/scenarioLookup');

beforeEach(() => {
  mockDb.__reset();
  jest.clearAllMocks();
  openaiClient.translateText.mockImplementation(async (t, l) => (l === 'en' ? t : `[${l}] ${t}`));
  openaiClient.translateDocument.mockImplementation(async (t, l) => (l === 'en' ? t : `[${l}] ${t}`));
});

const send = (body) => request(app).post('/api/chat').send(body);

describe('hand-written Sinhala menu wording', () => {
  it('shows the approved Sinhala category labels (not English, not machine-translated)', async () => {
    const start = await send({ message: 'hi' });
    const id = start.body.conversationId;
    const res = await send({ message: '2', conversationId: id }); // Sinhala

    expect(res.body.options).toHaveLength(6);
    expect(res.body.options[0].label).toBe('පොලිස් හිරිහැර, වධහිංසා සහ අසාධාරණ ලෙස අත්අඩංගුවට ගැනීම් (සිවිල්, දේශපාලන සහ වධහිංසා)');
    expect(res.body.options[4].label).toBe('කාන්තාවන්, ළමයින් සහ පවුල');
    expect(res.body.options[5].label).toBe('ඔබ සිටින්නේ ක්ෂණික ශාරීරික අනතුරක නම්');
    expect(res.body.options.every((o) => !('i18n' in o))).toBe(true);
    expect(res.body.reply).toContain('1. පොලිස් හිරිහැර');
    expect(res.body.reply).not.toMatch(/Police Harassment/);
  });

  it('shows the approved Sinhala scenario labels under a category, including "Other"', async () => {
    const start = await send({ message: 'hi' });
    const id = start.body.conversationId;
    await send({ message: '2', conversationId: id });
    const res = await send({ message: '1', conversationId: id }); // Police

    expect(res.body.options[0].label).toBe('පොලිසියෙන් හෝ බන්ධනාගාර නිලධාරීන්ගෙන් සිදුවන ශාරීරික පහරදීම් (වධහිංසා)');
    expect(res.body.options[res.body.options.length - 1].key).toBe('other');
    expect(res.body.options[res.body.options.length - 1].label).toMatch(/[඀-෿]/);
    expect(res.body.reply).toContain('1. පොලිසියෙන් හෝ බන්ධනාගාර');
  });

  it('keeps English labels for English users', async () => {
    const start = await send({ message: 'hi' });
    const id = start.body.conversationId;
    const res = await send({ message: '1', conversationId: id });
    expect(res.body.options[0].label).toBe('Police Harassment, Assault, or Arrest');
  });
});

describe('paragraph-wise answers', () => {
  it('removes the internal header line', () => {
    const out = stripBoilerplate('(R2L Digital Triage System — Knowledge Base Type: Police)\n\nFirst paragraph.');
    expect(out).toBe('First paragraph.');
    expect(stripBoilerplate('(R2L ඩිජිටල් ප්‍රමුඛතා ඇගයීමේ පද්ධතිය — දැනුම් මධ්‍යස්ථානය වර්ගය: )\n\nඑක.')).toBe('එක.');
  });

  it('splits on blank lines and splits long paragraphs at sentence ends', () => {
    expect(splitIntoParagraphs('A one.\n\nB two.\n\n\nC three.')).toEqual(['A one.', 'B two.', 'C three.']);
    const long = 'Sentence here. '.repeat(100).trim();
    const parts = splitIntoParagraphs(long, { maxLen: 200 });
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((p) => expect(p.length).toBeLessThanOrEqual(200));
    expect(parts.every((p) => p.endsWith('.'))).toBe(true);
  });

  it('only splits answers, never menus', () => {
    expect(buildReplyParts('a\n\nb', 'awaiting_category')).toEqual(['a\n\nb']);
    expect(buildReplyParts('a\n\nb', 'in_chat')).toEqual(['a', 'b']);
  });

  it('returns replyParts from /api/chat for a scenario answer', async () => {
    const start = await send({ message: 'hi' });
    const id = start.body.conversationId;
    await send({ message: '1', conversationId: id }); // English
    await send({ message: '1', conversationId: id }); // Police

    const docId = uuidv4();
    await mockDb.query(
      `INSERT INTO documents (id, title, file_path, file_type, status, language) VALUES ($1, $2, $3, $4, $5, $6)`,
      [docId, 'Police - Torture', '/tmp/x.txt', 'txt', 'processed', 'en']
    );
    await mockDb.query(`INSERT INTO document_chunks (id, document_id, chunk_index, content) VALUES ($1, $2, $3, $4)`, [
      uuidv4(), docId, 0,
      '(R2L Digital Triage System — Knowledge Base Type: Police)\n\nDo not resist.\n\nSeek a JMO examination.\n\nHRCSL: 1996',
    ]);

    const res = await send({ message: '1', conversationId: id });
    expect(res.body.replyParts).toEqual(['Do not resist.', 'Seek a JMO examination.', 'HRCSL: 1996']);
    expect(res.body.reply).not.toMatch(/Knowledge Base Type/);
    expect(res.body.options.length).toBe(3); // quick actions still offered
  });

  it('translates non-matching-language documents with translateDocument', async () => {
    const start = await send({ message: 'hi' });
    const id = start.body.conversationId;
    await send({ message: '3', conversationId: id });
    await send({ message: '1', conversationId: id });
    const docId = uuidv4();
    await mockDb.query(
      `INSERT INTO documents (id, title, file_path, file_type, status, language) VALUES ($1, $2, $3, $4, $5, $6)`,
      [docId, 'Police - Torture', '/tmp/x.txt', 'txt', 'processed', 'en']
    );
    await mockDb.query(`INSERT INTO document_chunks (id, document_id, chunk_index, content) VALUES ($1, $2, $3, $4)`, [uuidv4(), docId, 0, 'English guidance.']);
    localContent.getScenarioParts.mockReturnValueOnce(null);
    const res = await send({ message: '1', conversationId: id });
    expect(openaiClient.translateDocument).toHaveBeenCalledWith('English guidance.', 'ta');
    expect(res.body.reply).toBe('[ta] English guidance.');
  });
});

describe('curated Sinhala answers (from the R2L Sinhala document)', () => {
  async function pick(category, scenario) {
    const start = await send({ message: 'hi' });
    const id = start.body.conversationId;
    await send({ message: '2', conversationId: id }); // Sinhala
    await send({ message: category, conversationId: id });
    return send({ message: scenario, conversationId: id });
  }

  it('returns the exact approved text as paragraphs, with no translation or DB document', async () => {
    const res = await pick('3', '3'); // Financial -> wage theft / EPF-ETF
    expect(res.body.replyParts).toHaveLength(4);
    expect(res.body.replyParts[0]).toMatch(/^ඔබ උපයාගත් වැටුප් සහ ව්‍යවස්ථාපිත දීමනා \(EPF\/ETF\)/);
    expect(res.body.replyParts[1]).toMatch(/^ක්ෂණික ක්‍රියාමාර්ගය:/);
    expect(res.body.replyParts[2]).toMatch(/^යොමු කිරීම්:/);
    expect(res.body.replyParts[3]).toMatch(/0772255158/);
    expect(res.body.reply).not.toMatch(/Knowledge Base Type|දැනුම් මධ්‍යස්ථානය වර්ගය|\[බොත්තම්/);
    expect(openaiClient.translateDocument).not.toHaveBeenCalled();
    expect(res.body.stage).toBe('in_chat');
  });

  it('has curated text for every scenario in every category', () => {
    const { SCENARIOS_BY_CATEGORY } = require('../src/services/triage/scenarios');
    const { getScenarioParts } = require('../src/services/triage/localContent');
    for (const list of Object.values(SCENARIOS_BY_CATEGORY)) {
      for (const sc of list) {
        const parts = getScenarioParts(sc.key, 'si');
        expect(parts && parts.length).toBeGreaterThan(1);
        expect(sc.i18n.si.label).toBeTruthy();
      }
    }
  });

  it('keeps the police quick-action buttons after a police answer, and answers them in curated Sinhala', async () => {
    const res = await pick('1', '1');
    expect(res.body.options.map((o) => o.id)).toEqual(['contact_r2l', 'legal_aid', 'know_rights']);
    const qa = await send({ message: 'legal_aid', conversationId: res.body.conversationId });
    expect(qa.body.reply).toMatch(/070-365 5111/);
    expect(qa.body.reply).toMatch(/නීති ආධාර කොමිෂන් සභාව/);
  });

  it('shows the curated Sinhala emergency contact list for "immediate danger"', async () => {
    const start = await send({ message: 'hi' });
    const id = start.body.conversationId;
    await send({ message: '2', conversationId: id });
    const res = await send({ message: '6', conversationId: id });
    expect(res.body.needsHuman).toBe(true);
    expect(res.body.reply).toMatch(/119/);
    expect(res.body.reply).toMatch(/කරුණාකර අදාළ හදිසි සේවාව/);
    expect(res.body.replyParts.length).toBeGreaterThan(3);
  });

  it('splits Police into six scenarios (fabricated charges and planted drugs are separate)', async () => {
    const start = await send({ message: 'hi' });
    const id = start.body.conversationId;
    await send({ message: '1', conversationId: id });
    const res = await send({ message: '1', conversationId: id });
    expect(res.body.options.map((o) => o.key)).toEqual([
      'police-torture', 'police-medical-negligence', 'police-forced-confession',
      'police-fabricated-charges', 'police-planted-drugs', 'police-bias-refusal', 'other',
    ]);
  });
});

describe('curated Tamil answers (from the R2L Tamil document)', () => {
  async function pickTa(category, scenario) {
    const start = await send({ message: 'hi' });
    const id = start.body.conversationId;
    await send({ message: '3', conversationId: id }); // Tamil
    await send({ message: category, conversationId: id });
    return send({ message: scenario, conversationId: id });
  }

  it('shows the approved Tamil category and scenario labels', async () => {
    const start = await send({ message: 'hi' });
    const id = start.body.conversationId;
    const cats = await send({ message: '3', conversationId: id });
    expect(cats.body.options[0].label).toBe('பொலிஸாரின் துன்புறுத்தல், தாக்குதல் அல்லது கைது');
    expect(cats.body.options[5].label).toBe('நீங்கள் உடனடி உடல்ரீதியான ஆபத்தில் இருந்தால்');
    expect(cats.body.reply).toContain('1. பொலிஸாரின் துன்புறுத்தல்');
    const scs = await send({ message: '3', conversationId: id }); // Financial
    expect(scs.body.options[2].label).toBe('தொழிலாளர் சுரண்டல், ஊதிய மோசடி மற்றும் EPF/ETF தொடர்பான பிரச்சினைகள்');
    expect(scs.body.options[scs.body.options.length - 1].key).toBe('other');
    expect(scs.body.reply).not.toMatch(/Financial|Wage/);
  });

  it('returns the approved Tamil text as paragraphs, no header, no translation', async () => {
    const res = await pickTa('3', '3'); // wage theft / EPF-ETF
    expect(res.body.replyParts.length).toBeGreaterThanOrEqual(4);
    expect(res.body.replyParts[0]).toMatch(/^நீங்கள் உழைத்து பெற்ற ஊதியத்திற்கும்/);
    expect(res.body.replyParts[1]).toMatch(/^உடனடி நடவடிக்கை:/);
    expect(res.body.replyParts[2]).toMatch(/^இலங்கையில் தொடர்புகொள்ள வேண்டிய அமைப்பு:/);
    expect(res.body.replyParts[res.body.replyParts.length - 1]).toMatch(/0772255158/);
    expect(res.body.reply).not.toMatch(/\[பொத்தான்/);
    expect(openaiClient.translateDocument).not.toHaveBeenCalled();
  });

  it('has curated Tamil text and labels for every scenario', () => {
    const { SCENARIOS_BY_CATEGORY } = require('../src/services/triage/scenarios');
    const { CATEGORIES } = require('../src/services/triage/categories');
    for (const c of CATEGORIES) expect(c.i18n.ta.label).toBeTruthy();
    for (const list of Object.values(SCENARIOS_BY_CATEGORY)) {
      for (const sc of list) {
        const parts = localContent.getScenarioParts(sc.key, 'ta');
        expect(parts && parts.length).toBeGreaterThan(1);
        expect(sc.i18n.ta.label).toBeTruthy();
      }
    }
  });

  it('answers police quick actions and the emergency list in curated Tamil', async () => {
    const res = await pickTa('1', '1');
    expect(res.body.options.map((o) => o.id)).toEqual(['contact_r2l', 'legal_aid', 'know_rights']);
    expect(res.body.options[1].label).toBe('இலவச சட்ட உதவி (LAC)');
    const qa = await send({ message: 'legal_aid', conversationId: res.body.conversationId });
    expect(qa.body.reply).toMatch(/070-365 5111/);
    expect(qa.body.reply).toMatch(/சட்ட உதவி ஆணைக்குழு/);

    const start = await send({ message: 'hi' });
    const id = start.body.conversationId;
    await send({ message: '3', conversationId: id });
    const em = await send({ message: '6', conversationId: id });
    expect(em.body.needsHuman).toBe(true);
    expect(em.body.reply).toMatch(/119/);
    expect(em.body.replyParts.length).toBeGreaterThan(3);
  });
});

describe('joinChunks', () => {
  it('removes the overlap between consecutive chunks', () => {
    const a = 'The quick brown fox jumps over the lazy dog. Another sentence follows here.';
    const b = 'Another sentence follows here. And then the tail end.';
    expect(joinChunks([a, b])).toBe('The quick brown fox jumps over the lazy dog. Another sentence follows here. And then the tail end.');
  });
});

describe('stripBoilerplate on single-line documents (regression: empty reply -> Messenger #100)', () => {
  const { stripBoilerplate } = require('../src/services/triage/replyFormatter');
  it('removes only the bracketed header, keeping the answer, when the document is one line', () => {
    const doc = '(R2L Digital Triage System — Knowledge Base Type: Cyber (Doxing)) User Situation: Someone shared my private details. What to do: report to the CERT. Contacts: 1212.';
    const out = stripBoilerplate(doc);
    expect(out).toContain('report to the CERT');
    expect(out).not.toContain('Knowledge Base Type');
  });
  it('never returns an empty string for a non-empty document', () => {
    expect(stripBoilerplate('R2L Digital Triage System — Knowledge Base Type: Cyber').length).toBeGreaterThan(0);
  });
  it('still drops a short header line in a multi-line document', () => {
    expect(stripBoilerplate('(R2L Digital Triage System — Knowledge Base Type: Police)\n\nAnswer here.')).toBe('Answer here.');
  });
});

describe('formatKnowledgeDocument (English template -> readable paragraphs)', () => {
  const { formatKnowledgeDocument } = require('../src/services/triage/replyFormatter');
  const doc =
    'R2L DIGITAL TRIAGE — CATEGORY: Financial, Labor & Microfinance Exploitation SCENARIO: Illegal Leasing Seizures & Debt Collection Harassment GOLDEN RULE FOR FINANCIAL EXPLOITATION Do not sign any documents. USER SITUATION A vehicle was seized by a leasing company using force. GUIDANCE Leasing companies can recover assets, but cannot use force. IMMEDIATE ACTION If assaulted, go to hospital. REFERRAL / CONTACTS - If registered, seek relief through the Financial Ombudsman of Sri Lanka. Phone: 011-2595624. Website / complaint form: [www.financialombudsman.lk](https://www.financialombudsman.lk) - R2L support: 0772255158';
  it('drops the header and golden rule, splits sections, lists contacts, unwraps links', () => {
    const out = formatKnowledgeDocument(doc);
    expect(out).not.toMatch(/R2L DIGITAL TRIAGE|GOLDEN RULE|USER SITUATION/);
    expect(out.split('\n\n')).toHaveLength(4);
    expect(out).toContain('Guidance: Leasing companies');
    expect(out).toContain('What to do now: If assaulted');
    expect(out).toContain('• R2L support: 0772255158');
    expect(out).toContain('www.financialombudsman.lk');
    expect(out).not.toContain('](');
  });
  it('leaves non-template text alone', () => {
    expect(formatKnowledgeDocument('Just a plain answer.')).toBe('Just a plain answer.');
  });
});

describe('document title matching tolerates _ and - in titles', () => {
  it('matches "Police_Medical-Negligence" for the keyword "medical negligence"', async () => {
    const mockDb = require('./helpers/mockDb');
    const { v4: uuid } = require('uuid');
    mockDb.__reset();
    const id = uuid();
    await mockDb.query(`INSERT INTO documents (id, title, file_path, language, status) VALUES ($1, $2, 'x', 'en', 'processed')`, [id, 'Police_Medical-Negligence']);
    await mockDb.query(`INSERT INTO document_chunks (id, document_id, chunk_index, content) VALUES ($1, $2, 0, 'hello')`, [uuid(), id]);
    const { getScenarioDocumentContent } = require('../src/services/triage/scenarioLookup');
    const r = await getScenarioDocumentContent({ titleKeywords: ['medical negligence'] }, 'en');
    expect(r.found).toBe(true);
  });
});

describe('document matching by the SCENARIO line (title does not contain the keywords)', () => {
  it('finds "Land_State_Transfers" for "state land" via its SCENARIO line', async () => {
    const mockDb = require('./helpers/mockDb');
    const { v4: uuid } = require('uuid');
    mockDb.__reset();
    const id = uuid();
    await mockDb.query(`INSERT INTO documents (id, title, file_path, language, status) VALUES ($1, 'Land_Doc_3', 'x', 'en', 'processed')`, [id]);
    await mockDb.query(`INSERT INTO document_chunks (id, document_id, chunk_index, content) VALUES ($1, $2, 0, $3)`, [
      uuid(), id,
      'R2L DIGITAL TRIAGE — CATEGORY: Land, Housing SCENARIO: State Land Transfers & Permit Cancellations GOLDEN RULE Never leave. USER SITUATION text',
    ]);
    const { getScenarioDocumentContent } = require('../src/services/triage/scenarioLookup');
    const r = await getScenarioDocumentContent({ titleKeywords: ['state land', 'permit'] }, 'en');
    expect(r.found).toBe(true);
    expect(r.title).toBe('Land_Doc_3');
    // the category-wide golden-rule text must NOT cause a different scenario to match
    const other = await getScenarioDocumentContent({ titleKeywords: ['elephant'] }, 'en');
    expect(other.found).toBe(false);
  });
});
