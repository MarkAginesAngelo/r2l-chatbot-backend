const { chunkText } = require('../src/services/rag/chunker');

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    const chunks = chunkText('This is a short sentence.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('This is a short sentence.');
  });

  it('splits long text into multiple overlapping chunks', () => {
    const longText = 'This is a sentence. '.repeat(200);
    const chunks = chunkText(longText, { maxChars: 1200, overlapChars: 150 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(1200 + 50));
  });

  it('never returns empty chunks', () => {
    const chunks = chunkText('   ');
    expect(chunks.every((c) => c.length > 0)).toBe(true);
  });

  it('collapses excess whitespace', () => {
    const chunks = chunkText('Hello   \n\n  world');
    expect(chunks[0]).toBe('Hello world');
  });
});
