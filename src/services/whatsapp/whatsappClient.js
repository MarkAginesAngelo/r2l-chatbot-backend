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

function clip(text, max) {
  const t = String(text || '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
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
      body: { text: clip(bodyText, 1024) },
      action: {
        buttons: buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: clip(b.label, 20) }, // WhatsApp caps button titles at 20 chars
        })),
      },
    },
  });
}

/** List message — supports up to 10 rows. Used for the category / scenario menus.
 * WhatsApp caps row titles at 24 chars and descriptions at 72. The title is the
 * menu number plus as much of the label as fits; when the label is longer the
 * full text (up to 72 chars) goes in the description. Row ids must be unique
 * and are what comes back to us when the user taps a row. */
async function sendWhatsAppList(to, bodyText, buttonText, rows) {
  const mapped = rows.slice(0, 10).map((r) => {
    const label = String(r.label || '').trim();
    const title = clip(r.number ? `${r.number}. ${label}` : label, 24);
    const row = { id: String(r.id).slice(0, 200), title };
    if (label.length > 21 || r.number) row.description = clip(label, 72);
    return row;
  });
  return callGraphAPI({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: clip(bodyText, 1024) },
      action: {
        button: clip(buttonText, 20),
        sections: [{ title: 'R2L', rows: mapped }],
      },
    },
  });
}

module.exports = { sendWhatsAppMessage, sendWhatsAppButtons, sendWhatsAppList };
