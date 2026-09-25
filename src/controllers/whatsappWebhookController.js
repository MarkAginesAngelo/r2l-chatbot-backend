const env = require('../config/env');
const { handleIncomingMessage } = require('../services/channels/messageHandler');
const { sendWhatsAppMessage, sendWhatsAppButtons, sendWhatsAppList } = require('../services/whatsapp/whatsappClient');
const logger = require('../config/logger');

function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.whatsapp.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
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
 * are attached — buttons for 3-or-fewer options (language menu, Police's
 * quick actions), a list for more (category menu, scenario sub-menu), plain
 * text otherwise. Sends each option's bare identifier (language code,
 * category/scenario/quick-action key) with no prefix — every resolver in
 * categories.js/scenarios.js/quickActions.js already accepts the bare form
 * as a valid token, so a single consistent format avoids the class of bug
 * where a prefix matches one option type's tokens but not another's. */
async function sendStageAwareReply(to, { reply, options }) {
  if (options?.length) {
    const items = options.map((o) => ({ id: o.code || o.key || o.id, label: o.shortLabel || o.label }));
    if (options.length <= 3) {
      return sendWhatsAppButtons(to, reply, items);
    }
    return sendWhatsAppList(to, reply, 'Select an option', items);
  }
  return sendWhatsAppMessage(to, reply);
}

async function receiveWebhook(req, res) {
  res.sendStatus(200); // ack immediately — Meta retries aggressively on slow/non-200 responses

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    if (!message) return;

    const text = extractIncomingText(message);
    if (!text) return; // ignore statuses, media, unsupported message types for now

    const from = message.from;
    const displayName = change?.contacts?.[0]?.profile?.name;

    const result = await handleIncomingMessage({ channel: 'whatsapp', externalId: from, displayName, text });
    await sendStageAwareReply(from, result);
  } catch (err) {
    logger.error(`[whatsapp webhook] error handling message: ${err.message}`, { stack: err.stack });
  }
}

module.exports = { verifyWebhook, receiveWebhook };
