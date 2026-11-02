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
  openaiClient.generateOpenAnswer.mockResolvedValue('MOCKED OPEN ANSWER');
  openaiClient.classifyCase.mockResolvedValue(null);
  retrieveRelevantChunks.mockResolvedValue([
    { score: 0.95, documentId: require('uuid').v4(), chunkId: require('uuid').v4(), title: 't', content: 'x' },
  ]);
});

describe('Messenger conversation continuity (regression: PSID identity bug)', () => {
  const PSID = '1234567890';
  const send = (text, extra = {}) =>
    handleIncomingMessage({ channel: 'messenger', externalId: PSID, displayName: 'Test User', text, ...extra });

  it('reuses the SAME conversation across messages from the same PSID', async () => {
    const turn1 = await send('hi');
    const turn2 = await send('my landlord wants me out');
    const turn3 = await send('he gave me 3 days');
    // Before the fix every message created a brand new conversation.
    expect(turn2.conversationId).toBe(turn1.conversationId);
    expect(turn3.conversationId).toBe(turn1.conversationId);
  });

  it('only creates ONE client row for repeated messages from the same PSID', async () => {
    await send('hi');
    await send('my landlord wants me out');
    await send('he gave me 3 days');

    const { rows } = await mockDb.query('SELECT COUNT(*) FROM clients WHERE phone = $1', [PSID]);
    expect(parseInt(rows[0].count, 10)).toBe(1);
  });

  it('still keeps WhatsApp and Messenger clients independent by their own externalId', async () => {
    const waResult = await handleIncomingMessage({ channel: 'whatsapp', externalId: '94771234567', displayName: 'WA User', text: 'hi' });
    const fbResult = await send('hi');
    expect(waResult.conversationId).not.toBe(fbResult.conversationId);
  });
});
