const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

jest.mock('../src/config/db', () => require('./helpers/mockDb'));
jest.mock('../src/config/socket', () => ({ initSocket: jest.fn(), getIO: jest.fn(() => null), notifyStaff: jest.fn() }));
jest.mock('../src/services/ai/openaiClient', () => require('./helpers/openaiMock').createOpenAiMock());
jest.mock('../src/services/rag/retrievalService', () => ({ retrieveRelevantChunks: jest.fn() }));

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

describe('joinChunks', () => {
  it('removes the overlap between consecutive chunks', () => {
    const a = 'The quick brown fox jumps over the lazy dog. Another sentence follows here.';
    const b = 'Another sentence follows here. And then the tail end.';
    expect(joinChunks([a, b])).toBe('The quick brown fox jumps over the lazy dog. Another sentence follows here. And then the tail end.');
  });
});
