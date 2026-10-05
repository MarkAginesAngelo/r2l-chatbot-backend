function createOpenAiMock() {
  return {
    embedText: jest.fn().mockResolvedValue(new Array(8).fill(0)),
    embedBatch: jest.fn().mockResolvedValue([new Array(8).fill(0)]),
    detectLanguage: jest.fn().mockResolvedValue('en'),
    // Tagged rather than a real translation, so tests can assert localization
    // happened (e.g. a Sinhala reply looks like "[si] <english text>")
    // without depending on a live OpenAI call.
    translateText: jest.fn(async (text, targetLang) => (targetLang === 'en' ? text : `[${targetLang}] ${text}`)),
    translateDocument: jest.fn(async (text, targetLang) => (targetLang === 'en' ? text : `[${targetLang}] ${text}`)),
    translateToEnglish: jest.fn(async (text, sourceLang) => (sourceLang === 'en' ? text : `[en] ${text}`)),
    generateAnswer: jest.fn().mockResolvedValue('MOCKED GROUNDED ANSWER'),
  };
}

module.exports = { createOpenAiMock };
