-- Two fixes requested by R2L's testing team after live Messenger testing:
--
-- 1. Once a user picks a specific scenario (e.g. "NCII / Sextortion" under
--    Cyber), free-form follow-up questions in that same chat were still
--    retrieved against the WHOLE category via Qdrant, which could surface
--    another scenario's contact numbers/details. This column remembers
--    exactly which scenario was picked so retrieval can be scoped to it
--    (see scenarios.js / categoryFilter.js / messageHandler.js).
--
-- 2. A returning WhatsApp/Messenger user (same phone number / PSID, days
--    later) was resuming their OLD stage/category instead of being asked
--    from the beginning, even if they now have a completely different
--    case. `updated_at` (already on this table) is used to detect a stale
--    conversation and start a fresh one — see the `session_reset_hours`
--    setting below.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS scenario VARCHAR(80);
-- scenario values: one of the scenario `key`s in scenarios.js (e.g.
-- 'cyber-ncii-sextortion'), or null when no specific scenario is active
-- (still in the menu, picked "Other", or the category has no scenario menu).

CREATE INDEX IF NOT EXISTS idx_conversations_scenario ON conversations(scenario);

-- Configurable via PUT /api/settings/session_reset_hours (body: {"value": 48})
-- — no redeploy needed to change 24h -> 48h -> 60h etc. as R2L tunes this
-- after live testing.
INSERT INTO settings (key, value)
VALUES ('session_reset_hours', '24')
ON CONFLICT (key) DO NOTHING;
