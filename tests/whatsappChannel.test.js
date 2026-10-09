jest.mock('../src/services/channels/messageHandler', () => ({ handleIncomingMessage: jest.fn() }));
jest.mock('../src/services/whatsapp/whatsappClient', () => {
  const real = jest.requireActual('../src/services/whatsapp/whatsappClient');
  return { ...real, sendWhatsAppMessage: jest.fn(), sendWhatsAppButtons: jest.fn(), sendWhatsAppList: jest.fn() };
});

const crypto = require('crypto');
const env = require('../src/config/env');
const client = require('../src/services/whatsapp/whatsappClient');
const { handleIncomingMessage } = require('../src/services/channels/messageHandler');
const { sendStageAwareReply, receiveWebhook } = require('../src/controllers/whatsappWebhookController');

beforeEach(() => jest.clearAllMocks());

describe('WhatsApp sending', () => {
  it('sends paragraphs as separate messages and menus as a list', async () => {
    await sendStageAwareReply('94', { reply: 'x', replyParts: ['a', 'b'], options: [] });
    expect(client.sendWhatsAppMessage.mock.calls.map((c) => c[1])).toEqual(['a', 'b']);
  });

  it('uses buttons for <=3 options and a list for more, with numbers and localized button', async () => {
    const opts = (n) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, number: i + 1, label: `Label ${i}` }));
    await sendStageAwareReply('94', { reply: 'menu', options: opts(3) });
    expect(client.sendWhatsAppButtons).toHaveBeenCalled();
    await sendStageAwareReply('94', { reply: 'menu', options: opts(6), language: 'si' });
    const [, , button, rows] = client.sendWhatsAppList.mock.calls[0];
    expect(button).toBe('විකල්පයක් තෝරන්න');
    expect(rows[0]).toMatchObject({ id: 'k0', number: 1 });
  });

  it('sends an over-1024-char menu body as plain text and a short prompt on the list', async () => {
    const long = 'x'.repeat(1500);
    const options = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, label: 'L' }));
    await sendStageAwareReply('94', { reply: long, options });
    expect(client.sendWhatsAppMessage).toHaveBeenCalledWith('94', long);
    expect(client.sendWhatsAppList.mock.calls[0][1].length).toBeLessThan(100);
  });
});

describe('WhatsApp payload limits', () => {
  it('builds list rows within Meta limits', async () => {
    const real = jest.requireActual('../src/services/whatsapp/whatsappClient');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const label = 'මුල්‍ය ආයතන, මයික්‍රොෆිනෑන්ස් සහ ණය පිළිබඳ ගැටළු සඳහා උදව් ලබා ගැනීම';
    await real.sendWhatsAppList('94', 'b'.repeat(2000), 'Select an option that is long', [{ id: 'a', number: 1, label }]);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const row = body.interactive.action.sections[0].rows[0];
    expect([...row.title].length).toBeLessThanOrEqual(24);
    expect([...row.description].length).toBeLessThanOrEqual(72);
    expect(body.interactive.body.text.length).toBeLessThanOrEqual(1024);
    expect(body.interactive.action.button.length).toBeLessThanOrEqual(20);
  });
});

describe('WhatsApp webhook', () => {
  const res = () => ({ sendStatus: jest.fn() });
  const payload = (ids) => ({
    entry: [{ changes: [{ value: { contacts: [{ wa_id: '94', profile: { name: 'N' } }], messages: ids.map((id) => ({ id, from: '94', type: 'text', text: { body: 'hi' } })) } }] }],
  });

  it('handles every message in a batch and ignores duplicate deliveries', async () => {
    handleIncomingMessage.mockResolvedValue({ reply: 'ok' });
    await receiveWebhook({ body: payload(['m1', 'm2']), headers: {} }, res());
    await receiveWebhook({ body: payload(['m1']), headers: {} }, res());
    expect(handleIncomingMessage).toHaveBeenCalledTimes(2);
  });

  it('rejects a bad signature when an app secret is configured', async () => {
    env.whatsapp.appSecret = 's3cret';
    const bad = res();
    await receiveWebhook({ body: payload(['m9']), headers: { 'x-hub-signature-256': 'sha256=bad' }, rawBody: Buffer.from('{}') }, bad);
    expect(bad.sendStatus).toHaveBeenCalledWith(403);
    const raw = Buffer.from('{}');
    const sig = `sha256=${crypto.createHmac('sha256', 's3cret').update(raw).digest('hex')}`;
    const good = res();
    handleIncomingMessage.mockResolvedValue({ reply: 'ok' });
    await receiveWebhook({ body: payload(['m10']), headers: { 'x-hub-signature-256': sig }, rawBody: raw }, good);
    expect(good.sendStatus).toHaveBeenCalledWith(200);
    env.whatsapp.appSecret = undefined;
  });
});
