# R2L Chatbot Backend

Backend + AI/RAG layer for the Right to Life Sri Lanka multilingual chatbot.

## Golden Rule messages + Police quick actions (from R2L's final content doc)

R2L sent a more detailed, corrected version of the Q&A content, including
Category 5 (previously missing) and updated phone numbers. Two chat-flow
changes came with it:

- **Golden Rule text now appears automatically** the moment a category is
  selected — every category's safety instruction (e.g. "do not physically
  resist," "do NOT delete the messages/photos/videos") is shown before the
  free-form acknowledgment, matching the document's "Bot Auto-Reply Prefix"
  pattern exactly. Defined per category in `src/services/triage/categories.js`.
- **Police category quick actions** — after selecting "Police Harassment,
  Assault, or Arrest," the user now also gets 3 tappable buttons (Contact
  R2L / Free Legal Aid / Know Your Rights) alongside the option to just
  describe their situation. Tapping one answers instantly from a canned,
  pre-written response — no embedding or LLM call needed. Defined in the new
  `src/services/triage/quickActions.js`; currently only Police has these
  since that's the only category with this button set in R2L's document, but
  the mechanism generalizes to any category if R2L adds more later.
- **Corrected contact numbers** throughout `messages.js`'s emergency block:
  HRCSL is now consistently 1996, CCID is 011-2381045, SL CERT hotline is
  101, plus new numbers (IGP direct line 071-8598888, R2L general support
  0772255158) that weren't in the earlier version.

