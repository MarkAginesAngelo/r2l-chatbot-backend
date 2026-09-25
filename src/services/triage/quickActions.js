// Some categories offer a small set of canned "quick action" replies the user
// can tap right after selecting the category, in addition to just describing
// their situation in free text. Currently only Police has this in R2L's
// document (the other categories go straight from Golden Rule to free-form
// scenario matching), but this is written to extend to other categories if
// R2L adds equivalent buttons later.
const QUICK_ACTIONS = {
  police: [
    {
      id: 'contact_r2l',
      label: 'Need Urgent Help? Contact R2L',
      shortLabel: 'Contact R2L',
      tokens: ['contact_r2l', 'contact r2l', 'need urgent help', 'urgent help'],
      response:
        'The Right to Life (R2L) Human Rights Centre can connect you to local Human Rights First Aid ' +
        'Centres (HRFAC) to document your case and mobilize defenders.\n' +
        'Urgent Hotline: 011-266 9100\n' +
        'General support: 0772255158\n' +
        'Website: right2lifelanka.org\n' +
        'A human defender will respond to you shortly. Please stay safe.',
    },
    {
      id: 'legal_aid',
      label: 'Free Legal Aid (LAC)',
      shortLabel: 'Legal Aid (LAC)',
      tokens: ['legal_aid', 'legal aid', 'lac', 'free legal aid'],
      response:
        'The Legal Aid Commission of Sri Lanka (LAC) provides free legal advice and representation for ' +
        'citizens who cannot afford a private lawyer.\n' +
        '24/7 Hotline: 070-365 5111\n' +
        'General Line: 011-533 5329\n' +
        'Website: legalaid.gov.lk\n' +
        'Email: legalaidcommission1978@gmail.com',
    },
    {
      id: 'know_rights',
      label: 'Know Your Rights: The Law on Arrests',
      shortLabel: 'Know Your Rights',
      tokens: ['know_rights', 'know your rights', 'law on arrests', 'my rights'],
      response:
        'Here is the legal framework protecting you during an arrest in Sri Lanka:\n\n' +
        '1. The Constitution of Sri Lanka (Article 13): "No person shall be arrested except according to ' +
        'procedure established by law. Any person arrested shall be informed of the reason for his arrest."\n\n' +
        '2. The Code of Criminal Procedure Act (No. 15 of 1979): even without a warrant, for a serious ' +
        'crime, officers must still communicate the reason for arrest. Under Article 13(2), an arrested ' +
        'person must be brought before a Magistrate within 24 hours.\n\n' +
        'Read more: right2lifelanka.org/research-and-books',
    },
  ],
};

function resolveQuickAction(categoryKey, rawMessage) {
  const actions = QUICK_ACTIONS[categoryKey];
  if (!actions) return null;

  const normalized = String(rawMessage || '').trim().toLowerCase();
  const exact = actions.find((a) => a.tokens.some((t) => t.toLowerCase() === normalized));
  if (exact) return exact;
  return actions.find((a) => a.tokens.some((t) => t.length >= 6 && normalized.includes(t.toLowerCase()))) || null;
}

function getQuickActionsForCategory(categoryKey) {
  return QUICK_ACTIONS[categoryKey] || [];
}

module.exports = { QUICK_ACTIONS, resolveQuickAction, getQuickActionsForCategory };
