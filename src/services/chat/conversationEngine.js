const { v4: uuidv4 } = require('uuid');
const db = require('../../config/db');
const { retrieveRelevantChunks } = require('../rag/retrievalService');
const { detectLanguage, translateToEnglish } = require('../ai/openaiClient');
const { getSetting } = require('../../controllers/settingsController');
const { notifyStaff } = require('../../config/socket');
const { CATEGORIES } = require('../triage/categories');
const { getQdrantFilterForCategory, getQdrantFilterForScenario } = require('../triage/categoryFilter');
const { findScenarioByKey } = require('../triage/scenarios');
const { buildReplyParts } = require('../triage/replyFormatter');
const { buildEmergencyMessage } = require('../triage/messages');
const { detectCase, curatedContextChunk } = require('../triage/caseClassifier');
const { composeAnswer } = require('../ai/answerPolicy');
const { widenToAllDocuments } = require('../rag/generalFallback');
const { GREETING, t, yesNoOptions, parseYesNo, isSkip, isGreetingOnly } = require('./flowMessages');

/**
 * The one conversation flow used by the website, WhatsApp and Messenger.
 *
 * There are no language or category menus. The person just writes; the bot
 * works out the language and the case from what they say, answers from the
 * knowledge base (and the AI's general knowledge), and asks follow-up
 * questions where needed. Near the end it:
 *   1. asks whether they want to speak with an R2L representative
 *      (handoff_status: asked -> requested | declined), and
 *   2. if so, asks for consent to share personal details and then collects
 *      them one at a time (consent_status: asked -> granted | declined).
 *
 * `stage` values: greeting | in_chat | awaiting_handoff | awaiting_consent |
 *                 collect_name | collect_phone | collect_age | collect_location
 */

const ASK_AFTER_USER_TURNS = 6; // ask about a representative even if the AI never wraps up

const CONTACT_STEPS = {
  collect_name: { field: 'name', ask: 'askName' },
  collect_phone: { field: 'contact_phone', ask: 'askPhone' },
  collect_age: { field: 'age', ask: 'askAge' },
  collect_location: { field: 'location', ask: 'askLocation' },
};

// ---------------------------------------------------------------------------
// small data helpers
// ---------------------------------------------------------------------------
const CONVERSATION_FIELDS = ['stage', 'language', 'category', 'scenario', 'status', 'handoff_status', 'consent_status', 'client_id'];

async function setConversation(conversation, patch) {
  const keys = Object.keys(patch).filter((k) => CONVERSATION_FIELDS.includes(k));
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${k} = $${i + 1}`);
  await db.query(`UPDATE conversations SET ${sets.join(', ')}, updated_at = now() WHERE id = $${keys.length + 1}`, [
    ...keys.map((k) => patch[k]),
    conversation.id,
  ]);
  for (const k of keys) conversation[k] = patch[k];
}

async function storeMessage(conversationId, senderType, content, language, chunkIds = []) {
  await db.query(
    `INSERT INTO messages (id, conversation_id, sender_type, content, language, retrieved_chunk_ids)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [uuidv4(), conversationId, senderType, content, language, chunkIds]
  );
}

