// The menu-free conversation flow shared by website, WhatsApp and Messenger.
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');

jest.mock('../src/config/db', () => require('./helpers/mockDb'));
jest.mock('../src/config/socket', () => ({ initSocket: jest.fn(), getIO: jest.fn(() => null), notifyStaff: jest.fn() }));
jest.mock('../src/services/ai/openaiClient', () => require('./helpers/openaiMock').createOpenAiMock());
jest.mock('../src/services/rag/retrievalService', () => ({ retrieveRelevantChunks: jest.fn() }));

const openaiClient = require('../src/services/ai/openaiClient');
const mockDb = require('./helpers/mockDb');
const { retrieveRelevantChunks } = require('../src/services/rag/retrievalService');
const { handleIncomingMessage } = require('../src/services/channels/messageHandler');
const { parseYesNo, isSkip, isGreetingOnly } = require('../src/services/chat/flowMessages');
const app = require('../src/app');

const strong = () => [{ score: 0.95, documentId: uuidv4(), chunkId: uuidv4(), title: 't', content: 'KB TEXT' }];

beforeEach(() => {
  mockDb.__reset();
  jest.clearAllMocks();
  openaiClient.detectLanguage.mockResolvedValue('en');
  openaiClient.generateOpenAnswer.mockResolvedValue('Here is what you can do.');
  openaiClient.classifyCase.mockResolvedValue(null);
  retrieveRelevantChunks.mockResolvedValue(strong());
});

const wa = (externalId = '94771234567') => (text) => handleIncomingMessage({ channel: 'whatsapp', externalId, text });
const msgr = (externalId = 'psid-1') => (text) => handleIncomingMessage({ channel: 'messenger', externalId, text });
const convo = async () => (await mockDb.query('SELECT * FROM conversations ORDER BY created_at DESC LIMIT 1')).rows[0];
const handoffs = async () => (await mockDb.query('SELECT * FROM human_handoffs')).rows;
const client = async () => (await mockDb.query('SELECT * FROM clients ORDER BY created_at DESC LIMIT 1')).rows[0];

/** Drives a conversation to the "speak with a representative?" question. */
async function reachHandoffQuestion(send) {
  await send('hi');
  openaiClient.generateOpenAnswer.mockResolvedValueOnce('Take photos of your injuries and see a doctor.\n[[WRAP_UP]]');
  return send('The police beat me during my arrest');
}

describe('recognising yes / no / skip / greeting', () => {
  it('understands English, Sinhala and Tamil', () => {
    for (const y of ['yes', 'Yes please', 'ok', 'ඔව්', 'ஆம்', 'sure!']) expect(parseYesNo(y)).toBe('yes');
    for (const n of ['no', 'No thanks', 'not now', 'නැහැ', 'එපා', 'இல்லை', 'வேண்டாம்']) expect(parseYesNo(n)).toBe('no');
    expect(parseYesNo('what about my bail application then')).toBeNull();
    expect(parseYesNo('')).toBeNull();
  });
  it('skip words and greetings', () => {
    expect(isSkip('skip')).toBe(true);
    expect(isSkip('Kandy')).toBe(false);
    for (const g of ['hi', 'Hello!', 'ආයුබෝවන්', 'வணக்கம்', 'good morning']) expect(isGreetingOnly(g)).toBe(true);
    expect(isGreetingOnly('hi my landlord threw me out')).toBe(false);
  });
});

