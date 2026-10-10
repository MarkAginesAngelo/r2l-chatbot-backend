const db = require('../../config/db');
const { findDocumentsWithFallback } = require('./documentMatch');

/**
 * Fetches a scenario's document content directly (concatenated chunks, in
 * order) rather than through Qdrant semantic search. Once the user has
 * picked a specific scenario from the menu, we already know exactly which
 * document answers it — running that through embedding search would add
 * latency and a small chance of retrieving the wrong chunk for no benefit.
 *
 * Filters by language, with a fallback to English if no localized version
 * exists yet. Without this, once multiple language versions of the same
 * scenario exist with identical titles, ORDER BY created_at DESC LIMIT 1
 * would just always return whichever was uploaded most recently — e.g. a
 * Sinhala user could silently get English content back purely because that
 * was uploaded last, or vice versa.
 *
 * Returns { found: false } if no matching, processed document exists yet
 * (e.g. a scenario file hasn't been uploaded) so the caller can degrade
 * gracefully instead of erroring.
 */
/** Re-assembles a document from its stored chunks. chunkText() makes
 * consecutive chunks overlap by ~150 characters (useful for search), so a
 * plain join would repeat that text in the middle of the answer — drop the
 * longest suffix of the text so far that the next chunk starts with. */
function joinChunks(chunks) {
  let out = '';
  for (const chunk of chunks) {
    if (!out) {
      out = chunk;
      continue;
    }
    const max = Math.min(out.length, chunk.length, 400);
    let overlap = 0;
    for (let n = max; n >= 20; n--) {
      if (out.endsWith(chunk.slice(0, n))) {
        overlap = n;
        break;
      }
    }
    out += overlap ? chunk.slice(overlap) : `\n\n${chunk}`;
  }
  return out;
}

async function getScenarioDocumentContent(scenario, language = 'en') {
  if (!scenario || !scenario.titleKeywords || scenario.titleKeywords.length === 0) {
    return { found: false };
  }

  const docRows = (await findDocumentsWithFallback(scenario.titleKeywords, language)).slice(0, 1);

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
    documentLanguage: docRows[0].language,
    content: joinChunks(chunkRows.map((r) => r.content)),
  };
}

module.exports = { getScenarioDocumentContent, joinChunks };
