jest.mock('../src/services/channels/messageHandler', () => ({ handleIncomingMessage: jest.fn() }));
jest.mock('../src/services/messenger/messengerClient', () => ({
  sendMessengerMessage: jest.fn(),
  sendMessengerQuickReplies: jest.fn(),
  sendMessengerButtonTemplate: jest.fn(),
}));
const client = require('../src/services/messenger/messengerClient');
const { sendStageAwareReply } = require('../src/controllers/messengerWebhookController');

beforeEach(() => jest.clearAllMocks());
const opts = Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, number: String(i + 1), label: `L${i}` }));

describe('Messenger list menus show every option at once (quick replies)', () => {
  it('sends all options as number chips under the full menu text, even when long', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `${i}. ${'x'.repeat(60)}`).join('\n');
    await sendStageAwareReply('p', 'financial', { reply: long, options: opts, menuStyle: 'list', language: 'si' });
    const sent = client.sendMessengerMessage.mock.calls.map((c) => c[1]);
    const [, lastText, chips] = client.sendMessengerQuickReplies.mock.calls[0];
    expect([...sent, lastText].join('\n')).toBe(long);
    [...sent, lastText].forEach((t) => expect(t.length).toBeLessThanOrEqual(2000));
    expect(chips.map((c) => c.label)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(chips.map((c) => c.id)).toEqual(opts.map((o) => o.key));
    expect(client.sendMessengerButtonTemplate).not.toHaveBeenCalled();
  });

  it('keeps a short menu as one message with all chips', async () => {
    await sendStageAwareReply('p', 'x', { reply: 'short', options: opts, menuStyle: 'list' });
    expect(client.sendMessengerMessage).not.toHaveBeenCalled();
    expect(client.sendMessengerQuickReplies.mock.calls[0][1]).toBe('short');
  });

  it('splits a long reply with no options into messages of <= 2000 chars', async () => {
    const long = Array.from({ length: 50 }, (_, i) => `${i}. ${'y'.repeat(48)}`).join('\n'); // ~2500 chars
    await sendStageAwareReply('p', 'x', { reply: long });
    const sent = client.sendMessengerMessage.mock.calls.map((c) => c[1]);
    expect(sent.length).toBeGreaterThan(1);
    sent.forEach((t) => expect(t.length).toBeLessThanOrEqual(2000));
    expect(sent.join('\n')).toBe(long);
  });
});
