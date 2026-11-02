const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');
const { notifyStaff } = require('../config/socket');
const { processUserMessage } = require('../services/chat/conversationEngine');

async function getOrCreateConversation(conversationId, channel) {
  if (conversationId) {
    const { rows } = await db.query('SELECT * FROM conversations WHERE id = $1', [conversationId]);
    if (!rows[0]) throw new AppError('Conversation not found', 404);
    return rows[0];
  }
  const { rows } = await db.query(
    `INSERT INTO conversations (id, channel, status, stage) VALUES ($1, $2, 'open', 'greeting') RETURNING *`,
    [uuidv4(), channel]
  );
  return rows[0];
}

async function storeUserMessage(conversationId, content, language) {
  await db.query(
    `INSERT INTO messages (id, conversation_id, sender_type, content, language) VALUES ($1, $2, 'user', $3, $4)`,
    [uuidv4(), conversationId, content, language]
  );
}

/** Website chat endpoint. The conversation flow itself lives in
 * services/chat/conversationEngine.js and is shared with WhatsApp/Messenger. */
async function chat(req, res) {
  const { message, conversationId, channel = 'website' } = req.body;
  if (!message || typeof message !== 'string') {
    throw new AppError('message is required', 400);
  }

  const convo = await getOrCreateConversation(conversationId, channel);

  await storeUserMessage(convo.id, message, convo.language || null);
  notifyStaff('conversation:message', { conversationId: convo.id, senderType: 'user', content: message });

  const out = await processUserMessage({ conversation: convo, text: message, channel });

  res.json({
    reply: out.reply,
    replyParts: out.replyParts,
    conversationId: convo.id,
    language: out.language,
    stage: out.stage,
    options: out.options || undefined,
    needsHuman: out.needsHuman,
  });
}

module.exports = { chat };
