// Shows, for every scenario, whether an English knowledge-base document is
// found for it — and lists the documents that exist, so a mismatch between a
// document's title and the scenario's keywords is easy to spot.
//
//   docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml exec -T api node scripts/checkScenarioDocs.js
require('dotenv').config();
const db = require('../src/config/db');
const { SCENARIOS_BY_CATEGORY } = require('../src/services/triage/scenarios');
const { getScenarioDocumentContent } = require('../src/services/triage/scenarioLookup');

(async () => {
  const { rows: docs } = await db.query(
    `SELECT title, language, status, (SELECT count(*) FROM document_chunks c WHERE c.document_id = d.id) AS chunks
     FROM documents d ORDER BY title`
  );
  console.log(`\nDocuments in the knowledge base (${docs.length}):`);
  for (const d of docs) console.log(`  [${d.language}/${d.status}/${d.chunks} chunks] ${d.title}`);

  console.log('\nScenario -> English document:');
  let missing = 0;
  for (const [category, list] of Object.entries(SCENARIOS_BY_CATEGORY)) {
    for (const s of list) {
      const r = await getScenarioDocumentContent(s, 'en');
      if (!r.found) missing += 1;
      console.log(
        `  ${r.found ? 'OK     ' : 'MISSING'} ${category}/${s.key}` +
          (r.found ? `  <- "${r.title}"` : `  (title must contain one of: ${s.titleKeywords.join(' | ')})`)
      );
    }
  }
  console.log(`\n${missing} scenario(s) have no matching English document.\n`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
