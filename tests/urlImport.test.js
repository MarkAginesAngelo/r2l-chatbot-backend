// Importing knowledge-base content from a link.
const os = require('os');
const path = require('path');
const fs = require('fs');
const request = require('supertest');

jest.mock('../src/config/db', () => require('./helpers/mockDb'));
jest.mock('../src/config/socket', () => ({ initSocket: jest.fn(), getIO: jest.fn(() => null), notifyStaff: jest.fn() }));
jest.mock('../src/config/queue', () => ({ enqueueIngestion: jest.fn().mockResolvedValue({}), getQueue: jest.fn(), connection: {} }));
jest.mock('dns', () => ({ promises: { lookup: jest.fn() } }));

process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'r2l-url-import-test');

const dns = require('dns').promises;
const mockDb = require('./helpers/mockDb');
const jwt = require('jsonwebtoken');
const { enqueueIngestion } = require('../src/config/queue');
const { htmlToText, isPrivateAddress } = require('../src/services/rag/urlImport');
const app = require('../src/app');

const PAGE =
  '<html><head><title>Your rights when arrested &amp; detained</title><style>p{color:red}</style></head><body>' +
  '<nav>Home | About</nav><main><h1>Know your rights</h1><p>You have the right to remain silent.</p>' +
  '<ul><li>Ask for a lawyer</li><li>Ask the reason for arrest</li></ul>' +
  '<p>' + 'Police must produce you before a magistrate. '.repeat(8) + '</p></main><footer>Copyright</footer><script>alert(1)</script></body></html>';

function mockFetch(body, { status = 200, type = 'text/html; charset=utf-8', headers = {} } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  global.fetch = jest.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => ({ 'content-type': type, ...headers })[k.toLowerCase()] ?? null },
    body: (async function* () { yield buf; })(),
  });
}

let cachedToken;
async function adminToken() {
  if (cachedToken) return cachedToken;
  const { rows } = await mockDb.query(`SELECT id FROM roles WHERE name = 'admin'`);
  const id = require('uuid').v4();
  await mockDb.query(`INSERT INTO admin_users (id, name, email, password_hash, role_id) VALUES ($1, 'A', 'a@x.org', 'x', $2)`, [id, rows[0].id]);
  cachedToken = jwt.sign({ id, role: 'admin', email: 'a@x.org', name: 'A' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  return cachedToken;
}

beforeEach(() => {
  mockDb.__reset();
  cachedToken = undefined;
  jest.clearAllMocks();
  dns.lookup.mockResolvedValue([{ address: '93.184.216.34' }]);
});

describe('htmlToText', () => {
  it('keeps the readable article text and drops scripts, navigation and footers', () => {
    const { title, text } = htmlToText(PAGE);
    expect(title).toBe('Your rights when arrested & detained');
    expect(text).toContain('Know your rights');
    expect(text).toContain('• Ask for a lawyer');
    expect(text).not.toMatch(/alert|Copyright|Home \| About|color:red/);
  });
});

describe('address safety', () => {
  it('recognises private and local addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['93.184.216.34', '8.8.8.8']) expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('POST /api/documents/from-url', () => {
  const post = async (body) => request(app).post('/api/documents/from-url').set('Authorization', `Bearer ${await adminToken()}`).send(body);

  it('requires an admin', async () => {
    const res = await request(app).post('/api/documents/from-url').send({ url: 'https://example.org' });
    expect([401, 403]).toContain(res.status);
  });

  it('imports a web page: saves the text, records the link and queues ingestion', async () => {
    mockFetch(PAGE);
    const res = await post({ url: 'https://example.org/rights', language: 'en' });
    expect(res.status).toBe(202);
    expect(res.body.title).toBe('Your rights when arrested & detained');
    expect(res.body.characters).toBeGreaterThan(200);
    const { rows } = await mockDb.query('SELECT * FROM documents');
    expect(rows[0]).toMatchObject({ file_type: 'txt', language: 'en', status: 'pending', source_url: 'https://example.org/rights' });
    expect(fs.readFileSync(rows[0].file_path, 'utf8')).toContain('right to remain silent');
    expect(enqueueIngestion).toHaveBeenCalledWith(rows[0].id);
  });

  it('uses a title typed by the admin when one is given', async () => {
    mockFetch(PAGE);
    const res = await post({ url: 'https://example.org/rights', title: 'Arrest rights (web)', language: 'si' });
    expect(res.body.title).toBe('Arrest rights (web)');
    expect((await mockDb.query('SELECT language FROM documents')).rows[0].language).toBe('si');
  });

  it('imports a PDF link as a pdf document', async () => {
    mockFetch(Buffer.from('%PDF-1.4 fake'), { type: 'application/pdf' });
    const res = await post({ url: 'https://example.org/guide.pdf' });
    expect(res.status).toBe(202);
    expect((await mockDb.query('SELECT file_type FROM documents')).rows[0].file_type).toBe('pdf');
  });

  it('refuses private / internal addresses', async () => {
    dns.lookup.mockResolvedValue([{ address: '10.0.0.5' }]);
    mockFetch(PAGE);
    const res = await post({ url: 'http://intranet.local/secret' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a public website/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses non-web links and bad input', async () => {
    expect((await post({ url: 'file:///etc/passwd' })).status).toBe(400);
    expect((await post({ url: 'not a url' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ url: 'https://example.org', language: 'fr' })).status).toBe(400);
  });

  it('explains when a page has almost no readable text', async () => {
    mockFetch('<html><body><div id="root"></div><script src="app.js"></script></body></html>');
    const res = await post({ url: 'https://example.org/spa' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Very little readable text/);
    expect((await mockDb.query('SELECT * FROM documents')).rows).toHaveLength(0);
  });

  it('refuses unsupported file types and error responses', async () => {
    mockFetch(Buffer.from([1, 2, 3]), { type: 'image/png' });
    expect((await post({ url: 'https://example.org/a.png' })).status).toBe(400);
    mockFetch('nope', { status: 404 });
    expect((await post({ url: 'https://example.org/missing' })).status).toBe(502);
  });
});
