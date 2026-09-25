const env = require('../../config/env');

const GRAPH_BASE = 'https://graph.facebook.com/v20.0/me/messages';

async function callGraphAPI(body) {
  const url = `${GRAPH_BASE}?access_token=${env.messenger.pageAccessToken}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Messenger send failed: ${res.status} ${errBody}`);
  }
  return res.json();
}

async function sendMessengerMessage(psid, text) {
  return callGraphAPI({ recipient: { id: psid }, message: { text } });
}

/**
 * Quick replies — Messenger supports up to 13, plenty for our largest menu
 * (6 scenarios + "Other" = 7). Titles are capped at 20 chars per Messenger's
 * limit; if truncation makes two titles collide (e.g. two long labels that
 * only differ after char 20), a short numeric suffix is appended to the
 * later one so every button stays visibly distinct and still taps through
 * to the right payload (the payload — the real id the triage engine
 * matches on — is never touched by this, only the on-screen label).
 */
function dedupedTitles(options, limit) {
  const seenTitles = new Set();
  return options.slice(0, limit).map((o, i) => {
    let title = String(o.label || '').slice(0, 20);
    if (seenTitles.has(title)) {
      const suffix = ` #${i + 1}`;
      title = title.slice(0, 20 - suffix.length) + suffix;
    }
    seenTitles.add(title);
    return { title, payload: o.id };
  });
}

async function sendMessengerQuickReplies(psid, text, options) {
  const quick_replies = dedupedTitles(options, 13).map((o) => ({
    content_type: 'text',
    title: o.title,
    payload: o.payload,
  }));

  return callGraphAPI({
    recipient: { id: psid },
    message: { text, quick_replies },
  });
}

/**
 * Vertically-stacked, full-width buttons (Messenger's "Button Template"),
 * as opposed to sendMessengerQuickReplies' horizontally-scrolling chips.
 * Meta caps a button template at 3 buttons — this is a hard platform limit
 * (https://developers.facebook.com/docs/messenger-platform/send-messages/template/button),
 * the same 3-button cap as WhatsApp's interactive "reply buttons" — so this
 * is only usable for menus with 3 options or fewer (e.g. the language
 * picker). A larger menu (6 categories, up to 7 scenarios) has to stay on
 * sendMessengerQuickReplies' horizontal row; there's no Meta-supported way
 * to show more than 3 tappable buttons vertically attached to one message
 * outside of a paginated List Template.
 */
async function sendMessengerButtonTemplate(psid, text, options) {
  const buttons = dedupedTitles(options, 3).map((o) => ({
    type: 'postback',
    title: o.title,
    payload: o.payload,
  }));

  return callGraphAPI({
    recipient: { id: psid },
    message: {
      attachment: {
        type: 'template',
        payload: { template_type: 'button', text, buttons },
      },
    },
  });
}

// A "List Template" (vertical rows with a title up to 80 chars, instead of
// the usual 20) was tried here for the category/scenario menus, but Meta's
// own Graph API rejected it live with an opaque, generic failure —
// `(#-1) Unexpected internal error` / error_subcode 2018012 — on every
// single send, with no structural problem in the request to fix on our
// side. Meta has been inconsistent about List Template support across
// Pages/API versions, and a bot feature that depends on it can't be
// trusted to keep working. Removed in favor of paginating the proven,
// working Button Template (see sendMessengerButtonTemplate above and
// messengerWebhookController.js) instead — vertical buttons, just capped
// at Meta's real 20-character title limit and 2 real options per page
// (reserving the 3rd button slot for "More options").

module.exports = { sendMessengerMessage, sendMessengerQuickReplies, sendMessengerButtonTemplate };
