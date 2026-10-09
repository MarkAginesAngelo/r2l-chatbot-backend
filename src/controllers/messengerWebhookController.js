const crypto = require('crypto');
const env = require('../config/env');
const { handleIncomingMessage } = require('../services/channels/messageHandler');
const {
  sendMessengerMessage,
  sendMessengerQuickReplies,
  sendMessengerButtonTemplate,
} = require('../services/messenger/messengerClient');
const logger = require('../config/logger');

function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.messenger.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

function verifySignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !env.messenger.appSecret) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', env.messenger.appSecret).update(req.rawBody || '').digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/** Extracts text from a typed message, a quick-reply tap, or a button-
 * template tap (whose payload carries the same id tokens the triage engine
 * matches on either way — see sendStageAwareReply). Button-template taps
 * arrive as a `postback` event, not a `message`, so this must check both;
 * missing the postback case would mean the vertical language buttons look
 * tappable but silently do nothing. */
function extractIncomingText(event) {
  if (event.message?.quick_reply?.payload) return event.message.quick_reply.payload;
  if (event.postback?.payload) return event.postback.payload;
  if (event.message?.text) return event.message.text;
  return null;
}

const LIST_PAGE_REQUEST = /^list_page_(\d+)$/;

/**
 * Meta's Button Template — the ONLY vertical-buttons mechanism that's
 * actually working live (a "List Template" was tried and abandoned; see
 * messengerClient.js) — hard-caps at exactly 3 buttons per message. To page
 * through more than 3 options while reserving one button slot for
 * "More options", each page (other than the last) can only show 2 REAL
 * options: [opt, opt, More] — never [opt, opt, opt, More], which would be
 * 4 buttons and get rejected by Meta the same way the List Template was.
 * The last page has no "More" button, so it can show up to 3.
 */
function paginateForButtonTemplate(items) {
  const pages = [];
  let remaining = items;
  while (remaining.length > 3) {
    pages.push({ items: remaining.slice(0, 2), hasMore: true });
    remaining = remaining.slice(2);
  }
  pages.push({ items: remaining, hasMore: false });
  return pages;
}

/**
 * Every menu — language, quick-actions, categories, scenarios — renders as
 * a vertical stack of full-width buttons (Messenger's Button Template),
 * per R2L's request for buttons that don't scroll sideways. `menuStyle:
 * 'list'` (set by triageEngine.js for categories/scenarios) marks a menu
 * whose full sentences are in the message TEXT (see messages.js), not on
 * the buttons — Meta's 20-character button-text cap rules that out — so
 * these buttons are just the option's `number` ("1", "2", "3"...), lining
 * up with the numbered list in the text above them. It may also have MORE
 * than 3 options and so needs paginating — see paginateForButtonTemplate()
 * above. The page shown is picked from `requestedText`: a `list_page_<N>`
 * tap from the previous page's "More options" button (isListPageToken()
 * in triageEngine.js recognizes that same token and re-sends this same
 * menu rather than treating it as a real answer). Everything else
 * (language, quick-actions) is always 3 options or fewer and shows its
 * real (short) label on the button, since there's no separate numbered
 * text list for those to line up with.
 */
const PICK_PROMPT = {
  en: 'Please tap a number below 👇',
  si: 'කරුණාකර පහත අංකයක් තෝරන්න 👇',
  ta: 'கீழே ஒரு எண்ணைத் தேர்ந்தெடுக்கவும் 👇',
};
const BUTTON_TEXT_LIMIT = 640; // Button Template text cap
const MESSAGE_LIMIT = 1900; // plain message cap is 2000