async function getRecentMessages(conversationId, limit = 12) {
  const { rows } = await db.query(
    `SELECT sender_type, content FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [conversationId, limit]
  );
  return rows.reverse().map((r) => ({ role: r.sender_type === 'user' ? 'user' : 'assistant', content: r.content }));
}

async function countUserMessages(conversationId) {
  const { rows } = await db.query(`SELECT COUNT(*) AS n FROM messages WHERE conversation_id = $1 AND sender_type = 'user'`, [
    conversationId,
  ]);
  return Number(rows[0]?.n) || 0;
}

async function logMessageSent(conversation, channel, language) {
  await db.query(
    `INSERT INTO analytics_events (id, event_type, channel, language, conversation_id)
     VALUES ($1, 'message_sent', $2, $3, $4)`,
    [uuidv4(), channel, language, conversation.id]
  );
}

// ---------------------------------------------------------------------------
// language
// ---------------------------------------------------------------------------
async function resolveLanguage(conversation, text) {
  if (/[඀-෿]/.test(text)) return 'si';
  if (/[஀-௿]/.test(text)) return 'ta';
  // A short reply ("yes", "ok", "34") says nothing about language — keep the
  // one already established.
  if (conversation.language && String(text).trim().length <= 12) return conversation.language;
  return detectLanguage(text);
}

// ---------------------------------------------------------------------------
// handoff + client record
// ---------------------------------------------------------------------------
async function requestHumanHandoff(conversation, channel, language, lastMessage, priority = 'normal') {
  const { rows } = await db.query(
    `SELECT id FROM human_handoffs WHERE conversation_id = $1 AND status != 'resolved' LIMIT 1`,
    [conversation.id]
  );
  await setConversation(conversation, { status: 'needs_human', handoff_status: 'requested' });
  if (rows[0]) {
    if (priority === 'emergency') {
      await db.query(`UPDATE human_handoffs SET priority = 'emergency' WHERE id = $1`, [rows[0].id]);
    }
    return;
  }
  await db.query(
    `INSERT INTO human_handoffs (id, conversation_id, status, priority) VALUES ($1, $2, 'pending', $3)`,
    [uuidv4(), conversation.id, priority]
  );
  notifyStaff('handoff:requested', {
    conversationId: conversation.id,
    channel,
    language,
    lastMessage,
    requestedAt: new Date().toISOString(),
    ...(priority === 'emergency' && { priority: 'emergency' }),
  });
}

/** The client row for this conversation, created (and linked) on demand. */
async function ensureClient(conversation) {
  if (conversation.client_id) {
    const { rows } = await db.query('SELECT * FROM clients WHERE id = $1', [conversation.client_id]);
    if (rows[0]) return rows[0];
  }
  const { rows } = await db.query(
    `INSERT INTO clients (id, preferred_language) VALUES ($1, $2) RETURNING *`,
    [uuidv4(), conversation.language || 'en']
  );
  await setConversation(conversation, { client_id: rows[0].id });
  return rows[0];
}

const CLIENT_COLUMNS = ['name', 'contact_phone', 'age', 'location'];
async function saveClientField(conversation, column, value) {
  if (!CLIENT_COLUMNS.includes(column)) throw new Error(`Unsupported client column ${column}`);
  const client = await ensureClient(conversation);
  await db.query(`UPDATE clients SET ${column} = $1, updated_at = now() WHERE id = $2`, [value, client.id]);
}

// ---------------------------------------------------------------------------
// flow stages (handoff question, consent, personal details)
// ---------------------------------------------------------------------------
function result(conversation, { reply, stage, language, needsHuman, options }) {
  return {
    reply,
    replyParts: buildReplyParts(reply, 'in_chat'),
    conversationId: conversation.id,
    needsHuman: Boolean(needsHuman),
    stage,
    language,
    options,
  };
}

function nextContactStep(stage, channel) {
  if (stage === 'collect_name') return channel === 'whatsapp' ? 'collect_age' : 'collect_phone';
  if (stage === 'collect_phone') return 'collect_age';
  if (stage === 'collect_age') return 'collect_location';
  return null; // after location -> done
}

function promptFor(step, language) {
  return `${t(CONTACT_STEPS[step].ask, language)} ${t('skipHint', language)}`;
}

/** Records the consent decision and moves on to the first question. */
async function startConsentAnswer(conversation, channel, language, answer) {
  if (answer === 'no') {
    await setConversation(conversation, { consent_status: 'declined', stage: 'in_chat' });
    return result(conversation, { reply: t('consentDeclined', language), stage: 'in_chat', language });
  }
  const client = await ensureClient(conversation);
  const phoneForWhatsApp = channel === 'whatsapp' ? client.phone : null;
  await db.query(
    `UPDATE clients SET consent_given_at = now(), contact_phone = COALESCE($1, contact_phone), updated_at = now() WHERE id = $2`,
    [phoneForWhatsApp, client.id]
  );
  await setConversation(conversation, { consent_status: 'granted', stage: 'collect_name' });
  return result(conversation, { reply: promptFor('collect_name', language), stage: 'collect_name', language });
}

async function handleFlowStage(conversation, text, channel, language) {
  const stage = conversation.stage;

  if (stage === 'awaiting_handoff') {
    const answer = parseYesNo(text);
    if (!answer) return null; // not a clear yes/no — treat as an ordinary message
    if (answer === 'no') {
      await setConversation(conversation, { handoff_status: 'declined', stage: 'in_chat' });
      return result(conversation, { reply: t('handoffDeclined', language), stage: 'in_chat', language });
    }
    await requestHumanHandoff(conversation, channel, language, text);
    const parts = [t('handoffAck', language)];
    if (conversation.consent_status === 'not_asked') {
      parts.push(t('consentQuestion', language));
      await setConversation(conversation, { stage: 'awaiting_consent', consent_status: 'asked' });
      return result(conversation, {
        reply: parts.join('\n\n'),
        stage: 'awaiting_consent',
        language,
        needsHuman: true,
        options: yesNoOptions(language),
      });
    }
    await setConversation(conversation, { stage: 'in_chat' });
    return result(conversation, { reply: parts.join('\n\n'), stage: 'in_chat', language, needsHuman: true });
  }

  if (stage === 'awaiting_consent') {
    const answer = parseYesNo(text);
    if (!answer) return null;
    return startConsentAnswer(conversation, channel, language, answer);
  }

  if (CONTACT_STEPS[stage]) {
    const { field } = CONTACT_STEPS[stage];
    const raw = String(text).trim();
    const skipped = isSkip(raw);

    if (!skipped) {
      if (field === 'contact_phone') {
        const digits = raw.replace(/[\s\-()+.]/g, '');
        if (!/^\d{7,15}$/.test(digits)) {
          return result(conversation, { reply: t('badPhone', language), stage, language });
        }
        await saveClientField(conversation, field, raw.replace(/\s+/g, ' ').slice(0, 40));
      } else if (field === 'age') {
        const m = raw.match(/\d{1,3}/);
        const age = m ? Number(m[0]) : NaN;
        if (!(age >= 1 && age <= 120)) {
          return result(conversation, { reply: t('badAge', language), stage, language });
        }
        await saveClientField(conversation, field, age);
      } else {
        await saveClientField(conversation, field, raw.slice(0, 100));
      }
    }

    const next = nextContactStep(stage, channel);
    if (next) {
      await setConversation(conversation, { stage: next });
      return result(conversation, { reply: promptFor(next, language), stage: next, language });
    }
    await setConversation(conversation, { stage: 'in_chat' });
    return result(conversation, { reply: t('detailsDone', language), stage: 'in_chat', language });
  }

  return null;
}

// ---------------------------------------------------------------------------
// an ordinary conversational turn
// ---------------------------------------------------------------------------
async function retrieveContext(conversation, text, language, priorTurns) {
  const topK = await getSetting('retrieval_top_k');
  const threshold = await getSetting('low_confidence_threshold');
  const retrievalQuery = await translateToEnglish(text, language);

  const conversationalContext = priorTurns
    .slice(-3)
    .map((h) => h.content)
    .join(' ');
  const contextualRetrievalQuery = conversationalContext ? `${conversationalContext} ${retrievalQuery}` : retrievalQuery;

  // Re-identify the case from this message and the chat so far.
  const detected = await detectCase({
    message: text,
    history: priorTurns,
    currentCategory: conversation.category,
    currentScenario: conversation.scenario,
  });
  if (detected?.changed) {
    await setConversation(conversation, { category: detected.category, scenario: detected.scenario });
  }

  const category = CATEGORIES.find((c) => c.key === conversation.category);
  const activeScenario = findScenarioByKey(conversation.category, conversation.scenario);
  const scenarioFilter = activeScenario ? await getQdrantFilterForScenario(activeScenario, language) : undefined;
  const categoryFilter = category ? await getQdrantFilterForCategory(category, language) : undefined;
  const filter = scenarioFilter || categoryFilter;

  let chunks = await retrieveRelevantChunks(contextualRetrievalQuery, { limit: topK, filter });
  let bestScore = chunks[0]?.score ?? 0;

  if (scenarioFilter && categoryFilter && (chunks.length === 0 || bestScore < threshold)) {
    const wider = await retrieveRelevantChunks(contextualRetrievalQuery, { limit: topK, filter: categoryFilter });
    const widerBest = wider[0]?.score ?? 0;
    if (widerBest > bestScore) {
      chunks = wider;
      bestScore = widerBest;
    }
  }

  // General reference documents (Constitution, UDHR, ...) aren't tied to a scenario.
  ({ chunks, bestScore } = await widenToAllDocuments({
    query: contextualRetrievalQuery,
    originalText: text,
    language,
    topK,
    chunks,
    bestScore,
    threshold,
  }));

  // Sinhala/Tamil: the approved curated wording for the active scenario.
  const curated = conversation.scenario ? curatedContextChunk(conversation.scenario, language) : null;
  if (curated) {
    chunks = [curated, ...chunks];
    bestScore = Math.max(bestScore, curated.score);
  }

  return { chunks, bestScore, threshold };
}

async function conversationTurn(conversation, text, channel, language) {
  const recent = await getRecentMessages(conversation.id, 12);
  const priorTurns = recent.slice(0, -1); // the current message is already stored
  const { chunks, bestScore, threshold } = await retrieveContext(conversation, text, language, priorTurns);

  const answer = await composeAnswer({
    text,
    language,
    chunks,
    bestScore,
    threshold,
    history: priorTurns,
    kbOnlyHandoff: undefined,
  });

  const parts = [answer.reply];
  let stage = 'in_chat';
  let options;
  let needsHuman = false;

  if (answer.emergency) {
    await setConversation(conversation, { category: 'danger', scenario: null });
    await requestHumanHandoff(conversation, channel, language, text, 'emergency');
    parts.push(await buildEmergencyMessage(language));
    needsHuman = true;
  } else if (answer.needsHuman) {
    await requestHumanHandoff(conversation, channel, language, text);
    parts.push(t('handoffAck', language));
    needsHuman = true;
  }

  if (needsHuman) {
    if (conversation.consent_status === 'not_asked') {
      parts.push(t('consentQuestion', language));
      stage = 'awaiting_consent';
      options = yesNoOptions(language);
      await setConversation(conversation, { consent_status: 'asked' });
    }
  } else if (conversation.handoff_status === 'not_asked') {
    const userTurns = await countUserMessages(conversation.id);
    const endsWithQuestion = /[?？]\s*$/.test(answer.reply);
    if (answer.wrapUp || (userTurns >= ASK_AFTER_USER_TURNS && !endsWithQuestion)) {
      parts.push(t('handoffQuestion', language));
      stage = 'awaiting_handoff';
      options = yesNoOptions(language);
      await setConversation(conversation, { handoff_status: 'asked' });
    }
  }

  await setConversation(conversation, { stage });
  const reply = parts.join('\n\n');
  await storeMessage(conversation.id, 'ai', reply, language, chunks.map((c) => c.chunkId).filter(Boolean));
  return { ...result(conversation, { reply, stage, language, needsHuman, options }), stored: true };
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------
/**
 * `conversation` is the conversation row and the person's message is already
 * stored. Returns { reply, replyParts, conversationId, needsHuman, stage,
 * language, options } and stores the bot's reply.
 */
async function processUserMessage({ conversation, text, channel }) {
  const language = await resolveLanguage(conversation, text);
  if (language !== conversation.language) await setConversation(conversation, { language });

  let out = null;

  if (conversation.stage === 'greeting' && isGreetingOnly(text)) {
    await setConversation(conversation, { stage: 'in_chat' });
    out = result(conversation, { reply: GREETING, stage: 'in_chat', language });
    out.replyParts = [GREETING];
  } else if (['awaiting_handoff', 'awaiting_consent', ...Object.keys(CONTACT_STEPS)].includes(conversation.stage)) {
    out = await handleFlowStage(conversation, text, channel, language);
    if (!out) await setConversation(conversation, { stage: 'in_chat' }); // ordinary message after all
  }

  if (!out) {
    if (conversation.stage === 'greeting') await setConversation(conversation, { stage: 'in_chat' });
    out = await conversationTurn(conversation, text, channel, language);
  } else {
    await storeMessage(conversation.id, 'ai', out.reply, language);
  }

  delete out.stored;
  notifyStaff('conversation:message', { conversationId: conversation.id, senderType: 'ai', content: out.reply });
  await logMessageSent(conversation, channel, language);
  return out;
}

module.exports = { processUserMessage };