### ⚠️ Knowledge base documents need replacing, not just adding to
The 5 category-level documents uploaded earlier contain the *old* phone
numbers (different HRCSL/CCID/SLBFE/DWC numbers). A new set of 25
scenario-level `.txt` files (one per specific situation, matching this
document's structure) should **replace** them:
1. `DELETE /api/documents/:id` for each of the 5 old category documents
2. `POST /api/documents` for each of the 25 new scenario files

Uploading the new files without removing the old ones will leave both in
Qdrant, and retrieval has no way to prefer the corrected numbers over the
stale ones.

### Testing the quick actions
```bash
# after greeting -> language (1) -> category (1, Police), the ack message
# now includes the Golden Rule and the response includes 3 options
curl -X POST http://localhost:4000/api/chat -H "Content-Type: application/json" \
  -d '{"message": "legal_aid", "conversationId": "<id>"}'
# -> instant canned Legal Aid Commission response, no RAG involved
```

## New: structured onboarding/triage flow (from the R2L presentation)

Every new conversation now goes through a fixed sequence before free-form
chat starts, per R2L's request:

1. **Greeting + language selection** — trilingual greeting, user picks
   English / Sinhala / Tamil (by number, word, or a tapped button on
   WhatsApp/Messenger).
2. **Category selection** — six options, translated into the chosen language:
   Police Harassment, Cybercrime, Financial/Labor, Land/Housing,
   Family/Child Welfare, or **"I am in immediate physical danger."**
3. **Guided continuation**:
   - Picking a topic category acknowledges it and scopes the next questions'
     knowledge-base search toward documents matching that category (via a
     Qdrant filter built from each document's title — no re-upload needed).
   - Picking "immediate danger" skips the knowledge base entirely and
     immediately returns R2L's emergency contact list (119, HRCSL, WIN,
     NCPA, R2L's own hotline, etc.), and flags a **priority: emergency**
     human handoff so staff see it in `/api/handoffs` and get the real-time
     `handoff:requested` Socket.io event right away.
4. After category selection, the conversation moves to `in_chat` stage and
   behaves exactly as before — free-form questions, RAG retrieval,
   cross-lingual query translation, handoff on low confidence.

Existing conversations from before this migration are **not** forced back
through onboarding — they're marked `in_chat` automatically.

### How this works per channel
- **Website** (`POST /api/chat`): the response now includes `stage` and,
  during onboarding, an `options` array (`[{id, label}]`) so a frontend can
  render real buttons instead of asking the user to type a number. Sending
  back the option's `label` text, its `id` (1-6), or any recognizable free
  text all work.
- **WhatsApp**: language selection renders as native reply buttons (max 3,
  fits perfectly); category selection renders as a native list message (up
  to 10 rows, we use 6). Tapping a button sends its id back automatically —
  no typing required.
- **Messenger**: both stages render as native quick replies.

### Testing it locally (website, via curl)
```bash
# 1. Start a conversation — get the trilingual greeting
curl -X POST http://localhost:4000/api/chat -H "Content-Type: application/json" \
  -d '{"message": "hi"}'
# -> { "reply": "Welcome...", "conversationId": "...", "stage": "awaiting_language", "options": [...] }

# 2. Pick a language (reuse the conversationId from step 1)
curl -X POST http://localhost:4000/api/chat -H "Content-Type: application/json" \
  -d '{"message": "1", "conversationId": "<id>"}'
# -> category menu, stage: "awaiting_category"

# 3. Pick a category
curl -X POST http://localhost:4000/api/chat -H "Content-Type: application/json" \
  -d '{"message": "1", "conversationId": "<id>"}'
# -> acknowledgement, stage: "in_chat", category now scopes retrieval

# 4. Ask a real question — now scoped to the police-harassment document
curl -X POST http://localhost:4000/api/chat -H "Content-Type: application/json" \
  -d '{"message": "the police assaulted me, what do I do?", "conversationId": "<id>"}'

# Or test the emergency path directly at step 3:
curl -X POST http://localhost:4000/api/chat -H "Content-Type: application/json" \
  -d '{"message": "6", "conversationId": "<id>"}'
# -> emergency contact list + a pending handoff created immediately
```

### Testing on real WhatsApp
This is the piece still owed from the last check-in — the code is built and
passes tests, but hasn't been verified against a live Meta app yet. When you
do that test, specifically confirm:
- Language selection arrives as tappable **buttons**, not a numbered list
- Category selection arrives as a **list message** (tap "Select an option" to
  see all 6 rows) — the full label should show in each row's description
- Tapping an option advances the conversation exactly like typing its number
  would

### One thing to flag to R2L
Category 5 (Family/Child Welfare) will retrieve from the general knowledge
base rather than a dedicated document, since R2L hasn't sent that content yet
(same gap flagged after the presentation). It'll still surface the emergency
contacts from the onboarding document (WIN, NCPA, Women's Bureau) since those
are already in the knowledge base — but there's no dedicated first-aid script
for this category the way there is for Police/Cyber/Financial/Land.

## Automated test coverage (backend hardening step)

`tests/chatFlow.integration.test.js` — 12 tests exercising the **full chat
pipeline** end to end: greeting → language selection → category selection →
Police's quick-action buttons → free-form RAG-grounded answers → low-
confidence handoff → the immediate-danger emergency path. Unlike the earlier
tests (validation, chunking, triage token matching), these run against a
**real in-memory Postgres** (`pg-mem`, loaded with the actual migration
files) — real SQL, real constraints, real schema — with only the genuinely
external services mocked (OpenAI, Qdrant retrieval, Socket.io).

Writing these caught a real bug, now fixed: **quick-action button taps
weren't being localized correctly.** The code was re-detecting language from
the button's raw payload (e.g. `"legal_aid"`) instead of using the
conversation's already-selected language — since a button ID has no language
signal, that detection always came back English regardless of what the user
picked. Fixed in both `chatController.js` and `messageHandler.js`: quick
actions are now checked before language detection runs, using
`conversation.language` directly.

```bash
npm test    # 34 tests total across 5 suites
```

See `tests/helpers/testDb.js` for how the in-memory Postgres is set up (and
a documented pg-mem quirk worth knowing if you extend these: it caches a
column's `DEFAULT` expression per identical SQL text rather than
re-evaluating it per row, which only matters for the one multi-row seed
insert in the schema — every query the application itself issues already
supplies its own id explicitly, so this never surfaces outside that one
test-setup step).


```bash
cd r2l-chatbot-backend
cp .env.example .env        # fill in OPENAI_API_KEY at minimum
docker compose up -d postgres qdrant redis
npm install

# run both migrations, in order
docker exec -i r2l_postgres psql -U r2l_user -d r2l_chatbot < src/db/migrations/001_init.sql
docker exec -i r2l_postgres psql -U r2l_user -d r2l_chatbot < src/db/migrations/002_triage_flow.sql

node scripts/seedAdmin.js "Your Name" admin@r2l.org "ChooseAStrongPassword123!"

npm run dev        # API
npm run worker      # separate terminal — processes document uploads
```

## Running tests
```bash
npm test
```
18 tests covering: chunking, input validation, health/404 routing, and the
new triage token resolution (language/category matching for both typed text
and WhatsApp/Messenger interactive reply ids).

## Architecture recap
- **Website / WhatsApp / Messenger** all route through the same RAG pipeline
  and the same triage engine — one central intelligence layer, per the
  original spec.
- **PostgreSQL**: admin_users/roles, clients, leads, conversations (now with
  `stage`/`category`), messages, human_handoffs, documents, document_chunks,
  analytics_events, settings.
- **Qdrant**: vector search, now filterable by category via document title
  matching.
- **Redis + BullMQ**: document ingestion runs in a separate worker process.
- **Socket.io**: real-time staff notifications (`handoff:requested`,
  `handoff:accepted`, `conversation:message`), now including
  `priority: emergency` for the immediate-danger path.

## Still pending
- Real WhatsApp/Messenger verification against a live Meta Developer app —
  webhook delivery confirmed via ngrok; outbound replies still being
  debugged (see the phone-number-ID / recipient-allowlist troubleshooting in
  this session's history if picking this back up).
- Replacing the old 5 category KB documents with the new 25 scenario-level
  ones (see the warning above).
- Category 7 (FAQ) and the "Human Defender" UX section — still not received
  from R2L.
- Frontend dashboard (partner's side) and **actually provisioning** the VPS —
  `deploy/` now has everything needed (Caddy config, production compose
  overlay, backup scripts, full walkthrough in `deploy/DEPLOYMENT.md`), but
  no server has been rented yet.