/** Splits long text at line/paragraph boundaries into pieces <= max chars. */
function splitForMessenger(text, max = MESSAGE_LIMIT) {
  const out = [];
  let current = '';
  for (const line of String(text).split('\n')) {
    if (line.length > max) {
      if (current) out.push(current);
      current = '';
      for (let i = 0; i < line.length; i += max) out.push(line.slice(i, i + max));
      continue;
    }
    if (current && current.length + 1 + line.length > max) {
      out.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) out.push(current);
  return out;
}

async function sendStageAwareReply(psid, requestedText, { reply, replyParts, options, menuStyle, language }) {
  // An answer made of several paragraphs goes out as several messages, in
  // order; only the LAST one carries the buttons (if any), so the buttons
  // sit at the bottom of the conversation.
  if (replyParts?.length > 1) {
    for (const part of replyParts.slice(0, -1)) {
      await sendMessengerMessage(psid, part);
    }
    return sendStageAwareReply(psid, requestedText, {
      reply: replyParts[replyParts.length - 1],
      options,
      menuStyle,
      language,
    });
  }

  if (menuStyle === 'list' && options?.length) {
    // Category / scenario menus: ALL options are shown at once (like the
    // website widget) as quick-reply chips — Messenger allows up to 13 and
    // a Button Template only 3. The full sentences are in the numbered text
    // above; each chip is just the option's number, so it lines up with it.
    const mapped = options.slice(0, 13).map((o) => ({
      id: o.key || o.id,
      label: String(o.number || o.shortLabel || o.label),
    }));
    const chunks = splitForMessenger(reply);
    for (const chunk of chunks.slice(0, -1)) await sendMessengerMessage(psid, chunk);
    return sendMessengerQuickReplies(psid, chunks[chunks.length - 1], mapped);
  }

  if (options?.length) {
    const mapped = options.map((o) => ({
      id: o.code ? `lang_${o.code}` : o.key || o.id,
      label: o.shortLabel || o.label,
    }));
    // A Button Template's text is capped at 640 characters; a longer last
    // paragraph (common in a full answer) goes with quick replies instead,
    // which allow 2000.
    if (mapped.length <= 3 && String(reply).length <= BUTTON_TEXT_LIMIT) {
      return sendMessengerButtonTemplate(psid, reply, mapped);
    }
    if (String(reply).length > MESSAGE_LIMIT) {
      const chunks = splitForMessenger(reply);
      for (const chunk of chunks.slice(0, -1)) await sendMessengerMessage(psid, chunk);
      return sendMessengerQuickReplies(psid, chunks[chunks.length - 1], mapped);
    }
    return sendMessengerQuickReplies(psid, reply, mapped);
  }
  // No options: still honour Messenger's 2000-char message cap.
  let last;
  for (const chunk of splitForMessenger(reply)) last = await sendMessengerMessage(psid, chunk);
  return last;
}

async function receiveWebhook(req, res) {
  res.sendStatus(200);

  if (env.nodeEnv === 'production' && !verifySignature(req)) {
    logger.warn('[messenger webhook] rejected: invalid signature');
    return;
  }

  try {
    for (const entry of req.body?.entry || []) {
      const event = entry.messaging?.[0];
      const psid = event?.sender?.id;
      const text = event ? extractIncomingText(event) : null;

      // Temporary diagnostic log — remove once quick-reply buttons are
      // confirmed working live. Shows exactly what Messenger sent us and
      // what we extracted from it, so a "button tap does nothing" report
      // can be checked against the real payload instead of guessed at.
      logger.info(
        `[messenger webhook] psid=${psid || 'none'} quick_reply=${event?.message?.quick_reply?.payload || 'none'} postback=${event?.postback?.payload || 'none'} message_text=${event?.message?.text || 'none'} extracted=${text || 'none'}`
      );

      if (!psid || !text) {
        logger.warn('[messenger webhook] skipped event: missing psid or extracted text', { event });
        continue;
      }

      const result = await handleIncomingMessage({ channel: 'messenger', externalId: psid, displayName: undefined, text });
      await sendStageAwareReply(psid, text, result);
    }
  } catch (err) {
    logger.error(`[messenger webhook] error handling message: ${err.message}`, { stack: err.stack });
  }
}

module.exports = { verifyWebhook, receiveWebhook, sendStageAwareReply };
