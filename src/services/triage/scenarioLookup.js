const db = require('../../config/db');

/**
 * Fetches a scenario's document content directly (concatenated chunks, in
 * order) rather than through Qdrant semantic search. Once the user has
 * picked a specific scenario from the menu, we already know exactly which
 * document answers it — running that through embedding search would add
 * latency and a small chance of retrieving the wrong chunk for no benefit.
 *
 * Returns { found: false } if no matching, processed document exists yet
 * (e.g. a scenario file hasn't been uploaded) so the caller can degrade
 * gracefully instead of erroring.
 */
async function getScenarioDocumentContent(scenario) {
  if (!scenario || !scenario.titleKeywords || scenario.titleKeywords.length === 0) {
    return { found: false };
  }

  const conditions = scenario.titleKeywords.map((_, i) => `title ILIKE $${i + 1}`).join(' OR ');
  const params = scenario.titleKeywords.map((kw) => `%${kw}%`);

  const { rows: docRows } = await db.query(
    `SELECT id, title FROM documents WHERE (${conditions}) AND status = 'processed' ORDER BY created_at DESC LIMIT 1`,
    params
  );

  if (docRows.length === 0) return { found: false };

  const { rows: chunkRows } = await db.query(
    `SELECT content FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index ASC`,
    [docRows[0].id]
  );

  if (chunkRows.length === 0) return { found: false };

  return {
    found: true,
    documentId: docRows[0].id,
    title: docRows[0].title,
    content: chunkRows.map((r) => r.content).join(' '),
  };
}

module.exports = { getScenarioDocumentContent };
