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

describe('Messenger long menu text (regression: #100 text > 640 on Button Template)', () => {
  it('sends an over-640-char list menu as plain text, then number buttons with a short prompt', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `${i}. ${'x'.repeat(60)}`).join('\n'); // ~1900+ chars
    await sendStageAwareReply('p', 'financial', { reply: long, options: opts, menuStyle: 'list', language: 'si' });
    const sent = client.sendMessengerMessage.mock.calls.map((c) => c[1]);
    expect(sent.join('\n')).toBe(long);
    sent.forEach((t) => expect(t.length).toBeLessThanOrEqual(2000));
    const [, body, buttons] = client.sendMessengerButtonTemplate.mock.calls[0];
    expect(body.length).toBeLessThanOrEqual(640);
    expect(buttons.length).toBeLessThanOrEqual(3);
  });

  it('keeps a short list menu as a single button template', async () => {
    await sendStageAwareReply('p', 'x', { reply: 'short', options: opts, menuStyle: 'list' });
    expect(client.sendMessengerMessage).not.toHaveBeenCalled();
    expect(client.sendMessengerButtonTemplate.mock.calls[0][1]).toBe('short');
  });
});
