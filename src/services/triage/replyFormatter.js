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

// The header usually sits in brackets: "(R2L Digital Triage System — Knowledge
// Base Type: Cyber (Doxing))". One nested bracket level is allowed.
const PAREN_HEADER = /\(\s*(?:R2L Digital Triage|R2L ඩිජිටල්)(?:[^()]|\([^()]*\))*\)/gi;
// Lines longer than this are real content that merely contains header words —
// documents stored with the OLD chunker had all whitespace collapsed, so the
// whole answer was ONE line, and deleting "the header line" deleted everything.
const MAX_HEADER_LINE = 200;

function stripBoilerplate(text) {
  const original = String(text || '');
  let out = original.replace(PAREN_HEADER, '');
  out = out
    .split('\n')
    .filter((line) => {
      if (line.length > MAX_HEADER_LINE) return true;
      return !BOILERPLATE_PATTERNS.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(line);
      });
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Never turn a real answer into nothing — an empty reply can't be sent.
  return out || original.trim();
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

/**
 * Lays out an English knowledge-base document written in the R2L template
 *   R2L DIGITAL TRIAGE — CATEGORY: … SCENARIO: … GOLDEN RULE … USER SITUATION …
 *   GUIDANCE … IMMEDIATE ACTION … REFERRAL / CONTACTS - … - …
 * as readable paragraphs. Documents uploaded with the old chunker arrive as
 * ONE line, so the section labels are used to break it up. Text that doesn't
 * use the template is returned unchanged.
 */
const SECTION_LABELS = ['USER SITUATION', 'GUIDANCE', 'IMMEDIATE ACTION', 'REFERRAL / CONTACTS', 'REFERRAL'];
const LABEL_TITLES = {
  GUIDANCE: 'Guidance',
  'IMMEDIATE ACTION': 'What to do now',
  'REFERRAL / CONTACTS': 'Contacts',
  REFERRAL: 'Contacts',
};

function formatKnowledgeDocument(text) {
  const src = String(text || '');
  if (!/\bUSER SITUATION\b|\bIMMEDIATE ACTION\b|\bREFERRAL \/ CONTACTS\b/.test(src)) return src;

  let t = src.replace(/\r\n?/g, '\n').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1'); // [x](url) -> x

  // Drop the staff header and the Golden Rule (already shown when the
  // category was chosen) — everything before the first real section.
  const first = t.search(/\bUSER SITUATION\b/);
  if (first > -1) t = t.slice(first);

  const pattern = new RegExp(`(?:^|\\s)(${SECTION_LABELS.map((l) => l.replace(/[/]/g, '\\/')).join('|')})\\b[:\\s]*`, 'g');
  const parts = [];
  let last = 0;
  let label = null;
  let m;
  while ((m = pattern.exec(t)) !== null) {
    if (label !== null || m.index > last) parts.push({ label, body: t.slice(last, m.index).trim() });
    label = m[1];
    last = pattern.lastIndex;
  }
  parts.push({ label, body: t.slice(last).trim() });

  const out = [];
  for (const { label: l, body } of parts) {
    if (!body) continue;
    if (!l || l === 'USER SITUATION') {
      out.push(body);
    } else if (l === 'REFERRAL / CONTACTS' || l === 'REFERRAL') {
      const items = body.split(/\s+-\s+|\n-\s*/).map((x) => x.replace(/^-\s*/, '').trim()).filter(Boolean);
      out.push(`${LABEL_TITLES[l]}:\n${items.map((i) => `• ${i}`).join('\n')}`);
    } else {
      out.push(`${LABEL_TITLES[l]}: ${body}`);
    }
  }
  return out.join('\n\n');
}

module.exports = { stripBoilerplate, formatKnowledgeDocument, splitIntoParagraphs, buildReplyParts };
