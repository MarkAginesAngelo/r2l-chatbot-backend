const { embedText } = require('../ai/openaiClient');
const qdrant = require('./qdrantClient');

async function retrieveRelevantChunks(query, { limit = 5 } = {}) {
  const vector = await embedText(query);

  const results = await qdrant.search(vector, { limit });

  return results.map((r) => ({
    score: r.score,
    documentId: r.payload.document_id,
    chunkId: r.payload.chunk_id,
    title: r.payload.title,
    content: r.payload.content,
  }));
}

module.exports = { retrieveRelevantChunks };