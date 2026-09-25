const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { AppError } = require('../middlewares/errorHandler');
const { retrieveRelevantChunks } = require('../services/rag/retrievalService');
const { generateAnswer, detectLanguage, translateToEnglish, translateText } = require('../services/ai/openaiClient');
const { getSetting } = require('./settingsController');
const { notifyStaff } = require('../config/socket');
const { handleTriageStage } = require('../services/triage/triageEngine');
const { CATEGORIES } = require('../services/triage/categories');
const { getQdrantFilterForCategory } = require('../services/triage/categoryFilter');
const { resolveQuickAction } = require('../services/triage/quickActions');

const SYSTEM_PROMPT = `You are the official assistant for Right to Life Sri Lanka (R2L), an NGO.
Answer only using the provided context from R2L's approved knowledge base.
If the context does not contain enough information, say so honestly and offer to connect the user
with a human R2L representative. Do not invent procedures, contact details, or legal advice.
Be respectful, calm, and clear — many users may be in distress.`;

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

async function storeMessage(conversationId, senderType, content, language, chunkIds = []) {
  await db.query(
    `INSERT INTO messages (id, conversation_id, sender_type, content, language, retrieved_chunk_ids)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [uuidv4(), conversationId, senderType, content, language, chunkIds]
  );
}

/** Recent turns of a conversation, oldest first, for two purposes: giving
 * generateAnswer real conversational memory, and building a context-aware
 * retrieval query so a vague follow-up ("what should I do now?") can still
 * find the right document — its own text alone carries almost no signal
 * for embedding search without knowing what "now" refers to. */
async function getRecentMessages(conversationId, limit = 8) {
  const { rows } = await db.query(
    `SELECT sender_type, content FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [conversationId, limit]
  );
  return rows
    .reverse()
    .map((r) => ({ role: r.sender_type === 'user' ? 'user' : 'assistant', content: r.content }));
}

