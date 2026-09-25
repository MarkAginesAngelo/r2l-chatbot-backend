const { v4: uuidv4 } = require('uuid');
const db = require('../../config/db');
const { retrieveRelevantChunks } = require('../rag/retrievalService');
const { generateAnswer, detectLanguage, translateToEnglish, translateText } = require('../ai/openaiClient');
const { getSetting } = require('../../controllers/settingsController');
const { notifyStaff } = require('../../config/socket');
const { handleTriageStage } = require('../triage/triageEngine');
const { CATEGORIES } = require('../triage/categories');
const { getQdrantFilterForCategory, getQdrantFilterForScenario } = require('../triage/categoryFilter');
const { resolveQuickAction } = require('../triage/quickActions');
const { findScenarioByKey } = require('../triage/scenarios');

const SYSTEM_PROMPT = `You are the official assistant for Right to Life Sri Lanka (R2L), an NGO.
Answer only using the provided context from R2L's approved knowledge base.
If the context does not contain enough information, say so honestly and offer to connect the user
with a human R2L representative. Do not invent procedures, contact details, or legal advice.
Be respectful, calm, and clear — many users may be in distress.`;

const HANDOFF_MESSAGES = {
  en: "I don't have enough approved information to answer that confidently. An R2L representative will follow up with you here shortly.",
  si: 'මට එය විශ්වාසයෙන් පිළිතුරු දීමට ප්‍රමාණවත් අනුමත තොරතුරු නොමැත. R2L නියෝජිතයෙකු ඉක්මනින් ඔබ හා සම්බන්ධ වනු ඇත.',
  ta: 'இதற்கு நம்பிக்கையுடன் பதிலளிக்க போதுமான அங்கீகரிக்கப்பட்ட தகவல் என்னிடம் இல்லை. R2L பிரதிநிதி விரைவில் உங்களைத் தொடர்பு கொள்வார்.',
};

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

async function storeMessage(conversationId, senderType, content, language, chunkIds = []) {
  await db.query(
    `INSERT INTO messages (id, conversation_id, sender_type, content, language, retrieved_chunk_ids)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [uuidv4(), conversationId, senderType, content, language, chunkIds]
  );
}

/** Same reasoning as chatController.js: recent turns give generateAnswer
 * real conversational memory and let retrieval find the right document for
 * a short, context-dependent follow-up. */
async function getRecentMessages(conversationId, limit = 8) {
  const { rows } = await db.query(
    `SELECT sender_type, content FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [conversationId, limit]
  );
  return rows
    .reverse()
    .map((r) => ({ role: r.sender_type === 'user' ? 'user' : 'assistant', content: r.content }));
}

/**
 * Single entry point for WhatsApp/Messenger. `text` may be free text or a
 * WhatsApp interactive reply's id/title — the triage engine's token matching
 * handles both. Returns { reply, conversationId, needsHuman, stage, options }
 * so the webhook can decide whether to send plain text or an interactive
 * message back.
 */
