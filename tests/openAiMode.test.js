// Hybrid ("open AI") answers: knowledge base first, general AI knowledge otherwise.
jest.mock('../src/config/db', () => require('./helpers/mockDb'));
jest.mock('../src/config/socket', () => ({ initSocket: jest.fn(), getIO: jest.fn(() => null), notifyStaff: jest.fn() }));
jest.mock('../src/services/ai/openaiClient', () => require('./helpers/openaiMock').createOpenAiMock());
jest.mock('../src/services/rag/retrievalService', () => ({ retrieveRelevantChunks: jest.fn() }));

const { v4: uuidv4 } = require('uuid');
const openaiClient = require('../src/services/ai/openaiClient');
const mockDb = require('./helpers/mockDb');
const { retrieveRelevantChunks } = require('../src/services/rag/retrievalService');
const { handleIncomingMessage } = require('../src/services/channels/messageHandler');
const { composeAnswer } = require('../src/services/ai/answerPolicy');

const strong = [{ score: 0.95, documentId: uuidv4(), chunkId: uuidv4(), title: 't', content: 'KB TEXT' }];

beforeEach(() => {
  mockDb.__reset();
  jest.clearAllMocks();
  openaiClient.detectLanguage.mockResolvedValue('en');
  openaiClient.generateAnswer.mockResolvedValue('MOCKED GROUNDED ANSWER');
  openaiClient.generateOpenAnswer.mockResolvedValue('MOCKED OPEN ANSWER');
  openaiClient.classifyCase.mockResolvedValue(null);
});

async function setMode(value) {
  await mockDb.query(`INSERT INTO settings (key, value) VALUES ('ai_mode', $1)`, [JSON.stringify(value)]);
}

describe('composeAnswer', () => {
  const base = { text: 'q', language: 'en', threshold: 0.72, history: [] };

  it('hybrid (default): passes the knowledge base when it is strong', async () => {
    const r = await composeAnswer({ ...base, chunks: strong, bestScore: 0.95 });
    expect(r).toEqual({ reply: 'MOCKED OPEN ANSWER', needsHuman: false });
    expect(openaiClient.generateOpenAnswer.mock.calls[0][0].contextChunks).toHaveLength(1);
  });

  it('hybrid: still answers (no handoff) when the knowledge base has nothing', async () => {
    const r = await composeAnswer({ ...base, chunks: [], bestScore: 0 });
    expect(r.needsHuman).toBe(false);
    expect(r.reply).toBe('MOCKED OPEN ANSWER');
    expect(openaiClient.generateOpenAnswer.mock.calls[0][0].contextChunks).toEqual([]);
  });

  it('hybrid: ignores weak chunks instead of presenting them as approved', async () => {
    await composeAnswer({ ...base, chunks: [{ ...strong[0], score: 0.3 }], bestScore: 0.3 });
    expect(openaiClient.generateOpenAnswer.mock.calls[0][0].contextChunks).toEqual([]);
  });

  it('hybrid: [[HANDOFF]] is stripped and flags a human', async () => {
    openaiClient.generateOpenAnswer.mockResolvedValue('Get to safety now.\n[[HANDOFF]]');
    const r = await composeAnswer({ ...base, chunks: [], bestScore: 0 });
    expect(r).toEqual({ reply: 'Get to safety now.', needsHuman: true });
  });

  it('kb_only: hands off when the knowledge base cannot answer', async () => {
    await setMode('kb_only');
    const r = await composeAnswer({ ...base, chunks: [], bestScore: 0 });
    expect(r.needsHuman).toBe(true);
    expect(openaiClient.generateOpenAnswer).not.toHaveBeenCalled();
  });

  it('kb_only: grounded answer uses the strict generator', async () => {
    await setMode('kb_only');
    const r = await composeAnswer({ ...base, chunks: strong, bestScore: 0.95 });
    expect(r).toEqual({ reply: 'MOCKED GROUNDED ANSWER', needsHuman: false });
  });
});

describe('channel flow', () => {
  it('a question the knowledge base cannot answer gets an AI reply, no handoff', async () => {
    retrieveRelevantChunks.mockResolvedValue([]);
    const send = (text) => handleIncomingMessage({ channel: 'messenger', externalId: 'psid-open', text });
    for (const t of ['hi', '1', '1', '1']) await send(t);
    const r = await send('how long does a court case usually take in Sri Lanka?');
    expect(r.reply).toBe('MOCKED OPEN ANSWER');
    expect(r.needsHuman).toBe(false);
    const { rows } = await mockDb.query(`SELECT status FROM conversations`);
    expect(rows[0].status).not.toBe('needs_human');
  });
});
