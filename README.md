# R2L Chatbot Backend — Foundation (Week 1)

Backend + AI/RAG layer for the Right to Life Sri Lanka multilingual chatbot.
This is the piece you (backend/AI/integration lead) own; your partner's Next.js
frontend talks to this via the `/api` contract below.

## What's already built here

- Express app skeleton with security middleware, rate limiting, centralized error handling
- PostgreSQL schema covering every entity from the project overview (admin_users, roles,
  clients, leads, conversations, messages, human_handoffs, services, documents,
  document_chunks, analytics_events, settings)
- JWT auth (login/refresh) + role-based `authorize()` middleware (super_admin/admin/staff)
- Document upload → text extraction (PDF/TXT; DOCX stubbed, see below) → chunking →
  OpenAI embeddings → Qdrant storage
- `POST /api/chat` — the full RAG pipeline: language detection → conversation/message
  persistence → Qdrant retrieval → grounded OpenAI answer → automatic human-handoff
  flagging on low-confidence answers → analytics event logging
- Docker Compose for Postgres + Qdrant (+ the API itself)

## What's intentionally stubbed (by design, not scope-cut)

These are called out explicitly in code comments so nothing is silently missing:

- **DOCX extraction** — `ingestService.js` throws with a clear message; add `mammoth`
  and implement when you get real R2L `.docx` files (Week 2).
- **WhatsApp / Messenger webhooks** — architecture is decided (see project overview),
  routes not yet wired — that's Week 4 per the plan.
- **Conversations / Clients / Leads / Analytics CRUD routes** — DB schema is ready;
  controllers come in Week 3 once the core chat pipeline is proven.
- **Background job queue for ingestion** — currently fire-and-forget async; swap in
  BullMQ + Redis before production so large document batches don't block the process.

## Day 1 setup — do this now

```bash
# 1. Initialize git (if not already)
cd r2l-chatbot-backend
git init
git add .
git commit -m "chore: project scaffold — Week 1 foundation"
# create the GitHub repo, then:
git remote add origin <your-repo-url>
git push -u origin main

# 2. Copy env template and fill in real values
cp .env.example .env
# set OPENAI_API_KEY at minimum to get the chat pipeline running

# 3. Start Postgres + Qdrant
docker compose up -d postgres qdrant

# 4. Install dependencies
npm install

# 5. Run the schema migration
docker exec -i r2l_postgres psql -U r2l_user -d r2l_chatbot < src/db/migrations/001_init.sql

# 6. Create your first admin login
node scripts/seedAdmin.js "Your Name" admin@r2l.org "ChooseAStrongPassword123!"

# 7. Run the API
npm run dev
# -> http://localhost:4000/api/health should return { status: "ok" }
```

## API contract so far

### `POST /api/auth/login`
```json
{ "email": "admin@r2l.org", "password": "..." }
```
Returns `{ accessToken, refreshToken, user }`.

### `POST /api/chat`  (public — no auth, this is what the website widget calls)
```json
{ "message": "How can I get assistance?", "conversationId": "optional-uuid", "channel": "website" }
```
Returns `{ reply, conversationId, language, needsHuman }`.

### `POST /api/documents` (admin/staff only — multipart form: `file`, `title`, `language`)
Uploads a document and kicks off ingestion (extract → chunk → embed → store in Qdrant).
Returns `202 { id, status: "processing" }`. Poll `GET /api/documents` to see status
flip to `processed` (or `failed`).

## Verifying the "heart of the project" works end to end

1. Log in with `/api/auth/login` to get a token.
2. Upload a real (or dummy) R2L PDF via `POST /api/documents`.
3. Wait a few seconds, check `GET /api/documents` shows `status: "processed"`.
4. Call `POST /api/chat` with a question that PDF should answer.
5. Confirm: language detected correctly, answer is grounded in the document,
   a row appears in `conversations`/`messages`, and `needsHuman` is `false`.
6. Ask something unrelated to the uploaded doc — confirm `needsHuman: true` and
   a row appears in `human_handoffs`.

Once that loop works reliably, the plan's own priority order says you have the
core of the system — everything else (dashboard APIs, WhatsApp, Messenger,
analytics) builds around it, per Weeks 2–4.

## Next steps (Week 2, per the plan)

- Implement DOCX extraction (`mammoth`)
- Add `conversationRoutes` / `clientRoutes` / `leadRoutes` for the admin dashboard
  your partner is building the UI for
- Tune `LOW_CONFIDENCE_THRESHOLD` in `chatController.js` against real Qdrant scores
- Add integration tests for `/api/chat` (Jest + Supertest are already devDependencies)
