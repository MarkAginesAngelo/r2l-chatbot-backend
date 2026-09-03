const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');
const { ingestDocument } = require('../services/rag/ingestService');

async function uploadDocument(req, res) {
  if (!req.file) throw new AppError('No file uploaded', 400);

  const { title, language = 'en' } = req.body;
  const ext = path.extname(req.file.originalname).replace('.', '').toLowerCase();
  const id = uuidv4();

  await db.query(
    `INSERT INTO documents (id, title, file_path, file_type, language, status, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
    [id, title || req.file.originalname, req.file.path, ext, language, req.user?.id || null]
  );

  // Fire-and-forget ingestion; in production move this to a queue (e.g. BullMQ).
  ingestDocument(id).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[ingest] Failed for document ${id}:`, err);
  });

  res.status(202).json({ id, status: 'processing' });
}

async function listDocuments(req, res) {
  const { rows } = await db.query(
    `SELECT id, title, file_type, language, status, created_at FROM documents ORDER BY created_at DESC`
  );
  res.json({ documents: rows });
}

async function deleteDocument(req, res) {
  const { id } = req.params;
  await db.query('DELETE FROM documents WHERE id = $1', [id]);
  // NOTE: also delete the matching points from Qdrant in production (filter by document_id payload).
  res.status(204).send();
}

module.exports = { uploadDocument, listDocuments, deleteDocument };