describe('no menus', () => {
  it('a first "hi" gets a trilingual greeting, no language or category buttons', async () => {
    const r = await msgr()('hi');
    expect(r.reply).toMatch(/R2L/);
    expect(r.reply).toMatch(/ආයුබෝවන්/);
    expect(r.reply).toMatch(/வணக்கம்/);
    expect(r.options).toBeUndefined();
    expect(r.stage).toBe('in_chat');
    expect(openaiClient.generateOpenAnswer).not.toHaveBeenCalled();
  });

  it('a first message that describes a problem is answered straight away', async () => {
    const r = await wa()('My landlord is trying to throw me out');
    expect(r.reply).toBe('Here is what you can do.');
    expect(r.options).toBeUndefined();
    expect((await convo()).stage).toBe('in_chat');
  });

  it('works out the case from the conversation', async () => {
    openaiClient.classifyCase.mockResolvedValue({ scenario: 'cyber-ncii-sextortion', confidence: 0.9 });
    await msgr()('someone is blackmailing me with my photos');
    expect(await convo()).toMatchObject({ category: 'cyber', scenario: 'cyber-ncii-sextortion' });
    openaiClient.classifyCase.mockResolvedValue({ scenario: 'financial-microfinance', confidence: 0.9 });
    await msgr()('also I owe money to a microfinance company');
    expect(await convo()).toMatchObject({ category: 'financial', scenario: 'financial-microfinance' });
  });

  it('follows the language of each message', async () => {
    const send = msgr('psid-lang');
    await send('hello there, I need help');
    expect((await convo()).language).toBe('en');
    await send('මට උදව්වක් ඕනේ');
    expect((await convo()).language).toBe('si');
  });

  it('works on the website endpoint too', async () => {
    const first = await request(app).post('/api/chat').send({ message: 'hi' });
    expect(first.body.options).toBeUndefined();
    expect(first.body.stage).toBe('in_chat');
    const second = await request(app).post('/api/chat').send({ message: 'I was arrested', conversationId: first.body.conversationId });
    expect(second.body.reply).toBe('Here is what you can do.');
  });
});

describe('asking about an R2L representative at the end', () => {
  it('asks once the AI wraps up, with yes/no buttons, and records it as asked', async () => {
    const r = await reachHandoffQuestion(wa());
    expect(r.reply).toMatch(/Take photos/);
    expect(r.reply).toMatch(/speak with an R2L representative\?/);
    expect(r.options.map((o) => o.id)).toEqual(['yes', 'no']);
    expect(r.stage).toBe('awaiting_handoff');
    expect(await convo()).toMatchObject({ handoff_status: 'asked', status: 'open' });
    expect(await handoffs()).toHaveLength(0);
  });

  it('yes -> handoff is created, status shows requested, then consent is asked', async () => {
    const send = wa();
    await reachHandoffQuestion(send);
    const r = await send('yes');
    expect(r.needsHuman).toBe(true);
    expect(r.reply).toMatch(/asked an R2L representative/);
    expect(r.reply).toMatch(/may we share your personal details/);
    expect(r.options.map((o) => o.id)).toEqual(['yes', 'no']);
    expect(await convo()).toMatchObject({ handoff_status: 'requested', status: 'needs_human', consent_status: 'asked', stage: 'awaiting_consent' });
    const h = await handoffs();
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ status: 'pending', priority: 'normal' });
  });

  it('no -> declined, no handoff, no personal details requested', async () => {
    const send = wa();
    await reachHandoffQuestion(send);
    const r = await send('no');
    expect(r.reply).toMatch(/No problem/);
    expect(r.options).toBeUndefined();
    expect(await convo()).toMatchObject({ handoff_status: 'declined', status: 'open', consent_status: 'not_asked', stage: 'in_chat' });
    expect(await handoffs()).toHaveLength(0);
  });

  it('answers in Sinhala when the person writes Sinhala', async () => {
    const send = msgr('psid-si');
    await send('ආයුබෝවන්');
    openaiClient.generateOpenAnswer.mockResolvedValueOnce('ඔබට මෙය කළ හැක.\n[[WRAP_UP]]');
    const r = await send('පොලීසිය මාව අත්අඩංගුවට ගත්තා');
    expect(r.reply).toMatch(/R2L නියෝජිතයෙකු සමඟ කතා කිරීමට/);
    const yes = await send('ඔව්');
    expect(yes.reply).toMatch(/පෞද්ගලික තොරතුරු/);
  });

  it('a question instead of yes/no is treated as a normal message', async () => {
    const send = wa();
    await reachHandoffQuestion(send);
    openaiClient.generateOpenAnswer.mockResolvedValueOnce('Bail depends on the offence.');
    const r = await send('what about getting bail for my brother?');
    expect(r.reply).toBe('Bail depends on the offence.');
    expect((await convo()).handoff_status).toBe('asked'); // not asked again
    expect(await handoffs()).toHaveLength(0);
  });

  it('is never asked twice', async () => {
    const send = wa();
    await reachHandoffQuestion(send);
    await send('no');
    openaiClient.generateOpenAnswer.mockResolvedValueOnce('You are welcome.\n[[WRAP_UP]]');
    const r = await send('thanks');
    expect(r.reply).toBe('You are welcome.');
    expect(r.options).toBeUndefined();
  });

  it('asks after several messages even if the AI never wraps up', async () => {
    const send = msgr('psid-long');
    let r;
    for (let i = 0; i < 6; i += 1) r = await send(`message number ${i} about my case`);
    expect(r.reply).toMatch(/speak with an R2L representative\?/);
  });

  it('does not tack the question onto a reply that is itself a question', async () => {
    const send = msgr('psid-q');
    let r;
    openaiClient.generateOpenAnswer.mockResolvedValue('When did this happen?');
    for (let i = 0; i < 7; i += 1) r = await send(`message ${i} about my case`);
    expect(r.reply).toBe('When did this happen?');
    expect(r.options).toBeUndefined();
  });
});

