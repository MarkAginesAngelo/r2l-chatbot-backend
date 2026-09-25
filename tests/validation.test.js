const request = require('supertest');
const app = require('../src/app');

describe('input validation', () => {
  it('rejects login with missing password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@r2l.org' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.password).toBeDefined();
  });

  it('rejects login with an invalid email format', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects chat with an empty message', async () => {
    const res = await request(app).post('/api/chat').send({ message: '' });
    expect(res.status).toBe(400);
  });

  it('rejects chat with a message over the length limit', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'a'.repeat(5000) });
    expect(res.status).toBe(400);
  });
});
