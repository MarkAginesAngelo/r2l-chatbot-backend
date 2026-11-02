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
});

describe('curated Sinhala and Tamil content (used as approved context by the chatbot)', () => {
  const { SCENARIOS_BY_CATEGORY } = require('../src/services/triage/scenarios');
  const { CATEGORIES } = require('../src/services/triage/categories');
  const { getScenarioParts, getEmergencyMessage } = localContent;

  it('has approved Sinhala and Tamil text and labels for every scenario', () => {
    for (const c of CATEGORIES) {
      expect(c.i18n.si.label).toBeTruthy();
      expect(c.i18n.ta.label).toBeTruthy();
    }
    for (const list of Object.values(SCENARIOS_BY_CATEGORY)) {
      for (const sc of list) {
        for (const lang of ['si', 'ta']) {
          const parts = getScenarioParts(sc.key, lang);
          expect(parts && parts.length).toBeGreaterThan(1);
          expect(sc.i18n[lang].label).toBeTruthy();
        }
      }
    }
  });

  it('keeps the exact approved wording and contact numbers', () => {
    const si = getScenarioParts('financial-wage-theft', 'si') || getScenarioParts(SCENARIOS_BY_CATEGORY.financial[2].key, 'si');
    expect(si).toHaveLength(4);
    expect(si[0]).toMatch(/^ඔබ උපයාගත් වැටුප් සහ ව්‍යවස්ථාපිත දීමනා \(EPF\/ETF\)/);
    expect(si.join('\n')).toMatch(/0772255158/);
    const ta = getScenarioParts(SCENARIOS_BY_CATEGORY.financial[2].key, 'ta');
    expect(ta[0]).toMatch(/^நீங்கள் உழைத்து பெற்ற ஊதியத்திற்கும்/);
    expect(ta.join('\n')).toMatch(/0772255158/);
  });

  it('has curated emergency contact lists', () => {
    expect(getEmergencyMessage('si')).toMatch(/119/);
    expect(getEmergencyMessage('si')).toMatch(/කරුණාකර අදාළ හදිසි සේවාව/);
    expect(getEmergencyMessage('ta')).toMatch(/119/);
  });

  it('splits Police into six scenarios (fabricated charges and planted drugs are separate)', () => {
    expect(SCENARIOS_BY_CATEGORY.police.map((s) => s.key)).toEqual([
      'police-torture', 'police-medical-negligence', 'police-forced-confession',
      'police-fabricated-charges', 'police-planted-drugs', 'police-bias-refusal',
    ]);
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
