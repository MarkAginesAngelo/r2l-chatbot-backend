const { v4: uuidv4 } = require('uuid');
const db = require('../../config/db');
const { getSetting } = require('../../controllers/settingsController');
const { notifyStaff } = require('../../config/socket');
const { processUserMessage } = require('../chat/conversationEngine');

async function findOrCreateChannelConversation({ channel, externalId, displayName }) {
  const { rows: existingClient } = await db.query(
    `SELECT * FROM clients WHERE phone = $1 OR email = $1 LIMIT 1`,
    [externalId]
  );

  let client = existingClient[0];
  if (!client) {
    // This function only ever runs for WhatsApp/Messenger (website has its own
    // conversation-creation path in chatController.js), so externalId is
    // always a real identifier here — a phone number for WhatsApp, a
    // page-scoped user id (PSID) for Messenger. Both get stored in `phone`
    // so the lookup above can find the same client on the NEXT message.
    // Previously this only stored it for WhatsApp, so every Messenger
    // message created a brand-new client (and conversation) with no way to
    // find the previous one — which looked like the greeting endlessly
    // repeating instead of progressing through the stages.
    const { rows } = await db.query(
      `INSERT INTO clients (id, name, phone) VALUES ($1, $2, $3) RETURNING *`,
      [uuidv4(), displayName || null, externalId]
    );
    client = rows[0];
  }

  const { rows: openConvo } = await db.query(
    `SELECT * FROM conversations
     WHERE client_id = $1 AND channel = $2 AND status != 'closed'
     ORDER BY created_at DESC LIMIT 1`,
    [client.id, channel]
  );

  if (openConvo[0]) {
    // A returning WhatsApp/Messenger user (same phone number/PSID) may have
    // an entirely different case days later. Without this, they'd silently
    // resume whatever stage/category/scenario they left off at instead of
    // being asked from the start again — per R2L's testing feedback.
    // `session_reset_hours` is a settings-table value (default 24, see
    // migration 004) so R2L can tune it without a redeploy. Computed in JS
    // rather than SQL EXTRACT() so this works identically against real
    // Postgres and the pg-mem instance the test suite runs against.
    const resetHours = Number(await getSetting('session_reset_hours')) || 24;
    const updatedAt = new Date(openConvo[0].updated_at).getTime();
    const hoursSinceUpdate = (Date.now() - updatedAt) / (1000 * 60 * 60);

    if (hoursSinceUpdate >= resetHours) {
      await db.query(`UPDATE conversations SET status = 'closed', updated_at = now() WHERE id = $1`, [
        openConvo[0].id,
      ]);
    } else {
      return { client, conversation: openConvo[0] };
    }
  }

  const { rows: newConvo } = await db.query(
    `INSERT INTO conversations (id, client_id, channel, status, stage) VALUES ($1, $2, $3, 'open', 'greeting') RETURNING *`,
    [uuidv4(), client.id, channel]
  );
  return { client, conversation: newConvo[0] };
}

async function storeUserMessage(conversationId, content, language) {
  await db.query(
    `INSERT INTO messages (id, conversation_id, sender_type, content, language) VALUES ($1, $2, 'user', $3, $4)`,
    [uuidv4(), conversationId, content, language]
  );
}

/**
 * Single entry point for WhatsApp/Messenger. `text` may be free text or a
 * button / quick-reply id ("yes" / "no" for the yes-no questions). Returns
 * { reply, replyParts, conversationId, needsHuman, stage, language, options }
 * so the webhook can decide whether to send plain text or buttons back. The
 * conversation flow itself is shared with the website chat
 * (services/chat/conversationEngine.js).
 */
async function handleIncomingMessage({ channel, externalId, displayName, text }) {
  const { conversation } = await findOrCreateChannelConversation({ channel, externalId, displayName });

  await storeUserMessage(conversation.id, text, conversation.language || null);
  notifyStaff('conversation:message', { conversationId: conversation.id, senderType: 'user', content: text });

  return processUserMessage({ conversation, text, channel });
}

module.exports = { handleIncomingMessage, findOrCreateChannelConversation };
