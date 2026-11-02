// Covers R2L's testing-team feedback (Messenger live test, Sept 2026):
//  1. Language/category/scenario menus should be button-first, not "reply
//     with a number" (messenger button hardening covered separately in
//     messengerClient behavior below).
//  2. Once a specific scenario is picked, a follow-up question should stay
//     scoped to THAT scenario's contacts/referrals, not the whole category.
//  3. A returning WhatsApp/Messenger user should be asked from the start
//     again if their last message was more than `session_reset_hours` ago.

jest.mock('../src/config/db', () => require('./helpers/mockDb'));
jest.mock('../src/config/socket', () => ({
  initSocket: jest.fn(),
  getIO: jest.fn(() => null),
  notifyStaff: jest.fn(),
}));
jest.mock('../src/services/ai/openaiClient', () => require('./helpers/openaiMock').createOpenAiMock());
jest.mock('../src/services/rag/retrievalService', () => ({ retrieveRelevantChunks: jest.fn() }));

const { v4: uuidv4 } = require('uuid');
const openaiClient = require('../src/services/ai/openaiClient');
const mockDb = require('./helpers/mockDb');
const { retrieveRelevantChunks } = require('../src/services/rag/retrievalService');
const { handleIncomingMessage } = require('../src/services/channels/messageHandler');
const { getQdrantFilterForCategory, getQdrantFilterForScenario } = require('../src/services/triage/categoryFilter');

beforeEach(() => {
  mockDb.__reset();
  jest.clearAllMocks();
  openaiClient.detectLanguage.mockResolvedValue('en');
  openaiClient.translateToEnglish.mockImplementation(async (t, l) => (l === 'en' ? t : `[en] ${t}`));
  openaiClient.translateText.mockImplementation(async (t, l) => (l === 'en' ? t : `[${l}] ${t}`));
  openaiClient.generateOpenAnswer.mockResolvedValue('MOCKED OPEN ANSWER');
  openaiClient.classifyCase.mockResolvedValue(null);
  retrieveRelevantChunks.mockResolvedValue([
    { score: 0.95, documentId: uuidv4(), chunkId: uuidv4(), title: 't', content: 'x' },
  ]);
});

const send = (psid) => (text) => handleIncomingMessage({ channel: 'messenger', externalId: psid, text });
const row = async (psid) =>
  (await mockDb.query('SELECT category, scenario FROM conversations WHERE client_id = (SELECT id FROM clients WHERE phone = $1)', [psid])).rows[0];

describe('scenario-scoped retrieval (no cross-scenario contact leakage)', () => {
  it('remembers the scenario the AI recognised on the conversation row', async () => {
    openaiClient.classifyCase.mockResolvedValue({ scenario: 'cyber-ncii-sextortion', confidence: 0.9 });
    await send('scn-1')('someone is blackmailing me with my private photos');
    expect(await row('scn-1')).toEqual({ category: 'cyber', scenario: 'cyber-ncii-sextortion' });
  });

  it('scopes a follow-up question to the recognised scenario before widening', async () => {
    openaiClient.classifyCase.mockResolvedValue({ scenario: 'cyber-ncii-sextortion', confidence: 0.9 });
    await send('scn-2')('someone is blackmailing me with my private photos');

    retrieveRelevantChunks.mockClear();
    openaiClient.classifyCase.mockResolvedValue(null);
    await send('scn-2')('what number do I call');

    const [, options] = retrieveRelevantChunks.mock.calls[0];
    expect(options).toHaveProperty('filter');
  });

  it('keeps the scenario when the next message is a vague follow-up', async () => {
    openaiClient.classifyCase.mockResolvedValue({ scenario: 'cyber-ncii-sextortion', confidence: 0.9 });
    await send('scn-3')('someone is blackmailing me with my private photos');
    openaiClient.classifyCase.mockResolvedValue(null);
    await send('scn-3')('ok and then?');
    expect((await row('scn-3')).scenario).toBe('cyber-ncii-sextortion');
  });

  it('getQdrantFilterForScenario is scoped narrower than getQdrantFilterForCategory (different keyword sets)', async () => {
    const docId = uuidv4();
    await mockDb.query(
      `INSERT INTO documents (id, title, file_path, file_type, status, language) VALUES ($1, $2, $3, $4, $5, $6)`,
      [docId, 'Cyber - NCII Sextortion', '/tmp/x.txt', 'txt', 'processed', 'en']
    );
    const category = { titleKeywords: ['cybercrime', 'digital harassment', 'privacy'] };
    const scenario = { titleKeywords: ['sextortion', 'ncii'] };

    const scenarioFilter = await getQdrantFilterForScenario(scenario, 'en');
    const categoryFilter = await getQdrantFilterForCategory(category, 'en');

    expect(scenarioFilter).toEqual({ should: [{ key: 'document_id', match: { value: docId } }] });
    // The category's keyword list doesn't match this document's title at
    // all in this test, so it should NOT accidentally pick it up either —
    // proving the two filters are built independently, not aliases of the
    // same query.
    expect(categoryFilter).toBeUndefined();
  });
});