async function chat(req, res) {
  const { message, conversationId, channel = 'website' } = req.body;
  if (!message || typeof message !== 'string') {
    throw new AppError('message is required', 400);
  }

  const convo = await getOrCreateConversation(conversationId, channel);

  await storeMessage(convo.id, 'user', message, convo.language || null);
  notifyStaff('conversation:message', { conversationId: convo.id, senderType: 'user', content: message });

  const triageResult = await handleTriageStage(convo, message);

  if (triageResult && triageResult.fallThrough) {
    // No canned reply — persist the stage/category change and fall through
    // to the normal RAG pipeline below using the user's original message
    // (they typed a real question instead of picking a scenario-menu
    // option, so don't swallow it with a re-prompt).
    await db.query(
      `UPDATE conversations SET stage = $1, category = COALESCE($2, category), updated_at = now() WHERE id = $3`,
      [triageResult.newStage, triageResult.newCategory || null, convo.id]
    );
    convo.stage = triageResult.newStage;
    convo.category = triageResult.newCategory || convo.category;
  } else if (triageResult) {
    const { reply, newStage, newLanguage, newCategory, isEmergency, options } = triageResult;
    const language = newLanguage || convo.language || 'en';

    await db.query(
      `UPDATE conversations SET stage = $1, language = COALESCE($2, language),
         category = COALESCE($3, category), updated_at = now() WHERE id = $4`,
      [newStage, newLanguage || null, newCategory || null, convo.id]
    );

    await storeMessage(convo.id, 'ai', reply, language);
    notifyStaff('conversation:message', { conversationId: convo.id, senderType: 'ai', content: reply });

    if (isEmergency) {
      await db.query(`UPDATE conversations SET status = 'needs_human' WHERE id = $1`, [convo.id]);
      await db.query(
        `INSERT INTO human_handoffs (id, conversation_id, status, priority) VALUES ($1, $2, 'pending', 'emergency')`,
        [uuidv4(), convo.id]
      );
      notifyStaff('handoff:requested', {
        conversationId: convo.id,
        channel,
        language,
        lastMessage: message,
        requestedAt: new Date().toISOString(),
        priority: 'emergency',
      });
    }

    await db.query(
      `INSERT INTO analytics_events (id, event_type, channel, language, conversation_id)
       VALUES ($1, 'message_sent', $2, $3, $4)`,
      [uuidv4(), channel, language, convo.id]
    );

    return res.json({
      reply,
      conversationId: convo.id,
      language,
      stage: newStage,
      options: options || undefined,
      needsHuman: Boolean(isEmergency),
    });
  }

  const category = CATEGORIES.find((c) => c.key === convo.category);

  // Quick-action intercept: some categories (currently Police) offer canned
  // buttons (Contact R2L / Legal Aid / Know Your Rights) alongside free-form
  // questions. Checked BEFORE language detection deliberately — a button tap
  // sends back a short ASCII id/label (e.g. "legal_aid"), which has no
  // language signal for detectLanguage to work with and would always come
  // back "en" regardless of what the user actually selected earlier. Use the
  // conversation's already-established language instead.
  const quickAction = convo.category ? resolveQuickAction(convo.category, message) : null;
  if (quickAction) {
    const language = convo.language || 'en';
    const localizedReply =
      language === 'en' ? quickAction.response : await translateText(quickAction.response, language);
    await storeMessage(convo.id, 'ai', localizedReply, language);
    await db.query(
      `INSERT INTO analytics_events (id, event_type, channel, language, conversation_id)
       VALUES ($1, 'message_sent', $2, $3, $4)`,
      [uuidv4(), channel, language, convo.id]
    );
    return res.json({ reply: localizedReply, conversationId: convo.id, language, stage: 'in_chat', needsHuman: false });
  }

  const language = await detectLanguage(message);

  const topK = await getSetting('retrieval_top_k');
  const threshold = await getSetting('low_confidence_threshold');
  const retrievalQuery = await translateToEnglish(message, language);

  // history includes the message we just stored (getRecentMessages queries
  // fresh from the DB), so the last entry is the current turn — drop it for
  // generateAnswer (passed separately as userMessage) but use it as
  // additional retrieval context, since a short follow-up alone often has
  // too little content for embedding search to match anything.
  const recentHistory = await getRecentMessages(convo.id, 8);
  const priorTurns = recentHistory.slice(0, -1);
  const conversationalContext = priorTurns
    .slice(-3)
    .map((h) => h.content)
    .join(' ');
  const contextualRetrievalQuery = conversationalContext
    ? `${conversationalContext} ${retrievalQuery}`
    : retrievalQuery;

  const filter = category ? await getQdrantFilterForCategory(category) : undefined;
  const chunks = await retrieveRelevantChunks(contextualRetrievalQuery, { limit: topK, filter });
  const bestScore = chunks[0]?.score ?? 0;
  const needsHuman = chunks.length === 0 || bestScore < threshold;

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
        history: priorTurns,
      });

  await storeMessage(convo.id, 'ai', reply, language, chunks.map((c) => c.chunkId));

  if (needsHuman) {
    await db.query(`UPDATE conversations SET status = 'needs_human' WHERE id = $1`, [convo.id]);
    await db.query(
      `INSERT INTO human_handoffs (id, conversation_id, status) VALUES ($1, $2, 'pending')`,
      [uuidv4(), convo.id]
    );
    notifyStaff('handoff:requested', {
      conversationId: convo.id,
      channel,
      language,
      lastMessage: message,
      requestedAt: new Date().toISOString(),
    });
  }

  await db.query(
    `INSERT INTO analytics_events (id, event_type, channel, language, conversation_id)
     VALUES ($1, 'message_sent', $2, $3, $4)`,
    [uuidv4(), channel, language, convo.id]
  );

  res.json({ reply, conversationId: convo.id, language, stage: 'in_chat', needsHuman });
}

module.exports = { chat };
