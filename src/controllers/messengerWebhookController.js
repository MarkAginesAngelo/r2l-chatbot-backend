const crypto = require('crypto');
const env = require('../config/env');
const { handleIncomingMessage } = require('../services/channels/messageHandler');
const { sendMessengerMessage } = require('../services/messenger/messengerClient');

function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.messenger.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

/** Verifies the X-Hub-Signature-256 header Meta sends on every webhook POST. */
function verifySignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !env.messenger.appSecret) return false;

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', env.messenger.appSecret).update(req.rawBody || '').digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function receiveWebhook(req, res) {
  res.sendStatus(200); // ack immediately, same reasoning as WhatsApp

  if (env.nodeEnv === 'production' && !verifySignature(req)) {
    // eslint-disable-next-line no-console
    console.warn('[messenger webhook] rejected: invalid signature');
    return;
  }

  try {
    for (const entry of req.body?.entry || []) {
      const event = entry.messaging?.[0];
      const psid = event?.sender?.id;
      const text = event?.message?.text;
      if (!psid || !text) continue; // ignore delivery/read receipts, attachments for now

      const { reply } = await handleIncomingMessage({
        channel: 'messenger',
        externalId: psid,
        displayName: undefined,
        text,
      });

      await sendMessengerMessage(psid, reply);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[messenger webhook] error handling message:', err);
  }
}

module.exports = { verifyWebhook, receiveWebhook };
