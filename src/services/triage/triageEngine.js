const { resolveLanguageSelection, resolveCategorySelection, LANGUAGES, CATEGORIES } = require('./categories');
const {
  GREETING_MESSAGE,
  buildCategoryMenuMessage,
  buildCategoryAckMessage,
  buildEmergencyMessage,
  buildScenarioMenuMessage,
  buildDescribeSituationMessage,
  buildScenarioNotAvailableMessage,
} = require('./messages');
const { getQuickActionsForCategory } = require('./quickActions');
const { getScenariosForCategory, resolveScenarioSelection, OTHER_OPTION_LABEL } = require('./scenarios');
const { getScenarioDocumentContent } = require('./scenarioLookup');
const { translateText } = require('../ai/openaiClient');

/**
 * Advances a conversation through its onboarding stage.
 *
 * Returns one of:
 *  - null                                    — stage is 'in_chat'; run the
 *                                               normal RAG pipeline as-is.
 *  - { reply, newStage, ... }                — send `reply` directly, no
 *                                               RAG this turn.
 *  - { newStage, newCategory, fallThrough: true } — no canned reply;
 *                                               persist the stage/category
 *                                               change, then run the normal
 *                                               RAG pipeline on the user's
 *                                               ORIGINAL message text (used
 *                                               when someone types a real
 *                                               question instead of picking
 *                                               a menu option — their
 *                                               message shouldn't be
 *                                               swallowed by a re-prompt).
 */
async function handleTriageStage(conversation, rawMessage) {
  const stage = conversation.stage || 'greeting';

  if (stage === 'greeting') {
    return {
      reply: GREETING_MESSAGE,
      newStage: 'awaiting_language',
      options: LANGUAGES.map((l) => ({ id: l.id, code: l.code, label: l.label, shortLabel: l.shortLabel })),
    };
  }

  if (stage === 'awaiting_language') {
    const lang = resolveLanguageSelection(rawMessage);
    if (!lang) {
      return {
        reply: GREETING_MESSAGE,
        newStage: 'awaiting_language',
        options: LANGUAGES.map((l) => ({ id: l.id, code: l.code, label: l.label, shortLabel: l.shortLabel })),
      };
    }
    const menu = await buildCategoryMenuMessage(lang);
    return {
      reply: menu,
      newStage: 'awaiting_category',
      newLanguage: lang,
      options: CATEGORIES.map((c) => ({ id: c.id, key: c.key, label: c.label, shortLabel: c.shortLabel })),
    };
  }

  if (stage === 'awaiting_category') {
    const language = conversation.language || 'en';
    const category = resolveCategorySelection(rawMessage);

    if (!category) {
      const menu = await buildCategoryMenuMessage(language);
      return {
        reply: menu,
        newStage: 'awaiting_category',
        options: CATEGORIES.map((c) => ({ id: c.id, key: c.key, label: c.label, shortLabel: c.shortLabel })),
      };
    }

    if (category.key === 'danger') {
      const message = await buildEmergencyMessage(language);
      return {
        reply: message,
        newStage: 'in_chat',
        newCategory: 'danger',
        isEmergency: true,
      };
    }

    const scenarios = getScenariosForCategory(category.key);

    if (scenarios.length === 0) {
      // Defensive fallback for a category with no scenario menu defined —
      // behaves like the pre-scenario-menu flow.
      const ack = await buildCategoryAckMessage(category, language);
      const quickActions = getQuickActionsForCategory(category.key);
      return {
        reply: ack,
        newStage: 'in_chat',
        newCategory: category.key,
        options: quickActions.length
          ? quickActions.map((a) => ({ id: a.id, key: a.id, label: a.label, shortLabel: a.shortLabel }))
          : undefined,
      };
    }

    const menu = await buildScenarioMenuMessage(category, scenarios, language);
    return {
      reply: menu,
      newStage: 'awaiting_scenario',
      newCategory: category.key,
      options: [
        ...scenarios.map((s) => ({ id: s.id, key: s.key, label: s.label, shortLabel: s.shortLabel })),
        { id: String(scenarios.length + 1), key: 'other', label: OTHER_OPTION_LABEL, shortLabel: 'Other' },
      ],
    };
  }

  if (stage === 'awaiting_scenario') {
    const language = conversation.language || 'en';
    const categoryKey = conversation.category;
    const resolved = resolveScenarioSelection(categoryKey, rawMessage);

    if (!resolved) {
      // Doesn't match a menu option — most likely the user typed their
      // actual question instead of picking a number. Don't swallow it with
      // a re-prompt: hand it straight to the normal RAG pipeline.
      return { newStage: 'in_chat', newCategory: categoryKey, fallThrough: true };
    }

    if (resolved.type === 'other') {
      const reply = await buildDescribeSituationMessage(language);
      return { reply, newStage: 'in_chat', newCategory: categoryKey };
    }

    // A specific scenario was picked — fetch its document directly (no
    // embedding search needed, we already know exactly which document
    // answers this) and hand it back as the grounded answer.
    const doc = await getScenarioDocumentContent(resolved.scenario, language);
    const category = CATEGORIES.find((c) => c.key === categoryKey);
    const quickActions = category ? getQuickActionsForCategory(category.key) : [];

    if (!doc.found) {
      const reply = await buildScenarioNotAvailableMessage(language);
      return { reply, newStage: 'in_chat', newCategory: categoryKey };
    }

    // Only translate if the fetched document isn't already in the target
    // language — once native-language documents exist (not just English
    // ones machine-translated on the fly), re-translating Sinhala into
    // Sinhala would be wasted latency and risks the model subtly
    // paraphrasing carefully-worded legal content for no reason.
    // Compared case/whitespace-insensitively — some Postgres drivers or
    // varchar handling can return language codes with incidental casing or
    // padding differences depending on environment.
    const docLang = String(doc.documentLanguage || '').trim().toLowerCase();
    const targetLang = String(language || '').trim().toLowerCase();
    const reply = docLang === targetLang ? doc.content : await translateText(doc.content, language);
    return {
      reply,
      newStage: 'in_chat',
      newCategory: categoryKey,
      // Quick-action follow-ups (Contact R2L / Legal Aid / Know Your
      // Rights) show at the END of the specific answer, not at category
      // selection — per R2L's requested flow.
      options: quickActions.length
        ? quickActions.map((a) => ({ id: a.id, key: a.id, label: a.label, shortLabel: a.shortLabel }))
        : undefined,
    };
  }

  return null; // 'in_chat' — fall through to normal RAG pipeline
}

module.exports = { handleTriageStage };
