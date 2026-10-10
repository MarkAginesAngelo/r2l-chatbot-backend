jest.mock('../src/config/db', () => require('./helpers/mockDb'));
jest.mock('../src/config/socket', () => ({ initSocket: jest.fn(), getIO: jest.fn(() => null), notifyStaff: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const ExcelJS = require('exceljs');
const mockDb = require('./helpers/mockDb');
const env = require('../src/config/env');
const app = require('../src/app');

const token = (role = 'admin') => `Bearer ${jwt.sign({ id: uuid(), role }, env.jwt.secret)}`;
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

async function addConvo({ channel, language, category = null, scenario = null, status = 'open', created = daysAgo(0), handoff = false, name }) {
  const id = uuid();
  let clientId = null;
  if (name) {
    clientId = uuid();
    await mockDb.query(`INSERT INTO clients (id, name, phone) VALUES ($1, $2, $3)`, [clientId, name, `p-${clientId.slice(0, 8)}`]);
  }
  await mockDb.query(
    `INSERT INTO conversations (id, client_id, channel, language, status, stage, category, scenario, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'in_chat',$6,$7,$8,$8)`,
    [id, clientId, channel, language, status, category, scenario, created]
  );
  if (handoff) await mockDb.query(`INSERT INTO human_handoffs (id, conversation_id, status) VALUES ($1, $2, 'pending')`, [uuid(), id]);
  return id;
}

beforeEach(async () => {
  mockDb.__reset();
  await addConvo({ channel: 'whatsapp', language: 'si', category: 'police', scenario: 'police-torture', created: daysAgo(1), name: 'A' });
  await addConvo({ channel: 'messenger', language: 'ta', category: 'cyber', status: 'needs_human', created: daysAgo(3) });
  await addConvo({ channel: 'website', language: 'en', category: 'financial', handoff: true, created: daysAgo(10) });
  await addConvo({ channel: 'website', language: 'en', category: 'land', created: daysAgo(40) });
});

const get = (url) => request(app).get(url).set('Authorization', token());

describe('GET /api/analytics/cases', () => {
  it('requires an admin', async () => {
    expect((await request(app).get('/api/analytics/cases')).status).toBe(401);
    expect((await request(app).get('/api/analytics/cases').set('Authorization', token('staff'))).status).toBe(403);
  });

  it('returns totals and breakdowns with no filters', async () => {
    const r = await get('/api/analytics/cases');
    expect(r.status).toBe(200);
    expect(r.body.summary.total).toBe(4);
    expect(r.body.summary.needsHuman).toBe(2); // status needs_human OR a handoff row
    expect(r.body.summary.byChannel.find((x) => x.key === 'website').count).toBe(2);
    expect(r.body.summary.byLanguage.map((x) => x.key)).toEqual(['en', 'si', 'ta']);
    expect(r.body.cases.rows).toHaveLength(4);
    expect(r.body._allRows).toBeUndefined();
  });

  it('filters by time period', async () => {
    expect((await get('/api/analytics/cases?period=7d')).body.summary.total).toBe(2);
    expect((await get('/api/analytics/cases?period=30d')).body.summary.total).toBe(3);
    const from = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    expect((await get(`/api/analytics/cases?from=${from}`)).body.summary.total).toBe(2);
  });

  it('filters by language, channel, category and human-needed, and combines them', async () => {
    expect((await get('/api/analytics/cases?language=si')).body.summary.total).toBe(1);
    expect((await get('/api/analytics/cases?channel=website')).body.summary.total).toBe(2);
    expect((await get('/api/analytics/cases?category=cyber')).body.summary.total).toBe(1);
    expect((await get('/api/analytics/cases?needsHuman=yes')).body.summary.total).toBe(2);
    expect((await get('/api/analytics/cases?needsHuman=no')).body.summary.total).toBe(2);
    const combo = await get('/api/analytics/cases?channel=website&needsHuman=yes&language=en');
    expect(combo.body.summary.total).toBe(1);
    expect(combo.body.cases.rows[0].categoryLabel).toMatch(/Financial/);
    expect((await get('/api/analytics/cases?language=all&channel=all')).body.summary.total).toBe(4);
  });

  it('rejects unknown filter values and paginates', async () => {
    expect((await get('/api/analytics/cases?language=fr')).status).toBe(400);
    expect((await get('/api/analytics/cases?category=nope')).status).toBe(400);
    const p = await get('/api/analytics/cases?pageSize=2&page=2');
    expect(p.body.cases.rows).toHaveLength(2);
    expect(p.body.cases.total).toBe(4);
  });
});

describe('GET /api/analytics/export', () => {
  const binary = (res, cb) => { res.setEncoding('binary'); let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => cb(null, Buffer.from(d, 'binary'))); };

  it('exports the filtered cases as an Excel workbook', async () => {
    const r = await request(app).get('/api/analytics/export?format=xlsx&channel=website').set('Authorization', token()).buffer().parse(binary);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body);
    expect(wb.getWorksheet('Cases').rowCount).toBe(3); // header + 2 website cases
    expect(wb.getWorksheet('Summary')).toBeTruthy();
  });

  it('exports a PDF', async () => {
    const r = await request(app).get('/api/analytics/export?format=pdf&period=30d').set('Authorization', token()).buffer().parse(binary);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.body.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('rejects an unknown format', async () => {
    expect((await get('/api/analytics/export?format=doc')).status).toBe(400);
  });
});

describe('analytics page', () => {
  it('serves the page at /analytics-dashboard', async () => {
    const r = await request(app).get('/analytics-dashboard');
    expect(r.status).toBe(200);
    expect(r.text).toContain('Case analytics');
    expect(r.headers['content-security-policy']).toMatch(/connect-src 'self'/);
  });
});
