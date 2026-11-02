const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');
const { enqueueIngestion } = require('../config/queue');
const { deletePointsByDocumentId } = require('../services/rag/qdrantClient');
const logger = require('../config/logger');
const { fetchForKnowledgeBase, UrlImportError } = require('../services/rag/urlImport');

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

  await enqueueIngestion(id).catch((err) => {
    logger.error(`[documents] Failed to enqueue ingestion for ${id}: ${err.message}`, { stack: err.stack });
  });

  res.status(202).json({ id, status: 'processing' });
}

/** Adds a web page / PDF / Word file to the knowledge base from a link. */
async function importFromUrl(req, res) {
  const { url, title, language = 'en' } = req.body || {};
  if (!url || typeof url !== 'string') throw new AppError('url is required', 400);
  if (!['en', 'si', 'ta'].includes(language)) throw new AppError('language must be en, si or ta', 400);

  let fetched;
  try {
    fetched = await fetchForKnowledgeBase(url.trim());
  } catch (err) {
    if (err instanceof UrlImportError) throw new AppError(err.message, err.status);
    throw err;
  }

  const id = uuidv4();
  const docTitle = String(title || fetched.title).trim().slice(0, 250);
  await db.query(
    `INSERT INTO documents (id, title, file_path, file_type, language, status, uploaded_by, source_url)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)`,
    [id, docTitle, fetched.filePath, fetched.fileType, language, req.user?.id || null, fetched.finalUrl]
  );

  await enqueueIngestion(id).catch((err) => {
    logger.error(`[documents] Failed to enqueue ingestion for ${id}: ${err.message}`, { stack: err.stack });
  });

  res.status(202).json({ id, status: 'processing', title: docTitle, fileType: fetched.fileType, characters: fetched.chars, preview: fetched.preview });
}

async function listDocuments(req, res) {
  const { rows } = await db.query(
    `SELECT id, title, file_type, language, status, source_url, created_at FROM documents ORDER BY created_at DESC`
  );
  res.json({ documents: rows });
}

async function deleteDocument(req, res) {
  const { id } = req.params;

  // Clear the vectors from Qdrant first — if this fails, the document row
  // stays (caught below) so the delete can be retried rather than leaving
  // orphaned vectors with no corresponding document.
  try {
    await deletePointsByDocumentId(id);
  } catch (err) {
    logger.error(`[documents] Failed to delete Qdrant points for ${id}: ${err.message}`, { stack: err.stack });
    throw new AppError('Failed to remove document vectors from the search index; document was not deleted', 502);
  }

  await db.query('DELETE FROM documents WHERE id = $1', [id]);
  res.status(204).send();
}

module.exports = { uploadDocument, importFromUrl, listDocuments, deleteDocument };
