const env = require('../../config/env');

const GRAPH_BASE = 'https://graph.facebook.com/v20.0';

async function callGraphAPI(body) {
  const url = `${GRAPH_BASE}/${env.whatsapp.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.whatsapp.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`WhatsApp send failed: ${res.status} ${errBody}`);
  }
  return res.json();
}

async function sendWhatsAppMessage(to, text) {
  return callGraphAPI({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  });
}

/** Quick-reply buttons — WhatsApp allows at most 3. Used for language selection. */
async function sendWhatsAppButtons(to, bodyText, buttons) {
  if (buttons.length > 3) {
    throw new Error('WhatsApp reply buttons support at most 3 options — use sendWhatsAppList for more.');
  }
  return callGraphAPI({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.label.slice(0, 20) }, // WhatsApp caps button titles at 20 chars
        })),
      },
    },
  });
}

/** List message — supports up to 10 rows. Used for the 6-option category menu.
 * WhatsApp caps row titles at 24 chars, which most category labels exceed, so
 * the short "Option N" goes in the title and the full label goes in the
 * description (72-char cap) where it's still fully visible to the user. */
async function sendWhatsAppList(to, bodyText, buttonText, rows) {
  return callGraphAPI({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonText.slice(0, 20),
        sections: [
          {
            title: 'Options',
            rows: rows.map((r) => ({
              id: r.id,
              title: `Option ${r.id}`.slice(0, 24),
              description: r.label.slice(0, 72),
            })),
          },
        ],
      },
    },
  });
}

module.exports = { sendWhatsAppMessage, sendWhatsAppButtons, sendWhatsAppList };