describe('urgent cases', () => {
  it('[[HANDOFF]] goes straight to a representative and asks for consent', async () => {
    openaiClient.generateOpenAnswer.mockResolvedValueOnce('I will pass this to our team.\n[[HANDOFF]]');
    const r = await wa()('I want to talk to a lawyer please');
    expect(r.needsHuman).toBe(true);
    expect(r.reply).toMatch(/I will pass this to our team/);
    expect(r.reply).toMatch(/may we share your personal details/);
    expect((await handoffs())[0].priority).toBe('normal');
    expect((await convo()).handoff_status).toBe('requested');
  });

  it('[[EMERGENCY]] creates an emergency handoff, marks the case as danger and shows emergency contacts', async () => {
    openaiClient.generateOpenAnswer.mockResolvedValueOnce('Please get to a safe place now.\n[[EMERGENCY]]');
    const r = await msgr()('he is going to kill me, he is outside');
    expect(r.needsHuman).toBe(true);
    expect(r.reply).toMatch(/119/);
    expect(await convo()).toMatchObject({ category: 'danger', status: 'needs_human', handoff_status: 'requested' });
    expect((await handoffs())[0].priority).toBe('emergency');
  });

  it('never creates a second pending handoff', async () => {
    const send = wa();
    openaiClient.generateOpenAnswer.mockResolvedValue('Passing this on.\n[[HANDOFF]]');
    await send('I need a lawyer');
    await send('please hurry');
    expect(await handoffs()).toHaveLength(1);
  });
});

