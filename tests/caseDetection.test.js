// Free-text messages re-identify the case as the conversation goes on.
jest.mock('../src/config/db', () => require('./helpers/mockDb'));
jest.mock('../src/config/socket', () => ({ initSocket: jest.fn(), getIO: jest.fn(() => null), notifyStaff: jest.fn() }));
jest.mock('../src/services/ai/openaiClient', () => require('./helpers/openaiMock').createOpenAiMock());
jest.mock('../src/services/rag/retrievalService', () => ({ retrieveRelevantChunks: jest.fn() }));

const { v4: uuidv4 } = require('uuid');
const openaiClient = require('../src/services/ai/openaiClient');
const mockDb = require('./helpers/mockDb');
const { retrieveRelevantChunks } = require('../src/services/rag/retrievalService');
const { handleIncomingMessage } = require('../src/services/channels/messageHandler');
const { detectCase, buildCatalog } = require('../src/services/triage/caseClassifier');

beforeEach(() => {
  mockDb.__reset();
  jest.clearAllMocks();
  openaiClient.detectLanguage.mockResolvedValue('en');
  openaiClient.translateToEnglish.mockImplementation(async (t, l) => (l === 'en' ? t : `[en] ${t}`));
  openaiClient.generateAnswer.mockResolvedValue('MOCKED GROUNDED ANSWER');
  openaiClient.classifyCase.mockResolvedValue(null);
  retrieveRelevantChunks.mockResolvedValue([{ score: 0.95, documentId: uuidv4(), chunkId: uuidv4(), title: 't', content: 'x' }]);
});

const row = async (psid) =>
  (await mockDb.query('SELECT category, scenario FROM conversations WHERE client_id = (SELECT id FROM clients WHERE phone = $1)', [psid])).rows[0];

async function reachScenario(psid, cat, scn) {
  for (const t of ['hi', '1', String(cat), String(scn)]) await handleIncomingMessage({ channel: 'messenger', externalId: psid, text: t });
}

describe('detectCase', () => {
  it('returns the scenario for a confident valid answer and flags a change', async () => {
    openaiClient.classifyCase.mockResolvedValue({ scenario: 'cyber-ncii-sextortion', confidence: 0.9 });
    const r = await detectCase({ message: 'someone is blackmailing me with my photos', currentCategory: 'police', currentScenario: 'police-torture' });
    expect(r).toEqual({ category: 'cyber', scenario: 'cyber-ncii-sextortion', changed: true });
  });
  it('is not a change when the person stays on the current scenario', async () => {
    openaiClient.classifyCase.mockResolvedValue({ scenario: 'cyber-ncii-sextortion', confidence: 0.9 });
    const r = await detectCase({ message: 'what should I do next', currentCategory: 'cyber', currentScenario: 'cyber-ncii-sextortion' });
    expect(r.changed).toBe(false);
  });
  it('ignores low confidence, unknown keys, null, and tiny messages', async () => {
    openaiClient.classifyCase.mockResolvedValue({ scenario: 'cyber-ncii-sextortion', confidence: 0.3 });
    expect(await detectCase({ message: 'maybe something', currentScenario: null })).toBeNull();
    openaiClient.classifyCase.mockResolvedValue({ scenario: 'made-up-key', confidence: 0.99 });
    expect(await detectCase({ message: 'something happened', currentScenario: null })).toBeNull();
    openaiClient.classifyCase.mockResolvedValue({ scenario: null, confidence: 0.9 });
    expect(await detectCase({ message: 'thank you so much', currentScenario: null })).toBeNull();
    expect(await detectCase({ message: 'ok' })).toBeNull();
    expect(openaiClient.classifyCase).toHaveBeenCalledTimes(3);
  });
  it('catalog contains every scenario but not the "Other" option', () => {
    const keys = buildCatalog().map((c) => c.key);
    expect(keys).toContain('financial-microfinance');
    expect(keys).toContain('police-planted-drugs');
    expect(keys.some((k) => /other/i.test(k))).toBe(false);
  });
});

describe('conversation re-categorising as the chat goes on', () => {
  it('switches category and scenario when the person raises a different problem, and answers from the new scenario', async () => {
    const psid = 'cd-1';
    await reachScenario(psid, 1, 1); // Police -> torture
    expect(await row(psid)).toEqual({ category: 'police', scenario: 'police-torture' });

    openaiClient.classifyCase.mockResolvedValue({ scenario: 'cyber-ncii-sextortion', confidence: 0.92 });
    retrieveRelevantChunks.mockClear();
    const out = await handleIncomingMessage({ channel: 'messenger', externalId: psid, text: 'also someone is threatening to leak my private photos' });

    expect(await row(psid)).toEqual({ category: 'cyber', scenario: 'cyber-ncii-sextortion' });
    expect(out.reply).toBe('MOCKED GROUNDED ANSWER');
    expect(retrieveRelevantChunks).toHaveBeenCalled();
  });

  it('keeps the current scenario when the classifier has no opinion', async () => {
    const psid = 'cd-2';
    await reachScenario(psid, 1, 1);
    await handleIncomingMessage({ channel: 'messenger', externalId: psid, text: 'what number do I call' });
    expect(await row(psid)).toEqual({ category: 'police', scenario: 'police-torture' });
  });

  it('uses the approved Sinhala text as context for a Sinhala free-text question', async () => {
    const psid = 'cd-3';
    openaiClient.detectLanguage.mockResolvedValue('si');
    await reachScenario(psid, 1, 1);
    openaiClient.classifyCase.mockResolvedValue({ scenario: 'financial-microfinance', confidence: 0.9 });
    await handleIncomingMessage({ channel: 'messenger', externalId: psid, text: 'මයික්‍රොෆිනෑන්ස් ණය ගැන' });
    const ctx = openaiClient.generateAnswer.mock.calls.at(-1)[0].contextChunks;
    expect(ctx[0].score).toBe(1);
    expect(/[඀-෿]/.test(ctx[0].content)).toBe(true);
  });
});
