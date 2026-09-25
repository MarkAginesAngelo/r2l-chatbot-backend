jest.mock('../src/config/db', () => require('./helpers/mockDb'));
jest.mock('../src/config/socket', () => ({
  initSocket: jest.fn(),
  getIO: jest.fn(() => null),
  notifyStaff: jest.fn(),
}));
jest.mock('../src/services/ai/openaiClient', () => require('./helpers/openaiMock').createOpenAiMock());
jest.mock('../src/services/rag/retrievalService', () => ({ retrieveRelevantChunks: jest.fn() }));

const openaiClient = require('../src/services/ai/openaiClient');
const mockDb = require('./helpers/mockDb');
const { retrieveRelevantChunks } = require('../src/services/rag/retrievalService');
const { handleIncomingMessage } = require('../src/services/channels/messageHandler');

beforeEach(() => {
  mockDb.__reset();
  jest.clearAllMocks();
  openaiClient.detectLanguage.mockResolvedValue('en');
  openaiClient.translateToEnglish.mockImplementation(async (t, l) => (l === 'en' ? t : `[en] ${t}`));
  openaiClient.translateText.mockImplementation(async (t, l) => (l === 'en' ? t : `[${l}] ${t}`));
  openaiClient.generateAnswer.mockResolvedValue('MOCKED GROUNDED ANSWER');
  retrieveRelevantChunks.mockResolvedValue([
    { score: 0.95, documentId: 'd', chunkId: 'c', title: 't', content: 'x' },
  ]);
});

describe('Messenger conversation continuity (regression: PSID identity bug)', () => {
  const PSID = '1234567890';

  it('reuses the SAME conversation across messages from the same PSID, advancing through stages', async () => {
    const turn1 = await handleIncomingMessage({ channel: 'messenger', externalId: PSID, displayName: 'Test User', text: 'hi' });
    expect(turn1.stage).toBe('awaiting_language');

    const turn2 = await handleIncomingMessage({ channel: 'messenger', externalId: PSID, displayName: 'Test User', text: '1' });
    // This is the exact bug: before the fix, turn2 would ALSO come back as
    // 'awaiting_language' (a brand new conversation, greeting repeated)
    // instead of advancing to category selection.
    expect(turn2.stage).toBe('awaiting_category');
    expect(turn1.conversationId).toBe(turn2.conversationId);

    const turn3 = await handleIncomingMessage({ channel: 'messenger', externalId: PSID, displayName: 'Test User', text: '1' });
    expect(turn3.stage).toBe('awaiting_scenario');
    expect(turn3.conversationId).toBe(turn1.conversationId);
  });

  it('only creates ONE client row for repeated messages from the same PSID', async () => {
    await handleIncomingMessage({ channel: 'messenger', externalId: PSID, displayName: 'Test User', text: 'hi' });
    await handleIncomingMessage({ channel: 'messenger', externalId: PSID, displayName: 'Test User', text: '1' });
    await handleIncomingMessage({ channel: 'messenger', externalId: PSID, displayName: 'Test User', text: '1' });

    const { rows } = await mockDb.query('SELECT COUNT(*) FROM clients WHERE phone = $1', [PSID]);
    expect(parseInt(rows[0].count, 10)).toBe(1);
  });

  it('still keeps WhatsApp and Messenger clients independent by their own externalId', async () => {
    const waResult = await handleIncomingMessage({ channel: 'whatsapp', externalId: '94771234567', displayName: 'WA User', text: 'hi' });
    const fbResult = await handleIncomingMessage({ channel: 'messenger', externalId: PSID, displayName: 'FB User', text: 'hi' });
    expect(waResult.conversationId).not.toBe(fbResult.conversationId);
  });
});
