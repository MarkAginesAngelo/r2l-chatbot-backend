const OpenAI = require('openai');
const env = require('../../config/env');

const client = new OpenAI({ apiKey: env.openai.apiKey });

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

async function generateAnswer({ systemPrompt, userMessage, contextChunks, language }) {
  const contextBlock = contextChunks
    .map((c, i) => `[${i + 1}] ${c.content}`)
    .join('\n\n');

  const messages = [
    { role: 'system', content: systemPrompt },
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
  // Lightweight heuristic first; falls back to LLM classification.
  if (/[\u0D80-\u0DFF]/.test(text)) return 'si'; // Sinhala block
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta'; // Tamil block

  const completion = await client.chat.completions.create({
    model: env.openai.chatModel,
    messages: [
      {
        role: 'system',
        content:
          "Detect the primary language of the user's message. Reply with ONLY one code: en, si, or ta.",
      },
      { role: 'user', content: text },
    ],
    temperature: 0,
    max_tokens: 5,
  });

  const code = completion.choices[0].message.content.trim().toLowerCase();
  return ['en', 'si', 'ta'].includes(code) ? code : 'en';
}

module.exports = { embedText, embedBatch, generateAnswer, detectLanguage };
