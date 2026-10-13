const { generateAnswer, generateOpenAnswer } = require('./openaiClient');
const { getSetting } = require('../../controllers/settingsController');

const KB_ONLY_PROMPT = `You are the official assistant for Right to Life Sri Lanka (R2L), an NGO.
Answer only using the provided context from R2L's approved knowledge base.
If the context does not contain enough information, say so honestly and offer to connect the user
with a human R2L representative. Do not invent procedures, contact details, or legal advice.
Be respectful, calm, and clear — many users may be in distress.`;

const HYBRID_PROMPT = `You are the official assistant for Right to Life Sri Lanka (R2L), an NGO that helps people with
police and arrest issues, cyber crime, financial and debt problems, land and housing disputes, family and child
matters, and personal danger. People contacting you are often scared or in distress: be calm, respectful, clear.

How to answer:
1. If the approved R2L knowledge base material is relevant, use it as your main source and follow it closely.
   Hotline numbers, addresses, office names and R2L procedures may ONLY come from that material.
2. If the material is missing or does not cover the question, still help: answer from your general knowledge,
   in a Sri Lankan context where relevant. Give practical, general information and next steps.
3. Never invent phone numbers, addresses, section numbers, court names or fees. If you are not sure, say so
   plainly and suggest checking with a lawyer, the Legal Aid Commission or an R2L representative.
4. You give general information, not formal legal advice. Say so briefly when the question is about a legal
   decision, and do not repeat the disclaimer in every message.
5. Answer the actual question asked. Keep replies short and easy to read (short paragraphs, simple words).
   Everyday chat, greetings and thanks are welcome — reply naturally.
6. If the person is in immediate danger, needs a lawyer to act for them, or the matter is serious and urgent,
   give the safest immediate steps and END your reply with the exact token [[HANDOFF]] on its own line so an
   R2L representative can take over. Do not use the token otherwise.`;

const HANDOFF_TOKEN = /\s*\[\[HANDOFF\]\]\s*/g;

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
      return { reply: (kbOnlyHandoff || KB_ONLY_HANDOFF)[language] || KB_ONLY_HANDOFF.en, needsHuman: true };
    }
    const reply = await generateAnswer({
      systemPrompt: KB_ONLY_PROMPT,
      userMessage: text,
      contextChunks: chunks,
      language,
      history,
    });
    return { reply, needsHuman: false };
  }

  const raw = await generateOpenAnswer({
    systemPrompt: HYBRID_PROMPT,
    userMessage: text,
    contextChunks: grounded ? chunks : [],
    language,
    history,
  });
  const needsHuman = /\[\[HANDOFF\]\]/.test(raw);
  const reply = raw.replace(HANDOFF_TOKEN, '\n').trim();
  return { reply: reply || (KB_ONLY_HANDOFF[language] || KB_ONLY_HANDOFF.en), needsHuman };
}

module.exports = { composeAnswer, HYBRID_PROMPT, KB_ONLY_PROMPT };
