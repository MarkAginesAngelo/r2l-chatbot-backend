const crypto = require('crypto');
const env = require('../config/env');
const { handleIncomingMessage } = require('../services/channels/messageHandler');
const { sendWhatsAppMessage, sendWhatsAppButtons, sendWhatsAppList } = require('../services/whatsapp/whatsappClient');
const logger = require('../config/logger');

const BODY_LIMIT = 1024; // WhatsApp interactive message body cap
const LIST_BUTTON = { en: 'Select an option', si: 'විකල්පයක් තෝරන්න', ta: 'தேர்வு செய்க' };
const PICK_PROMPT = { en: 'Please choose an option 👇', si: 'කරුණාකර විකල්පයක් තෝරන්න 👇', ta: 'ஒரு தேர்வைத் தேர்ந்தெடுக்கவும் 👇' };

function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.whatsapp.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

/** Checks Meta's X-Hub-Signature-256 header (HMAC of the raw body with the app
 * secret). If WHATSAPP_APP_SECRET isn't configured the check is skipped with a
 * warning so existing setups keep working — set it before going live. */
let warnedNoSecret = false;
function isValidSignature(req) {
  if (!env.whatsapp.appSecret) {
    if (!warnedNoSecret) {
      logger.warn('[whatsapp webhook] WHATSAPP_APP_SECRET not set — request signatures are NOT being verified');
      warnedNoSecret = true;
    }
    return true;
  }
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;
  const expected = `sha256=${crypto.createHmac('sha256', env.whatsapp.appSecret).update(req.rawBody || '').digest('hex')}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Extracts plain text from either a text message or an interactive reply
 * (button_reply.id or list_reply.id) — the triage engine's token matching
 * handles both id-style tokens (e.g. "cat_police") and plain numbers/words. */
function extractIncomingText(message) {
  if (message.type === 'text') return message.text?.body;
  if (message.type === 'interactive') {
    const interactive = message.interactive;
    if (interactive?.type === 'button_reply') return interactive.button_reply.id;
    if (interactive?.type === 'list_reply') return interactive.list_reply.id;
  }
  return null;
}

/** Sends the reply as the right WhatsApp message type based on what options
 * are attached — buttons for 3-or-fewer options, a list for more, plain text
 * otherwise. Multi-paragraph answers go out as separate messages; only the
 * last one carries the buttons/list. A body longer than WhatsApp's 1024-char
 * interactive limit is sent as plain text first, with a short prompt on the
 * buttons/list so nothing is cut off. */
async function sendStageAwareReply(to, { reply, replyParts, options, language }) {
  if (replyParts?.length > 1) {
    for (const part of replyParts.slice(0, -1)) {
      await sendWhatsAppMessage(to, part);
    }
    return sendStageAwareReply(to, { reply: replyParts[replyParts.length - 1], options, language });
  }

  if (!options?.length) return sendWhatsAppMessage(to, reply);

  const lang = LIST_BUTTON[language] ? language : 'en';
  let body = reply;
  if (String(reply).length > BODY_LIMIT) {
    await sendWhatsAppMessage(to, reply);
    body = PICK_PROMPT[lang];
  }

  const items = options.map((o) => ({
    id: o.code || o.key || o.id,
    number: o.number,
    label: o.shortLabel || o.label,
  }));
  if (options.length <= 3) return sendWhatsAppButtons(to, body, items);
  return sendWhatsAppList(to, body, LIST_BUTTON[lang], items);
}

// Meta retries deliveries it thinks failed; remember recent message ids so a
// retry never produces a duplicate reply.
const seen = new Map();
function alreadyHandled(id) {
  if (!id) return false;
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 10 * 60 * 1000) seen.delete(k);
  if (seen.has(id)) return true;
  seen.set(id, now);
  return false;
}

async function processMessage(message, change) {
  const text = extractIncomingText(message);
  if (!text) return; // statuses, media, reactions etc. are ignored for now
  if (alreadyHandled(message.id)) return;

  const from = message.from;
  const displayName = change?.contacts?.find((c) => c.wa_id === from)?.profile?.name || change?.contacts?.[0]?.profile?.name;

  const result = await handleIncomingMessage({ channel: 'whatsapp', externalId: from, displayName, text });
  await sendStageAwareReply(from, result);
}

async function receiveWebhook(req, res) {
  if (!isValidSignature(req)) return res.sendStatus(403);
  res.sendStatus(200); // ack immediately — Meta retries aggressively on slow/non-200 responses

  try {
    for (const entry of req.body?.entry || []) {
      for (const changeItem of entry.changes || []) {
        const change = changeItem.value;
        for (const message of change?.messages || []) {
          try {
            await processMessage(message, change);
          } catch (err) {
            logger.error(`[whatsapp webhook] error handling message: ${err.message}`, { stack: err.stack });
          }
        }
      }
    }
  } catch (err) {
    logger.error(`[whatsapp webhook] error: ${err.message}`, { stack: err.stack });
  }
}

module.exports = { verifyWebhook, receiveWebhook, sendStageAwareReply };
