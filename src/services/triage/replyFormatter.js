// Turns a knowledge-base answer into short, readable paragraphs.
//
// Two problems this solves:
//  1. Documents were stored with all whitespace collapsed (see chunker.js), so
//     an answer arrived as one wall of text.
//  2. The source documents begin with an internal header line (e.g. "R2L
//     Digital Triage System — Knowledge Base Type: ...") that users should
//     never see.

// Header / scaffolding lines that are for R2L staff, not for the person
// chatting. Matched in English and Sinhala (the Sinhala form is what the
// machine translation of the English header produced).
const BOILERPLATE_PATTERNS = [
  // "(R2L Digital Triage System — Knowledge Base Type: Police ...)" with or
  // without the surrounding brackets, up to the end of that line.
  /^[^\n]*Knowledge Base Type[^\n]*$/gim,
  /^[^\n]*R2L Digital Triage[^\n]*$/gim,
  /^[^\n]*දැනුම් මධ්‍යස්ථානය වර්ගය[^\n]*$/gm,
  /^[^\n]*ඩිජිටල් ප්‍රමුඛතා ඇගයීමේ පද්ධතිය[^\n]*$/gm,
];

function stripBoilerplate(text) {
  let out = String(text || '');
  for (const pattern of BOILERPLATE_PATTERNS) out = out.replace(pattern, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

// Sentence enders for English, Sinhala/Tamil (full stop) and the Devanagari
// danda some Sinhala text uses.
const SENTENCE_END = /(?<=[.!?।])\s+/;

/** Splits an over-long paragraph at sentence boundaries into pieces of at most
 * `maxLen` characters. A single sentence longer than `maxLen` is kept whole. */
function splitLongParagraph(paragraph, maxLen) {
  if (paragraph.length <= maxLen) return [paragraph];
  const sentences = paragraph.split(SENTENCE_END);
  const pieces = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + 1 + sentence.length > maxLen) {
      pieces.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Splits `text` into paragraphs (blank-line separated) so each can be sent as
 * its own chat bubble. Falls back to sentence-boundary splitting for a
 * paragraph longer than `maxLen`, which also keeps every piece well under
 * Messenger's 2000-character message cap.
 */
function splitIntoParagraphs(text, { maxLen = 1200 } = {}) {
  const cleaned = stripBoilerplate(text);
  if (!cleaned) return [];
  return cleaned
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => splitLongParagraph(p, maxLen));
}

/** `replyParts` for an API/channel response. Only answers (stage 'in_chat')
 * are split — menus keep their numbered list in a single message so the
 * buttons underneath still line up with it. */
function buildReplyParts(reply, stage) {
  if (stage !== 'in_chat') return [reply];
  const parts = splitIntoParagraphs(reply);
  return parts.length ? parts : [reply];
}

module.exports = { stripBoilerplate, splitIntoParagraphs, buildReplyParts };
