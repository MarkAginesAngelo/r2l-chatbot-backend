// Website chat pipeline: retrieval context, history, strict (kb_only) mode.
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

jest.mock('../src/config/db', () => require('./helpers/mockDb'));
jest.mock('../src/config/socket', () => ({ initSocket: jest.fn(), getIO: jest.fn(() => null), notifyStaff: jest.fn() }));
jest.mock('../src/services/ai/openaiClient', () => require('./helpers/openaiMock').createOpenAiMock());
jest.mock('../src/services/rag/retrievalService', () => ({ retrieveRelevantChunks: jest.fn() }));

const openaiClient = require('../src/services/ai/openaiClient');
const mockDb = require('./helpers/mockDb');
const app = require('../src/app');
const { retrieveRelevantChunks } = require('../src/services/rag/retrievalService');

beforeEach(() => {
  mockDb.__reset();
  jest.clearAllMocks();
  openaiClient.detectLanguage.mockResolvedValue('en');
  openaiClient.translateToEnglish.mockImplementation(async (t, l) => (l === 'en' ? t : `[en] ${t}`));
  openaiClient.generateAnswer.mockResolvedValue('MOCKED GROUNDED ANSWER');
  openaiClient.generateOpenAnswer.mockResolvedValue('MOCKED OPEN ANSWER');
  openaiClient.classifyCase.mockResolvedValue(null);
  retrieveRelevantChunks.mockResolvedValue([
    { score: 0.95, documentId: uuidv4(), chunkId: uuidv4(), title: 'Police Torture', content: 'Seek medical attention.' },
  ]);
});

const send = (body) => request(app).post('/api/chat').send(body);

async function start() {
  const first = await send({ message: 'hi' });
  return first.body.conversationId;
}

describe('website chat pipeline', () => {
  it('answers a real question grounded in the knowledge base', async () => {
    const id = await start();
    const res = await send({ message: 'a question about my rights', conversationId: id });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('MOCKED OPEN ANSWER');
    expect(res.body.needsHuman).toBe(false);
    expect(retrieveRelevantChunks).toHaveBeenCalledWith(expect.stringContaining('a question about my rights'), expect.any(Object));
    const args = openaiClient.generateOpenAnswer.mock.calls[0][0];
    expect(args.contextChunks[0].content).toBe('Seek medical attention.');
  });

  it('includes recent conversation context in the retrieval query for a vague follow-up', async () => {
    const id = await start();
    await send({ message: 'the police assaulted me during my arrest', conversationId: id });
    retrieveRelevantChunks.mockClear();
    await send({ message: 'what should I do now', conversationId: id });
    const [queryUsed] = retrieveRelevantChunks.mock.calls[0];
    expect(queryUsed).toContain('what should I do now');
    expect(queryUsed).toContain('assaulted');
  });

  it('passes recent history to the answer generator, not just the current message', async () => {
    const id = await start();
    await send({ message: 'the police assaulted me during my arrest', conversationId: id });
    openaiClient.generateOpenAnswer.mockClear();
    await send({ message: 'what should I do now', conversationId: id });
    const [args] = openaiClient.generateOpenAnswer.mock.calls[0];
    expect(args.history.some((h) => h.content.includes('assaulted'))).toBe(true);
  });

  it('returns the reply split into paragraphs', async () => {
    const id = await start();
    openaiClient.generateOpenAnswer.mockResolvedValueOnce('First point.\n\nSecond point.\n\nThird point.');
    const res = await send({ message: 'tell me what to do', conversationId: id });
    expect(res.body.replyParts).toEqual(['First point.', 'Second point.', 'Third point.']);
  });

  it('rejects a chat request against a conversationId that does not exist', async () => {
    const res = await send({ message: 'hello', conversationId: uuidv4() });
    expect(res.status).toBe(404);
  });

  it('rejects an empty message', async () => {
    const res = await send({ message: '' });
    expect(res.status).toBe(400);
  });
});

describe('strict knowledge-base-only mode (ai_mode = kb_only)', () => {
  beforeEach(async () => {
    await mockDb.query(`INSERT INTO settings (key, value) VALUES ('ai_mode', $1)`, [JSON.stringify('kb_only')]);
  });

  it('flags a human handoff when retrieval confidence is below threshold', async () => {
    retrieveRelevantChunks.mockResolvedValue([{ score: 0.2, documentId: uuidv4(), chunkId: uuidv4(), title: 't', content: 'x' }]);
    const id = await start();
    const res = await send({ message: 'something unrelated', conversationId: id });
    expect(res.body.needsHuman).toBe(true);
    expect(openaiClient.generateOpenAnswer).not.toHaveBeenCalled();
  });

  it('flags a human handoff when nothing is retrieved at all', async () => {
    retrieveRelevantChunks.mockResolvedValue([]);
    const id = await start();
    const res = await send({ message: 'anything', conversationId: id });
    expect(res.body.needsHuman).toBe(true);
  });

  it('uses the strict generator when the knowledge base can answer', async () => {
    const id = await start();
    const res = await send({ message: 'police torture', conversationId: id });
    expect(res.body.reply).toBe('MOCKED GROUNDED ANSWER');
  });
});
