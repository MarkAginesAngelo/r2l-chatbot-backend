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
const { getScenariosForCategory, resolveScenarioSelection, OTHER_OPTION_LABEL, OTHER_OPTION_I18N } = require('./scenarios');
const { getScenarioDocumentContent } = require('./scenarioLookup');
const { translateText, translateDocument } = require('../ai/openaiClient');
const { stripBoilerplate } = require('./replyFormatter');
const { getScenarioParts } = require('./localContent');

/**
 * Both `label` (the full sentence — what the website widget renders,
 * since it has no character limit) and `shortLabel` (the abbreviated
 * "1. Police / Arrest" form — what Messenger/WhatsApp buttons render,
 * capped at 20 chars by Meta) are hardcoded English in categories.js /
 * scenarios.js / quickActions.js. Once a non-English language is picked,
 * BOTH need translating, or a Sinhala/Tamil user keeps seeing English
 * options under an already-translated message — on the website widget
 * specifically, translating only `shortLabel` and leaving `label` alone
 * (an earlier version of this function) meant the website kept showing
 * full English sentences, since that's the field it actually displays.
 * `shortLabel`'s leading "N. " index (if any) is kept as-is through
 * translation so numbering stays stable and the typed-number fallback
 * (resolveCategorySelection/resolveScenarioSelection, which match on the
 * token "1"/"2"/etc regardless of language) is unaffected; `label` has no
 * such prefix, so it's translated as a plain sentence. Skipped entirely
 * for English and for empty option lists.
 */
async function translateOptionLabels(options, language) {
  if (!options?.length) return options;
  // `i18n` is internal (hand-written per-language wording) — never sent to clients.
  if (!language || language === 'en') return options.map(({ i18n, ...o }) => o);
  return Promise.all(
    options.map(async ({ i18n, ...o }) => {
      const shortSource = String(o.shortLabel || o.label || '');
      const match = shortSource.match(/^(\d+\.\s*)?([\s\S]*)$/);
      const prefix = match?.[1] || '';
      const shortRest = match?.[2] || '';

      // Hand-written wording (currently Sinhala) wins over machine
      // translation — it's what R2L reviewed and approved.
      const fixed = i18n?.[language];
      if (fixed?.label) {
        return {
          ...o,
          label: fixed.label,
          shortLabel: fixed.shortLabel || `${prefix}${fixed.label}`,
        };
      }

      const [translatedShort, translatedLabel] = await Promise.all([
        shortRest.trim() ? translateText(shortRest, language) : null,
        o.label?.trim() ? translateText(o.label, language) : null,
      ]);

      return {
        ...o,
        ...(translatedShort !== null && { shortLabel: `${prefix}${translatedShort}` }),
        ...(translatedLabel !== null && { label: translatedLabel }),
      };
    })
  );
}

// --- Vertical menus (categories & scenarios) ------------------------------
//
// R2L wants the full sentence for each category/scenario option VISIBLE,
// plus a vertical button to pick it, on Messenger. Meta caps any real
// button's own text at 20 characters, and the one template that allows
// more (List Template, up to 80 chars) failed live with an opaque Meta-
// side error and was abandoned (see messengerClient.js) — so the full
// sentence can't live ON a button. Instead: the full numbered sentence
// list lives in the plain message TEXT (see buildCategoryMenuMessage /
// buildScenarioMenuMessage in messages.js — no character limit there),
// and the buttons are just the numbers ("1", "2", "3"...), read from each
// item's `number` field by messengerWebhookController.js. Tapping "2"
// lines up with "2." in the text above it.
//
// `menuStyle: 'list'` tells messengerWebhookController.js this menu may
// have more than 3 options and needs paginating (2 numbers + a "More
// options" button per page, to stay inside Meta's hard 3-button cap). This
// function stays channel-agnostic — the website widget has no such limit
// and just renders every option (using the full, translated `label`) as
// its own button — it's entirely up to the channel controller whether/how
// to lay these out or paginate.
//
// A `list_page_<N>` tap (the "More options" button) isn't a real
// selection, so it's recognized below and just re-shows this same menu
// rather than being mistaken for a real answer or a free-typed question.
const LIST_PAGE_TOKEN = /^list_page_\d+$/;

