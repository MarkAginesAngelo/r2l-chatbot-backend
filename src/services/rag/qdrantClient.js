const env = require('../../config/env');

const BASE_URL = env.qdrant.url;
const COLLECTION = env.qdrant.collection;

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (env.qdrant.apiKey) h['api-key'] = env.qdrant.apiKey;
  return h;
}

async function ensureCollection(vectorSize = 1536) {
  const res = await fetch(`${BASE_URL}/collections/${COLLECTION}`, { headers: headers() });
  if (res.status === 200) return;

  await fetch(`${BASE_URL}/collections/${COLLECTION}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({
      vectors: { size: vectorSize, distance: 'Cosine' },
    }),
  });
}

async function upsertPoints(points) {
  // points: [{ id, vector, payload }]
  const res = await fetch(`${BASE_URL}/collections/${COLLECTION}/points?wait=true`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({ points }),
  });
  if (!res.ok) throw new Error(`Qdrant upsert failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function search(vector, { limit = 5, filter = undefined } = {}) {
  const res = await fetch(`${BASE_URL}/collections/${COLLECTION}/points/search`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      vector,
      limit,
      with_payload: true,
      ...(filter ? { filter } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Qdrant search failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.result; // [{ id, score, payload }]
}

module.exports = { ensureCollection, upsertPoints, search };
