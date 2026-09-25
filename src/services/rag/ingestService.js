const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const db = require('../../config/db');
const { chunkText } = require('./chunker');
const { embedBatch } = require('../ai/openaiClient');
const qdrant = require('./qdrantClient');

async function extractText(filePath, fileType) {
  if (fileType === 'pdf') {
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (fileType === 'txt') {
    return fs.readFile(filePath, 'utf-8');
  }
  if (fileType === 'docx') {
    const { value } = await mammoth.extractRawText({ path: filePath });
    return value;
  }
  throw new Error(`Unsupported file type: ${fileType}`);
}

async function ingestDocument(documentId) {
  const { rows } = await db.query('SELECT * FROM documents WHERE id = $1', [documentId]);
  const doc = rows[0];
  if (!doc) throw new Error(`Document ${documentId} not found`);

  await db.query('UPDATE documents SET status = $1 WHERE id = $2', ['processing', documentId]);

  try {
    const rawText = await extractText(doc.file_path, doc.file_type);
    const chunks = chunkText(rawText);

    const embeddings = await embedBatch(chunks);
    await qdrant.ensureCollection(embeddings[0].length);

    const points = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkId = uuidv4();
      const pointId = uuidv4();

      await db.query(
        `INSERT INTO document_chunks (id, document_id, chunk_index, content, qdrant_point_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [chunkId, documentId, i, chunks[i], pointId]
      );

      points.push({
        id: pointId,
        vector: embeddings[i],
        payload: {
          document_id: documentId,
          chunk_id: chunkId,
          title: doc.title,
          language: doc.language,
          content: chunks[i],
        },
      });
    }

    await qdrant.upsertPoints(points);
    await db.query('UPDATE documents SET status = $1 WHERE id = $2', ['processed', documentId]);
    return { chunkCount: chunks.length };
  } catch (err) {
    await db.query('UPDATE documents SET status = $1 WHERE id = $2', ['failed', documentId]);
    throw err;
  }
}

module.exports = { ingestDocument, extractText };
