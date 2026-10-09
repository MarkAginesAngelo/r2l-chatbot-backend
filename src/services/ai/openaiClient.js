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

const STYLE_NOTES = {
  si:
    'Write natural, correct, formal-but-plain written Sinhala (සිංහල) as used in Sri Lankan government and ' +
    'legal-aid notices. Do not transliterate English words letter by letter when a proper Sinhala word exists. ' +
    'Keep Act and Article numbers, years, phone numbers, URLs, email addresses and organisation abbreviations ' +
    '(R2L, HRCSL, IGP, JMO, LAC, CID, CERT) exactly as written.',
  ta:
    'Write natural, correct, formal-but-plain written Tamil (தமிழ்) as used in Sri Lankan government and ' +
    'legal-aid notices. Keep Act and Article numbers, years, phone numbers, URLs, email addresses and ' +
    'organisation abbreviations (R2L, HRCSL, IGP, JMO, LAC, CID, CERT) exactly as written.',
};

/** Generic translation, used both for query-bridging into the English KB and
 * for localizing onboarding/triage prompts into the user's chosen language. */
async function translateText(text, targetLanguageCode) {
  const targetName = LANGUAGE_NAMES[targetLanguageCode] || 'English';
  const styleNote = STYLE_NOTES[targetLanguageCode] ? ` ${STYLE_NOTES[targetLanguageCode]}` : '';

  const completion = await client.chat.completions.create({
    model: env.openai.chatModel,
    messages: [
      {
        role: 'system',
        content:
          `Translate the following text into ${targetName}. Preserve the full meaning and any ` +
          `specific terms (legal, medical, official names).${styleNote} ` +
          'Keep the original line breaks. Reply with ONLY the translated text, nothing else.',
      },
      { role: 'user', content: text },
    ],
    temperature: 0,
  });

  return completion.choices[0].message.content.trim();
}

/**
 * Translates a whole guidance document for display to a person in distress.
 * Stricter than translateText: it also drops the document's internal header
 * line and "User Situation" label (staff-facing scaffolding), and lays the
 * result out as short paragraphs separated by blank lines so the channel can
 * send it paragraph by paragraph. Uses OPENAI_TRANSLATION_MODEL.
 */
async function translateDocument(text, targetLanguageCode) {
  const targetName = LANGUAGE_NAMES[targetLanguageCode] || 'English';
  const styleNote = STYLE_NOTES[targetLanguageCode] ? ` ${STYLE_NOTES[targetLanguageCode]}` : '';

  const completion = await client.chat.completions.create({
    model: env.openai.translationModel,
    messages: [
      {
        role: 'system',
        content:
          `You prepare human-rights first-aid guidance for people in Sri Lanka, in ${targetName}. ` +
          `Translate the document into ${targetName}, keeping every instruction, legal reference, name and ` +
          `contact detail accurate.${styleNote}\n` +
          'Rules:\n' +
          '- Remove the document\'s internal header line (for example "R2L Digital Triage System — Knowledge ' +
          'Base Type: ...") and any "User Situation" label line. Never output them.\n' +
          '- Do not add introductions, summaries, or commentary.\n' +
          '- Put each distinct idea (the immediate advice, the legal basis, what to do now, the contacts) in its ' +
          'own short paragraph, with a blank line between paragraphs. Put each contact (name and number) on its ' +
          'own line inside the contacts paragraph.\n' +
          'Reply with ONLY the translated document.',
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

/**
 * Decides which R2L scenario a person's latest message is about, looking at
 * the recent conversation too. `catalog` is [{ key, label, category }].
 * Returns { scenario: <key>|null, confidence: 0-1 }, or null on any failure
 * (the caller then simply keeps the current scenario).
 */
async function classifyCase({ message, history = [], catalog, currentScenario }) {
  try {
    const list = catalog.map((c) => `${c.key} | ${c.category} | ${c.label}`).join('\n');
    const recent = history
      .slice(-4)
      .map((h) => `${h.role === 'user' ? 'Person' : 'Assistant'}: ${String(h.content).slice(0, 300)}`)
      .join('\n');
    const completion = await client.chat.completions.create({
      model: env.openai.chatModel,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You route messages sent to a Sri Lankan human-rights NGO helpline. Pick the ONE scenario from the list ' +
            'that best matches what the person is asking about RIGHT NOW (use earlier turns only for context). ' +
            'The person may change topic part-way through a chat — follow the new topic. ' +
            'If they are still on the current scenario, return its key. If the message is a greeting, thanks, or ' +
            'does not clearly fit any scenario, return null. ' +
            'Reply with JSON only: {"scenario": "<key or null>", "confidence": <0 to 1>}.\n\n' +
            `Scenarios (key | category | description):\n${list}`,
        },
        {
          role: 'user',
          content: `Current scenario: ${currentScenario || 'none'}\n\nRecent chat:\n${recent || '(none)'}\n\nLatest message: ${message}`,
        },
      ],
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    return { scenario: parsed.scenario || null, confidence: Number(parsed.confidence) || 0 };
  } catch (err) {
    return null;
  }
}

module.exports = {
  classifyCase,
  embedText,
  embedBatch,
  generateAnswer,
  detectLanguage,
  translateText,
  translateDocument,
  translateToEnglish,
};