function isListPageToken(rawMessage) {
  return LIST_PAGE_TOKEN.test(String(rawMessage || ''));
}

async function buildFullSentenceOptions(items, language) {
  return { options: await translateOptionLabels(items, language), menuStyle: 'list' };
}

/**
 * Advances a conversation through its onboarding stage.
 *
 * Returns one of:
 *  - null                                    — stage is 'in_chat'; run the
 *                                               normal RAG pipeline as-is.
 *  - { reply, newStage, ... }                — send `reply` directly, no
 *                                               RAG this turn.
 *  - { newStage, newCategory, newScenario, fallThrough: true } — no canned
 *                                               reply; persist the
 *                                               stage/category/scenario
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
      newScenario: null,
      options: LANGUAGES.map((l) => ({ id: l.id, code: l.code, label: l.label, shortLabel: l.shortLabel })),
    };
  }

  if (stage === 'awaiting_language') {
    const lang = resolveLanguageSelection(rawMessage);
    if (!lang) {
      return {
        reply: GREETING_MESSAGE,
        newStage: 'awaiting_language',
        newScenario: null,
        options: LANGUAGES.map((l) => ({ id: l.id, code: l.code, label: l.label, shortLabel: l.shortLabel })),
      };
    }
    const menu = await buildCategoryMenuMessage(lang);
    const categoryItems = CATEGORIES.map((c) => ({ id: c.key, key: c.key, label: c.label, shortLabel: c.shortLabel, number: c.id, i18n: c.i18n }));
    return {
      reply: menu,
      newStage: 'awaiting_category',
      newLanguage: lang,
      newScenario: null,
      ...(await buildFullSentenceOptions(categoryItems, lang)),
    };
  }

  if (stage === 'awaiting_category') {
    const language = conversation.language || 'en';
    const categoryItems = CATEGORIES.map((c) => ({ id: c.key, key: c.key, label: c.label, shortLabel: c.shortLabel, number: c.id, i18n: c.i18n }));

    // A "More options" tap on a paginated Messenger List Template — not a
    // real selection, just re-show this same menu (see isListPageToken).
    if (isListPageToken(rawMessage)) {
      const menu = await buildCategoryMenuMessage(language);
      return {
        reply: menu,
        newStage: 'awaiting_category',
        newScenario: null,
        ...(await buildFullSentenceOptions(categoryItems, language)),
      };
    }

    const category = resolveCategorySelection(rawMessage);

    if (!category) {
      const menu = await buildCategoryMenuMessage(language);
      return {
        reply: menu,
        newStage: 'awaiting_category',
        newScenario: null,
        ...(await buildFullSentenceOptions(categoryItems, language)),
      };
    }

    if (category.key === 'danger') {
      const message = await buildEmergencyMessage(language);
      return {
        reply: message,
        newStage: 'in_chat',
        newCategory: 'danger',
        newScenario: null,
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
        newScenario: null,
        options: quickActions.length
          ? await translateOptionLabels(
              quickActions.map((a) => ({ id: a.id, key: a.id, label: a.label, shortLabel: a.shortLabel, i18n: a.i18n })),
              language
            )
          : undefined,
      };
    }

    const menu = await buildScenarioMenuMessage(category, scenarios, language);
    const scenarioItems = [
      ...scenarios.map((s) => ({ id: s.key, key: s.key, label: s.label, shortLabel: s.shortLabel, number: s.id, i18n: s.i18n })),
      { id: 'other', key: 'other', label: OTHER_OPTION_LABEL, shortLabel: 'Other', number: String(scenarios.length + 1), i18n: OTHER_OPTION_I18N },
    ];
    return {
      reply: menu,
      newStage: 'awaiting_scenario',
      newCategory: category.key,
      newScenario: null,
      ...(await buildFullSentenceOptions(scenarioItems, language)),
    };
  }

  if (stage === 'awaiting_scenario') {
    const language = conversation.language || 'en';
    const categoryKey = conversation.category;

    // A "More options" tap on a paginated Messenger List Template — not a
    // real selection, and NOT a free-typed question either (previously this
    // stage's fallthrough-to-RAG path would have swallowed it as gibberish).
    if (isListPageToken(rawMessage)) {
      const category = CATEGORIES.find((c) => c.key === categoryKey);
      const scenarios = getScenariosForCategory(categoryKey);
      const menu = category ? await buildScenarioMenuMessage(category, scenarios, language) : '';
      const scenarioItems = [
        ...scenarios.map((s) => ({ id: s.key, key: s.key, label: s.label, shortLabel: s.shortLabel, number: s.id, i18n: s.i18n })),
        { id: 'other', key: 'other', label: OTHER_OPTION_LABEL, shortLabel: 'Other', number: String(scenarios.length + 1), i18n: OTHER_OPTION_I18N },
      ];
      return {
        reply: menu,
        newStage: 'awaiting_scenario',
        newCategory: categoryKey,
        newScenario: null,
        ...(await buildFullSentenceOptions(scenarioItems, language)),
      };
    }

    const resolved = resolveScenarioSelection(categoryKey, rawMessage);

    if (!resolved) {
      // Doesn't match a menu option — most likely the user typed their
      // actual question instead of picking a number. Don't swallow it with
      // a re-prompt: hand it straight to the normal RAG pipeline. No single
      // scenario is "active" here, so retrieval should stay scoped to the
      // whole category rather than whatever scenario was previously picked.
      return { newStage: 'in_chat', newCategory: categoryKey, newScenario: null, fallThrough: true };
    }

    if (resolved.type === 'other') {
      const reply = await buildDescribeSituationMessage(language);
      return { reply, newStage: 'in_chat', newCategory: categoryKey, newScenario: null };
    }

    // A specific scenario was picked — fetch its document directly (no
    // embedding search needed, we already know exactly which document
    // answers this) and hand it back as the grounded answer.
    const category = CATEGORIES.find((c) => c.key === categoryKey);
    const quickActions = category ? getQuickActionsForCategory(category.key) : [];

    // Curated, human-reviewed text for this language wins over everything
    // else (see localContent.js) — shown exactly as written, paragraph by
    // paragraph, with no database lookup or machine translation.
    const curatedParts = getScenarioParts(resolved.scenario.key, language);
    if (curatedParts) {
      return {
        reply: curatedParts.join('\n\n'),
        newStage: 'in_chat',
        newCategory: categoryKey,
        newScenario: resolved.scenario.key,
        options: quickActions.length
          ? await translateOptionLabels(
              quickActions.map((a) => ({ id: a.id, key: a.id, label: a.label, shortLabel: a.shortLabel, i18n: a.i18n })),
              language
            )
          : undefined,
      };
    }

    const doc = await getScenarioDocumentContent(resolved.scenario, language);
    if (!doc.found) {
      const reply = await buildScenarioNotAvailableMessage(language);
      // Still remember which scenario was picked even though its document
      // isn't uploaded yet — once R2L adds it, follow-ups are already
      // scoped correctly instead of defaulting back to the whole category.
      return { reply, newStage: 'in_chat', newCategory: categoryKey, newScenario: resolved.scenario.key };
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
    const reply =
      docLang === targetLang ? stripBoilerplate(doc.content) : await translateDocument(doc.content, language);
    return {
      reply,
      newStage: 'in_chat',
      newCategory: categoryKey,
      // Remembered so a follow-up question in this same chat stays scoped
      // to THIS scenario's document (and its contacts/referrals) instead of
      // the whole category — see getQdrantFilterForScenario / messageHandler.js.
      newScenario: resolved.scenario.key,
      // Quick-action follow-ups (Contact R2L / Legal Aid / Know Your
      // Rights) show at the END of the specific answer, not at category
      // selection — per R2L's requested flow.
      options: quickActions.length
        ? await translateOptionLabels(
            quickActions.map((a) => ({ id: a.id, key: a.id, label: a.label, shortLabel: a.shortLabel, i18n: a.i18n })),
            language
          )
        : undefined,
    };
  }

  return null; // 'in_chat' — fall through to normal RAG pipeline
}

module.exports = { handleTriageStage };
