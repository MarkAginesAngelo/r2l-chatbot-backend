/**
 * Splits text into overlapping chunks suitable for embedding.
 * Simple sentence-aware sliding window — good enough for R2L-length policy docs.
 */
function chunkText(text, { maxChars = 1200, overlapChars = 150 } = {}) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const chunks = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);

    // try to end on a sentence boundary
    if (end < clean.length) {
      const lastPeriod = clean.lastIndexOf('. ', end);
      if (lastPeriod > start + maxChars * 0.5) {
        end = lastPeriod + 1;
      }
    }

    chunks.push(clean.slice(start, end).trim());
    start = end - overlapChars;
    if (start < 0) start = 0;
    if (end === clean.length) break;
  }

  return chunks.filter((c) => c.length > 0);
}

module.exports = { chunkText };
