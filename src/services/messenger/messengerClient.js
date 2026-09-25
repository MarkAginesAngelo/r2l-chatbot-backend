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

/** Quick replies — Messenger supports up to 13, plenty for our 6-option menu. */
async function sendMessengerQuickReplies(psid, text, options) {
  return callGraphAPI({
    recipient: { id: psid },
    message: {
      text,
      quick_replies: options.map((o) => ({
        content_type: 'text',
        title: o.label.slice(0, 20), // Messenger caps quick reply titles at 20 chars
        payload: o.id,
      })),
    },
  });
}

module.exports = { sendMessengerMessage, sendMessengerQuickReplies };
