const { Queue } = require('bullmq');
const env = require('./env');

const connection = {
  url: env.redis.url,
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 500, 5000),
  lazyConnect: true, // don't open the socket until the first command
};

let queue = null;

function getQueue() {
  if (!queue) {
    queue = new Queue('document-ingestion', { connection });
  }
  return queue;
}

async function enqueueIngestion(documentId) {
  return getQueue().add(
    'ingest',
    { documentId },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    }
  );
}

module.exports = { getQueue, enqueueIngestion, connection };
