const OpenAI = require('openai');
const env = require('../../config/env');

const client = new OpenAI({ apiKey: env.openai.apiKey });

const LANGUAGE_NAMES = { en: 'English', si: 'Sinhala', ta: 'Tamil' };

async function embedText(text) {
  const res = await client.embeddings.create({
    model: env.openai.embeddingModel,
    input: text,
  });
  return res.data[0].embedding;
}

async function embedBatch(texts) {
  const res = await client.embeddings.create({
    model: env.openai.embeddingModel,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

async function generateAnswer({ systemPrompt, userMessage, contextChunks, language, history = [] }) {
  const contextBlock = contextChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    // Recent turns of this conversation (excluding the current message,
    // which is added below) — so a vague follow-up like "what should I do
    // now?" is understood in context, not answered as a cold, standalone
    // question with no idea what "now" refers to.
    ...history.map((h) => ({ role: h.role, content: h.content })),
    {
      role: 'user',
      content:
        `Respond in language code: ${language}.\n\n` +
        `Context from R2L knowledge base (use only this to answer; if it does not contain the answer, say so and offer human handoff):\n${contextBlock}\n\n` +
        `User question: ${userMessage}`,
    },
  ];

  const completion = await client.chat.completions.create({
    model: env.openai.chatModel,
    messages,
    temperature: 0.3,
  });

  return completion.choices[0].message.content;
}

async function detectLanguage(text) {
  if (/[\u0D80-\u0DFF]/.test(text)) return 'si';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';

  const completion = await client.chat.completions.create({
    model: env.openai.chatModel,
    messages: [
      {
        role: 'system',
        content: "Detect the primary language of the user's message. Reply with ONLY one code: en, si, or ta.",
      },
      { role: 'user', content: text },
    ],
    temperature: 0,
    max_tokens: 5,
  });

  const code = completion.choices[0].message.content.trim().toLowerCase();
  return ['en', 'si', 'ta'].includes(code) ? code : 'en';
}

/** Generic translation, used both for query-bridging into the English KB and
 * for localizing onboarding/triage prompts into the user's chosen language. */
async function translateText(text, targetLanguageCode) {
  const targetName = LANGUAGE_NAMES[targetLanguageCode] || 'English';

  const completion = await client.chat.completions.create({
    model: env.openai.chatModel,
    messages: [
      {
        role: 'system',
        content:
          `Translate the following text into ${targetName}. Preserve the full meaning and any ` +
          'specific terms (legal, medical, official names). Reply with ONLY the translated text, nothing else.',
      },
      { role: 'user', content: text },
    ],
    temperature: 0,
  });

  return completion.choices[0].message.content.trim();
}

async function translateToEnglish(text, sourceLanguage) {
  if (sourceLanguage === 'en') return text;
  return translateText(text, 'en');
}

module.exports = {
  embedText,
  embedBatch,
  generateAnswer,
  detectLanguage,
  translateText,
  translateToEnglish,
};
