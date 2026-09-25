const { resolveLanguageSelection, resolveCategorySelection } = require('../src/services/triage/categories');
const { resolveQuickAction } = require('../src/services/triage/quickActions');

describe('resolveLanguageSelection', () => {
  it('resolves numeric selection', () => {
    expect(resolveLanguageSelection('1')).toBe('en');
    expect(resolveLanguageSelection('2')).toBe('si');
    expect(resolveLanguageSelection('3')).toBe('ta');
  });

  it('resolves WhatsApp/Messenger interactive id tokens', () => {
    expect(resolveLanguageSelection('lang_en')).toBe('en');
    expect(resolveLanguageSelection('lang_si')).toBe('si');
    expect(resolveLanguageSelection('lang_ta')).toBe('ta');
  });

  it('resolves free text', () => {
    expect(resolveLanguageSelection('English')).toBe('en');
    expect(resolveLanguageSelection('sinhala')).toBe('si');
  });

  it('returns null for gibberish', () => {
    expect(resolveLanguageSelection('asdkjfh')).toBeNull();
  });
});

describe('resolveCategorySelection', () => {
  it('resolves numeric selection 1-6', () => {
    expect(resolveCategorySelection('1').key).toBe('police');
    expect(resolveCategorySelection('6').key).toBe('danger');
  });

  it('resolves WhatsApp/Messenger interactive id tokens', () => {
    expect(resolveCategorySelection('cat_police').key).toBe('police');
    expect(resolveCategorySelection('cat_danger').key).toBe('danger');
  });

  it('resolves free text mentioning the topic', () => {
    expect(resolveCategorySelection('I need help with police harassment').key).toBe('police');
    expect(resolveCategorySelection('emergency, help now').key).toBe('danger');
  });

  it('returns null for unrelated text', () => {
    expect(resolveCategorySelection('what time is it')).toBeNull();
  });
});

describe('resolveQuickAction', () => {
  it('resolves the Police category quick actions by id token', () => {
    expect(resolveQuickAction('police', 'contact_r2l').id).toBe('contact_r2l');
    expect(resolveQuickAction('police', 'legal_aid').id).toBe('legal_aid');
    expect(resolveQuickAction('police', 'know_rights').id).toBe('know_rights');
  });

  it('resolves by free text matching the button label', () => {
    expect(resolveQuickAction('police', 'I need legal aid').id).toBe('legal_aid');
  });

  it('returns null for categories with no quick actions defined', () => {
    expect(resolveQuickAction('cyber', 'contact_r2l')).toBeNull();
  });

  it('returns null for unrelated text', () => {
    expect(resolveQuickAction('police', 'the weather is nice today')).toBeNull();
  });
});

const { resolveScenarioSelection, getScenariosForCategory } = require('../src/services/triage/scenarios');

describe('resolveScenarioSelection', () => {
  it('resolves a numeric selection within a category', () => {
    const result = resolveScenarioSelection('police', '1');
    expect(result.type).toBe('scenario');
    expect(result.scenario.key).toBe('police-torture');
  });

  it('resolves the trailing "Other" option by its number', () => {
    const count = getScenariosForCategory('police').length;
    const result = resolveScenarioSelection('police', String(count + 1));
    expect(result).toEqual({ type: 'other' });
  });

  it('resolves "other" by free text too', () => {
    expect(resolveScenarioSelection('police', 'other')).toEqual({ type: 'other' });
  });

  it('resolves free text matching a scenario keyword', () => {
    const result = resolveScenarioSelection('cyber', 'someone is blackmailing me with photos');
    expect(result.type).toBe('scenario');
    expect(result.scenario.key).toBe('cyber-ncii-sextortion');
  });

  it('returns null for text matching no scenario, so callers fall through to RAG', () => {
    expect(resolveScenarioSelection('police', 'what time does the office open')).toBeNull();
  });

  it('has a scenario list defined for every non-danger category', () => {
    ['police', 'cyber', 'financial', 'land', 'family'].forEach((key) => {
      expect(getScenariosForCategory(key).length).toBeGreaterThan(0);
    });
  });
});
