const { generateAnswer, generateOpenAnswer } = require('./openaiClient');
const { getSetting } = require('../../controllers/settingsController');

const KB_ONLY_PROMPT = `You are the official assistant for Right to Life Sri Lanka (R2L), an NGO.
Answer only using the provided context from R2L's approved knowledge base.
If the context does not contain enough information, say so honestly and offer to connect the user
with a human R2L representative. Do not invent procedures, contact details, or legal advice.
Be respectful, calm, and clear — many users may be in distress.`;

const HYBRID_PROMPT = `You are the official assistant for Right to Life Sri Lanka (R2L), an NGO that helps people with
police and arrest issues, cyber crime, financial and debt problems, land and housing disputes, family and child
matters, and personal danger. People talking to you are often frightened, hurt or confused. You are speaking with
them directly in a chat: be warm, calm, respectful and human. Never be cold, robotic or judgmental.

There are no menus. The person simply tells you what is happening, and you work out the situation from the
conversation. In every reply:

1. LISTEN FIRST. If the person describes something frightening or painful, start with one short, sincere sentence
   acknowledging how they must feel (no more than that, and do not repeat the same sympathy every turn).
2. UNDERSTAND THE CASE. If you do not yet know enough to guide them properly, ask ONE short follow-up question
   (at most two). Ask only what changes your advice — for example what happened, when, whether anyone is in
   danger right now, or whether the police or a lawyer are already involved. Read the conversation so far and
   NEVER ask for something the person has already told you. Do not interrogate, and do not ask several questions
   in a row without giving something useful back.
3. GUIDE. Once you understand the situation, give clear, practical guidance: what to do next, their rights, and
   which service or office can help. Use the approved R2L knowledge base material as your main source and follow
   it closely. Hotline numbers, addresses, office names and R2L procedures may ONLY come from that material.
   Ignore any material that does not actually relate to the question.
4. If the material is missing or does not cover the question, still help from your general knowledge in a Sri
   Lankan context. NEVER invent phone numbers, addresses, section numbers, court names or fees. If you are not
   sure, say so plainly and suggest a lawyer, the Legal Aid Commission or an R2L representative. You give general
   information, not formal legal advice; mention this briefly only when the question is about a legal decision.
5. Keep replies short and easy to read: plain text, short paragraphs, simple words, usually under about 120 words.
   Do not use markdown headings or bold. A short list with "•" is fine for steps. Greetings, thanks and small talk
   are welcome — answer naturally.
6. Do NOT ask the person whether they want to speak to an R2L representative, and do NOT ask for their name,
   phone number or other personal details. The system does that itself at the right moment.

Control tokens. Add them on their own line at the very end of your reply, never mention them, and use them only
when the rule applies:
- [[EMERGENCY]] — the person (or someone else) is in immediate danger right now, is being attacked or threatened
  with violence, is thinking of harming themselves, or a child is in danger. Give the safest immediate steps.
- [[HANDOFF]] — the person asks to speak to a human, a lawyer or an R2L representative, or the matter is serious
  and needs R2L staff to act, beyond the information you can give.
- [[WRAP_UP]] — you have given your guidance, you have no further question to ask, and the conversation has
  reached a natural end (including when the person says thanks, goodbye or that they need nothing more). Do not
  use it in a reply that ends with a question to the person.`;

// In hybrid mode, material below the strict threshold but above this floor is still
// shown to the AI (cross-language matches, e.g. an English question against a Sinhala
// document, score lower). The prompt tells it to use the material only if relevant.
const HYBRID_MIN_SCORE = 0.45;

const CONTROL_TOKENS = /\s*\[\[(EMERGENCY|HANDOFF|WRAP_UP)\]\]\s*/g;

const KB_ONLY_HANDOFF = {
  en: "I don't have enough approved information to answer that confidently. Would you like me to connect you with an R2L representative?",
  si: 'මට එය විශ්වාසයෙන් පිළිතුරු දීමට ප්‍රමාණවත් අනුමත තොරතුරු නොමැත. ඔබට R2L නියෝජිතයෙකු සමඟ සම්බන්ධ කරන්නද?',
  ta: 'இதற்கு நம்பிக்கையுடன் பதிலளிக்க போதுமான அங்கீகரிக்கப்பட்ட தகவல் என்னிடம் இல்லை. R2L பிரதிநிதியுடன் இணைக்கவா?',
};

/**
 * Decide how to answer a free-text message. Returns { reply, needsHuman }.
 * `kbOnlyHandoff` lets a channel keep its own wording for the old behaviour.
 */
async function composeAnswer({ text, language, chunks, bestScore, threshold, history, kbOnlyHandoff }) {
  const mode = (await getSetting('ai_mode')) || 'hybrid';
  const grounded = chunks.length > 0 && bestScore >= threshold;

  if (mode === 'kb_only') {
    if (!grounded) {
      return { reply: (kbOnlyHandoff || KB_ONLY_HANDOFF)[language] || KB_ONLY_HANDOFF.en, needsHuman: true, emergency: false, wrapUp: false };
    }
    const reply = await generateAnswer({
      systemPrompt: KB_ONLY_PROMPT,
      userMessage: text,
      contextChunks: chunks,
      language,
      history,
    });
    return { reply, needsHuman: false, emergency: false, wrapUp: false };
  }

  const raw = await generateOpenAnswer({
    systemPrompt: HYBRID_PROMPT,
    userMessage: text,
    contextChunks: chunks.filter((c) => c.score >= Math.min(threshold, HYBRID_MIN_SCORE)),
    language,
    history,
  });
  const emergency = /\[\[EMERGENCY\]\]/.test(raw);
  const needsHuman = emergency || /\[\[HANDOFF\]\]/.test(raw);
  let wrapUp = /\[\[WRAP_UP\]\]/.test(raw);
  const reply = raw.replace(CONTROL_TOKENS, '\n').trim();
  // A reply that ends by asking the person something is not the end of the chat.
  if (/[?？]\s*$/.test(reply)) wrapUp = false;
  return {
    reply: reply || (KB_ONLY_HANDOFF[language] || KB_ONLY_HANDOFF.en),
    needsHuman,
    emergency,
    wrapUp,
  };
}

module.exports = { composeAnswer, HYBRID_PROMPT, KB_ONLY_PROMPT };