async function handleIncomingMessage({ channel, externalId, displayName, text }) {
  const { conversation } = await findOrCreateChannelConversation({ channel, externalId, displayName });

  await storeMessage(conversation.id, 'user', text, conversation.language || null);
  notifyStaff('conversation:message', { conversationId: conversation.id, senderType: 'user', content: text });

  const triageResult = await handleTriageStage(conversation, text);

  if (triageResult && triageResult.fallThrough) {
    // scenario is set directly (not COALESCE'd) — the triage engine always
    // returns an explicit newScenario (a key, or null to clear it) at every
    // stage transition, since "which scenario is active" is fully
    // determined by the stage being entered, unlike category/language which
    // may genuinely be unknown yet.
    await db.query(
      `UPDATE conversations SET stage = $1, category = COALESCE($2, category), scenario = $3, updated_at = now() WHERE id = $4`,
      [triageResult.newStage, triageResult.newCategory || null, triageResult.newScenario || null, conversation.id]
    );
    conversation.stage = triageResult.newStage;
    conversation.category = triageResult.newCategory || conversation.category;
    conversation.scenario = triageResult.newScenario || null;
  } else if (triageResult) {
    const {
      reply,
      newStage,
      newLanguage,
      newCategory,
      newScenario,
      isEmergency,
      options,
      // Category/scenario menus carry the FULL sentence per option
      // (menuStyle: 'list') rather than a short button label — it's up to
      // each channel controller to decide how to lay that out (the website
      // widget just renders every option; Messenger paginates it into a
      // List Template — see messengerWebhookController.js).
      menuStyle,
    } = triageResult;
    const language = newLanguage || conversation.language || 'en';

    await db.query(
      `UPDATE conversations SET stage = $1, language = COALESCE($2, language),
         category = COALESCE($3, category), scenario = $4, updated_at = now() WHERE id = $5`,
      [newStage, newLanguage || null, newCategory || null, newScenario || null, conversation.id]
    );
    conversation.scenario = newScenario || null;

    await storeMessage(conversation.id, 'ai', reply, language);

    if (isEmergency) {
      await db.query(`UPDATE conversations SET status = 'needs_human' WHERE id = $1`, [conversation.id]);
      await db.query(
        `INSERT INTO human_handoffs (id, conversation_id, status, priority) VALUES ($1, $2, 'pending', 'emergency')`,
        [uuidv4(), conversation.id]
      );
      notifyStaff('handoff:requested', {
        conversationId: conversation.id,
        channel,
        language,
        lastMessage: text,
        requestedAt: new Date().toISOString(),
        priority: 'emergency',
      });
    }

    await db.query(
      `INSERT INTO analytics_events (id, event_type, channel, language, conversation_id)
       VALUES ($1, 'message_sent', $2, $3, $4)`,
      [uuidv4(), channel, language, conversation.id]
    );

    return {
      reply,
      conversationId: conversation.id,
      needsHuman: Boolean(isEmergency),
      stage: newStage,
      options,
      menuStyle,
    };
  }

  const category = CATEGORIES.find((c) => c.key === conversation.category);

  // Same reasoning as chatController.js: check quick actions BEFORE language
  // detection. A button/quick-reply tap sends back a short ASCII id (e.g.
  // "legal_aid") with no language signal, so detecting from it would always
  // yield "en" regardless of what the user actually selected. Use the
  // conversation's already-established language instead.
  const quickAction = conversation.category ? resolveQuickAction(conversation.category, text) : null;
  if (quickAction) {
    const language = conversation.language || 'en';
    const localizedReply =
      language === 'en' ? quickAction.response : await translateText(quickAction.response, language);
    await storeMessage(conversation.id, 'ai', localizedReply, language);
    await db.query(
      `INSERT INTO analytics_events (id, event_type, channel, language, conversation_id)
       VALUES ($1, 'message_sent', $2, $3, $4)`,
      [uuidv4(), channel, language, conversation.id]
    );
    return { reply: localizedReply, conversationId: conversation.id, needsHuman: false, stage: 'in_chat' };
  }

  const language = await detectLanguage(text);

  await db.query(`UPDATE conversations SET language = $1, updated_at = now() WHERE id = $2`, [
    language,
    conversation.id,
  ]);

  const topK = await getSetting('retrieval_top_k');
  const threshold = await getSetting('low_confidence_threshold');
  const retrievalQuery = await translateToEnglish(text, language);

  const recentHistory = await getRecentMessages(conversation.id, 8);
  const priorTurns = recentHistory.slice(0, -1);
  const conversationalContext = priorTurns
    .slice(-3)
    .map((h) => h.content)
    .join(' ');
  const contextualRetrievalQuery = conversationalContext
    ? `${conversationalContext} ${retrievalQuery}`
    : retrievalQuery;

  // If a specific scenario is active (the user picked one from the menu),
  // scope retrieval to just that scenario's document first — otherwise a
  // follow-up question could surface a DIFFERENT scenario's contacts from
  // the same category (e.g. giving a sextortion victim the wage-theft
  // hotline just because both live under a broader category). If that
  // narrow search comes back empty or low-confidence, widen to the whole
  // category before giving up — the follow-up may genuinely be about
  // something else, and staying wrongly scoped forever would be worse.
  const activeScenario = findScenarioByKey(conversation.category, conversation.scenario);
  const scenarioFilter = activeScenario ? await getQdrantFilterForScenario(activeScenario, language) : undefined;
  const categoryFilter = category ? await getQdrantFilterForCategory(category, language) : undefined;
  const filter = scenarioFilter || categoryFilter;

  let chunks = await retrieveRelevantChunks(contextualRetrievalQuery, { limit: topK, filter });
  let bestScore = chunks[0]?.score ?? 0;

  if (scenarioFilter && categoryFilter && (chunks.length === 0 || bestScore < threshold)) {
    const widerChunks = await retrieveRelevantChunks(contextualRetrievalQuery, { limit: topK, filter: categoryFilter });
    const widerBestScore = widerChunks[0]?.score ?? 0;
    if (widerBestScore > bestScore) {
      chunks = widerChunks;
      bestScore = widerBestScore;
    }
  }

  const needsHuman = chunks.length === 0 || bestScore < threshold;

  const reply = needsHuman
    ? HANDOFF_MESSAGES[language] || HANDOFF_MESSAGES.en
    : await generateAnswer({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: text,
        contextChunks: chunks,
        language,
        history: priorTurns,
      });

  await storeMessage(conversation.id, 'ai', reply, language, chunks.map((c) => c.chunkId));

  if (needsHuman) {
    await db.query(`UPDATE conversations SET status = 'needs_human' WHERE id = $1`, [conversation.id]);
    await db.query(
      `INSERT INTO human_handoffs (id, conversation_id, status) VALUES ($1, $2, 'pending')`,
      [uuidv4(), conversation.id]
    );
    notifyStaff('handoff:requested', {
      conversationId: conversation.id,
      channel,
      language,
      lastMessage: text,
      requestedAt: new Date().toISOString(),
    });
  }

  await db.query(
    `INSERT INTO analytics_events (id, event_type, channel, language, conversation_id)
     VALUES ($1, 'message_sent', $2, $3, $4)`,
    [uuidv4(), channel, language, conversation.id]
  );

  return { reply, conversationId: conversation.id, needsHuman, stage: 'in_chat' };
}

module.exports = { handleIncomingMessage, findOrCreateChannelConversation };
