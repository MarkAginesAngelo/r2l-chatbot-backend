const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');
const { retrieveRelevantChunks } = require('../services/rag/retrievalService');
const { generateAnswer, detectLanguage } = require('../services/ai/openaiClient');

const SYSTEM_PROMPT = `You are the official assistant for Right to Life Sri Lanka (R2L), an NGO.
Answer only using the provided context from R2L's approved knowledge base.
If the context does not contain enough information, say so honestly and offer to connect the user
with a human R2L representative. Do not invent procedures, contact details, or legal advice.
Be respectful, calm, and clear — many users may be in distress.`;

const LOW_CONFIDENCE_THRESHOLD = 0.72; // tune after real usage data

async function chat(req, res) {
  const { message, conversationId, channel = 'website' } = req.body;
  if (!message || typeof message !== 'string') {
    throw new AppError('message is required', 400);
  }

  // 1. Detect language
  const language = await detectLanguage(message);

  // 2. Ensure conversation exists
  let convoId = conversationId;
  if (!convoId) {
    const { rows } = await db.query(
      `INSERT INTO conversations (id, channel, language, status)
       VALUES ($1, $2, $3, 'open') RETURNING id`,
      [uuidv4(), channel, language]
    );
    convoId = rows[0].id;
  }

  // 3. Store the user's message
  await db.query(
    `INSERT INTO messages (id, conversation_id, sender_type, content, language)
     VALUES ($1, $2, 'user', $3, $4)`,
    [uuidv4(), convoId, message, language]
  );

  // 4. Retrieve relevant knowledge-base chunks
  const chunks = await retrieveRelevantChunks(message, { limit: 5 });
  const bestScore = chunks[0]?.score ?? 0;
  const needsHuman = chunks.length === 0 || bestScore < LOW_CONFIDENCE_THRESHOLD;

  // 5. Generate grounded answer
  const reply = needsHuman
    ? {
        en: "I don't have enough approved information to answer that confidently. Would you like me to connect you with an R2L representative?",
        si: 'මට එය විශ්වාසයෙන් පිළිතුරු දීමට ප්‍රමාණවත් අනුමත තොරතුරු නොමැත. ඔබට R2L නියෝජිතයෙකු සමඟ සම්බන්ධ කරන්නද?',
        ta: 'இதற்கு நம்பிக்கையுடன் பதிலளிக்க போதுமான அங்கீகரிக்கப்பட்ட தகவல் என்னிடம் இல்லை. R2L பிரதிநிதியுடன் இணைக்கவா?',
      }[language]
    : await generateAnswer({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: message,
        contextChunks: chunks,
        language,
      });

  // 6. Store AI response + flag handoff if needed
  await db.query(
    `INSERT INTO messages (id, conversation_id, sender_type, content, language, retrieved_chunk_ids)
     VALUES ($1, $2, 'ai', $3, $4, $5)`,
    [uuidv4(), convoId, reply, language, chunks.map((c) => c.chunkId)]
  );

  if (needsHuman) {
    await db.query(`UPDATE conversations SET status = 'needs_human' WHERE id = $1`, [convoId]);
    await db.query(
      `INSERT INTO human_handoffs (id, conversation_id, status) VALUES ($1, $2, 'pending')`,
      [uuidv4(), convoId]
    );
  }

  await db.query(
    `INSERT INTO analytics_events (id, event_type, channel, language, conversation_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [uuidv4(), 'message_sent', channel, language, convoId]
  );

  res.json({
    reply,
    conversationId: convoId,
    language,
    needsHuman,
  });
}

module.exports = { chat };