describe('consent and personal details', () => {
  async function toConsent(send) {
    await reachHandoffQuestion(send);
    return send('yes');
  }

  it('collects name, number, age and hometown after consent (Messenger)', async () => {
    const send = msgr('psid-consent');
    await toConsent(send);
    let r = await send('yes');
    expect(r.reply).toMatch(/What is your name\?/);
    expect(await convo()).toMatchObject({ consent_status: 'granted', stage: 'collect_name' });
    r = await send('Nimal Perera');
    expect(r.reply).toMatch(/contact number/);
    r = await send('0771234567');
    expect(r.reply).toMatch(/How old/);
    r = await send('I am 34');
    expect(r.reply).toMatch(/town or area/);
    r = await send('Kandy');
    expect(r.reply).toMatch(/shared with R2L/);
    expect(r.stage).toBe('in_chat');

    const c = await client();
    expect(c).toMatchObject({ name: 'Nimal Perera', contact_phone: '0771234567', age: 34, location: 'Kandy' });
    expect(c.consent_given_at).toBeTruthy();
    expect((await convo()).client_id).toBe(c.id);
  });

  it('WhatsApp already knows the number, so it does not ask for it', async () => {
    const send = wa('94775550000');
    await toConsent(send);
    await send('yes');
    const r = await send('Kamala');
    expect(r.reply).toMatch(/How old/);
    await send('41');
    await send('Galle');
    expect(await client()).toMatchObject({ name: 'Kamala', contact_phone: '94775550000', age: 41, location: 'Galle' });
  });

  it('website visitors get a client record only after consenting', async () => {
    const first = await request(app).post('/api/chat').send({ message: 'hi' });
    const id = first.body.conversationId;
    openaiClient.generateOpenAnswer.mockResolvedValueOnce('See a doctor.\n[[WRAP_UP]]');
    await request(app).post('/api/chat').send({ message: 'I was beaten', conversationId: id });
    expect((await mockDb.query('SELECT * FROM clients')).rows).toHaveLength(0);
    await request(app).post('/api/chat').send({ message: 'yes', conversationId: id });
    expect((await mockDb.query('SELECT * FROM clients')).rows).toHaveLength(0);
    await request(app).post('/api/chat').send({ message: 'yes', conversationId: id });
    expect((await mockDb.query('SELECT * FROM clients')).rows).toHaveLength(1);
  });

  it('declining consent stores nothing and asks for nothing', async () => {
    const send = msgr('psid-nope');
    await toConsent(send);
    const clientsBefore = (await mockDb.query('SELECT * FROM clients')).rows[0];
    const r = await send('no');
    expect(r.reply).toMatch(/will not ask for any personal details/);
    expect(await convo()).toMatchObject({ consent_status: 'declined', stage: 'in_chat', handoff_status: 'requested' });
    const after = (await mockDb.query('SELECT * FROM clients')).rows[0];
    expect(after.name).toBe(clientsBefore.name);
    expect(after.contact_phone).toBeNull();
    expect(after.consent_given_at).toBeNull();
  });

  it('re-asks an invalid number or age, and any field can be skipped', async () => {
    const send = msgr('psid-valid');
    await toConsent(send);
    await send('yes');
    await send('skip'); // name
    let r = await send('abc');
    expect(r.reply).toMatch(/does not look like a phone number/);
    r = await send('0712345678');
    expect(r.reply).toMatch(/How old/);
    r = await send('hundred and five');
    expect(r.reply).toMatch(/age as a number/);
    r = await send('skip');
    expect(r.reply).toMatch(/town or area/);
    await send('Jaffna');
    const c = await client();
    expect(c.name).toBeNull();
    expect(c).toMatchObject({ contact_phone: '0712345678', location: 'Jaffna' });
    expect(c.age).toBeNull();
  });

  it('after the details are done, normal chat continues and nothing is asked again', async () => {
    const send = wa();
    await toConsent(send);
    for (const t of ['yes', 'Kamala', '41', 'Galle']) await send(t);
    openaiClient.generateOpenAnswer.mockResolvedValueOnce('Glad to help.\n[[WRAP_UP]]');
    const r = await send('thank you');
    expect(r.reply).toBe('Glad to help.');
    expect(r.options).toBeUndefined();
  });
});

describe('what staff see in the dashboard API', () => {
  const jwt = require('jsonwebtoken');
  const { v4 } = require('uuid');
  const env = require('../src/config/env');
  const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: v4(), role: 'admin' }, env.jwt.secret)}` });

  it('lists handoff status and the details a consenting person shared', async () => {
    const send = wa('94779990000');
    await reachHandoffQuestion(send);
    await send('yes');
    for (const t of ['yes', 'Sunil', '29', 'Matara']) await send(t);

    const list = await request(app).get('/api/conversations?handoffStatus=requested').set(auth());
    expect(list.status).toBe(200);
    expect(list.body.conversations).toHaveLength(1);
    expect(list.body.conversations[0]).toMatchObject({ handoff_status: 'requested', consent_status: 'granted', client_name: 'Sunil', client_phone: '94779990000' });

    const none = await request(app).get('/api/conversations?handoffStatus=declined').set(auth());
    expect(none.body.conversations).toHaveLength(0);

    const detail = await request(app).get(`/api/conversations/${list.body.conversations[0].id}`).set(auth());
    expect(detail.body.client).toMatchObject({ name: 'Sunil', age: 29, location: 'Matara', contact_number: '94779990000' });
    expect(detail.body.client.consent_given_at).toBeTruthy();

    const handoffsRes = await request(app).get('/api/handoffs?status=pending').set(auth());
    expect(handoffsRes.body.handoffs[0]).toMatchObject({ client_name: 'Sunil', client_age: 29, client_location: 'Matara', priority: 'normal' });
  });

  it('shows no personal details when consent was declined', async () => {
    const send = msgr('psid-dash');
    await reachHandoffQuestion(send);
    await send('yes');
    await send('no');
    const list = await request(app).get('/api/conversations').set(auth());
    expect(list.body.conversations[0]).toMatchObject({ handoff_status: 'requested', consent_status: 'declined', client_name: null, client_phone: null });
  });
});
