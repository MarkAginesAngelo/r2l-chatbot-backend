const fs = require('fs/promises');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const env = require('../../config/env');

/**
 * Fetches a web page or file from a link so it can be added to the knowledge
 * base. Supported: HTML pages (the readable text is extracted), plain text,
 * PDF and Word (.docx) files. Not supported: pages behind a login, pages that
 * only show their content after JavaScript runs, and other file types.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 3;

class UrlImportError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// --- safety: only public internet addresses ---------------------------------
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb')) return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateAddress(mapped[1]) : false;
}

async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlImportError('That is not a valid web address.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new UrlImportError('Only http:// and https:// links are supported.');
  if (url.username || url.password) throw new UrlImportError('Links containing a username or password are not supported.');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new UrlImportError('Could not find that website. Please check the link.');
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new UrlImportError('That address is not a public website.');
  return url;
}

// --- download ---------------------------------------------------------------
async function download(rawUrl) {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'R2L-Knowledge-Importer/1.0', Accept: 'text/html,application/pdf,text/plain,*/*;q=0.5' },
      });
    } catch (err) {
      clearTimeout(timer);
      throw new UrlImportError(err.name === 'AbortError' ? 'The website took too long to respond.' : 'Could not reach that website.', 502);
    }

    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) {
      clearTimeout(timer);
      current = new URL(res.headers.get('location'), url).toString();
      continue;
    }
    if (!res.ok) {
      clearTimeout(timer);
      throw new UrlImportError(`The website returned an error (${res.status}).`, 502);
    }

    const declared = Number(res.headers.get('content-length')) || 0;
    if (declared > MAX_BYTES) {
      clearTimeout(timer);
      throw new UrlImportError('That file is too large (limit 10 MB).');
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > MAX_BYTES) throw new UrlImportError('That file is too large (limit 10 MB).');
        chunks.push(Buffer.from(chunk));
      }
    } finally {
      clearTimeout(timer);
    }
    return { buffer: Buffer.concat(chunks), contentType: (res.headers.get('content-type') || '').toLowerCase(), finalUrl: url.toString() };
  }
  throw new UrlImportError('Too many redirects.');
}

// --- HTML -> readable text --------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function htmlToText(html) {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim());
  let body = html;
  const main = body.match(/<(main|article)[\s>][\s\S]*?<\/\1>/i);
  if (main) body = main[0];
  body = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|iframe|form|nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|li|tr|h[1-6]|ul|ol|table|blockquote)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

/**
 * Downloads `rawUrl` and saves it in the uploads folder in a form the
 * ingestion worker understands. Returns { filePath, fileType, title, preview, chars }.
 */
async function fetchForKnowledgeBase(rawUrl) {
  const { buffer, contentType, finalUrl } = await download(rawUrl);
  const lowerPath = new URL(finalUrl).pathname.toLowerCase();
  await fs.mkdir(env.uploads.dir, { recursive: true });
  const base = path.join(env.uploads.dir, uuidv4().replace(/-/g, ''));

  if (contentType.includes('application/pdf') || lowerPath.endsWith('.pdf')) {
    await fs.writeFile(base, buffer);
    return { filePath: base, fileType: 'pdf', title: decodeURIComponent(path.basename(lowerPath)) || new URL(finalUrl).hostname, preview: '', chars: null, finalUrl };
  }
  if (contentType.includes('wordprocessingml') || lowerPath.endsWith('.docx')) {
    await fs.writeFile(base, buffer);
    return { filePath: base, fileType: 'docx', title: decodeURIComponent(path.basename(lowerPath)) || new URL(finalUrl).hostname, preview: '', chars: null, finalUrl };
  }

  const isHtml = contentType.includes('html') || (!contentType && /<html|<body/i.test(buffer.toString('utf8', 0, 2000)));
  const isText = isHtml || contentType.startsWith('text/');
  if (!isText) throw new UrlImportError('That link is not a web page, PDF, Word or text file, so it cannot be imported.');

  const raw = buffer.toString('utf8');
  const { title, text } = isHtml ? htmlToText(raw) : { title: '', text: raw.trim() };
  if (text.length < 200) {
    throw new UrlImportError(
      'Very little readable text was found at that link. The page may need a login or may only show its content with JavaScript, so it cannot be imported.'
    );
  }
  await fs.writeFile(base, text, 'utf8');
  return { filePath: base, fileType: 'txt', title: title || new URL(finalUrl).hostname, preview: text.slice(0, 300), chars: text.length, finalUrl };
}

module.exports = { fetchForKnowledgeBase, htmlToText, isPrivateAddress, assertPublicUrl, UrlImportError };
