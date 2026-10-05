function chunkText(text, { maxChars = 1200, overlapChars = 150 } = {}) {
  // Collapse runs of spaces/tabs but KEEP line breaks (single newline stays,
  // 2+ become one blank line) — paragraph structure is what lets an answer be
  // sent paragraph by paragraph instead of as one wall of text.
  const clean = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const chunks = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);

    if (end < clean.length) {
      const lastPeriod = Math.max(clean.lastIndexOf('. ', end), clean.lastIndexOf('.\n', end));
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