describe('session reset (a returning user starts a fresh conversation)', () => {
  it('resumes the same open conversation for a message sent well within the reset window', async () => {
    const psid = 'reset-1';
    const first = await send(psid)('hi');
    const second = await send(psid)('my landlord evicted me');
    expect(first.conversationId).toBe(second.conversationId);
  });

  it('starts a brand new conversation, with a greeting, once the conversation is older than session_reset_hours', async () => {
    const psid = 'reset-2';
    const first = await send(psid)('hi');
    await send(psid)('the police arrested my brother');

    await mockDb.query(`UPDATE conversations SET updated_at = now() - interval '25 hours' WHERE id = $1`, [first.conversationId]);

    const returning = await send(psid)('hi again');
    expect(returning.conversationId).not.toBe(first.conversationId);
    expect(returning.reply).toMatch(/welcome to Right to Life/);

    const { rows } = await mockDb.query('SELECT status FROM conversations WHERE id = $1', [first.conversationId]);
    expect(rows[0].status).toBe('closed');
  });

  it('honors a custom session_reset_hours setting instead of the 24h default', async () => {
    await mockDb.query(`INSERT INTO settings (key, value) VALUES ('session_reset_hours', '1') ON CONFLICT (key) DO UPDATE SET value = $1`, ['1']);

    const psid = 'reset-3';
    const first = await send(psid)('hi');
    await mockDb.query(`UPDATE conversations SET updated_at = now() - interval '2 hours' WHERE id = $1`, [first.conversationId]);

    const returning = await send(psid)('hi again');
    expect(returning.conversationId).not.toBe(first.conversationId);
  });
});

describe('Messenger quick-reply button hardening (item 1)', () => {
  const { sendMessengerQuickReplies } = require('../src/services/messenger/messengerClient');

  let fetchSpy;
  beforeEach(() => {
    fetchSpy = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchSpy;
  });

  it('sends every option as a real quick-reply button, never silently dropping any', async () => {
    const options = [
      { id: '1', label: 'Physical assault / torture by police or prison officials' },
      { id: '2', label: 'Medical negligence / injuries not documented' },
      { id: '7', label: 'Something else — let me describe my situation' },
    ];
    await sendMessengerQuickReplies('psid', 'menu text', options);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.message.quick_replies).toHaveLength(3);
    expect(body.message.quick_replies.map((q) => q.payload)).toEqual(['1', '2', '7']);
    body.message.quick_replies.forEach((q) => expect(q.title.length).toBeLessThanOrEqual(20));
  });

  it('caps at 13 quick replies and keeps titles unique even after 20-char truncation', async () => {
    const options = Array.from({ length: 15 }, (_, i) => ({
      id: String(i),
      label: 'Foreign Employment Fraud Extended Long Title', // identical after truncation
    }));
    await sendMessengerQuickReplies('psid', 'menu text', options);

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.message.quick_replies.length).toBeLessThanOrEqual(13);
    const titles = body.message.quick_replies.map((q) => q.title);
    expect(new Set(titles).size).toBe(titles.length); // no duplicate titles
  });
});
