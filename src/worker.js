const { Worker } = require('bullmq');
const { connection } = require('./config/queue');
const { ingestDocument } = require('./services/rag/ingestService');
const logger = require('./config/logger');

const worker = new Worker(
  'document-ingestion',
  async (job) => {
    const { documentId } = job.data;
    logger.info(`[worker] Ingesting document ${documentId} (attempt ${job.attemptsMade + 1})`);
    const result = await ingestDocument(documentId);
    logger.info(`[worker] Document ${documentId} ingested: ${result.chunkCount} chunks`);
    return result;
  },
  { connection, concurrency: 2 }
);

worker.on('failed', (job, err) => {
  logger.error(`[worker] Job ${job.id} (document ${job.data.documentId}) failed: ${err.message}`, {
    stack: err.stack,
  });
});

worker.on('completed', (job) => {
  logger.info(`[worker] Job ${job.id} completed`);
});

logger.info('[worker] Document ingestion worker started, waiting for jobs...');

process.on('SIGTERM', async () => {
  await worker.close();
  process.exit(0);
});
