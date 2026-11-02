-- Adaptive (menu-free) conversation flow, per the R2L / NIT meeting:
--  * the chatbot works out the case from the conversation instead of menus;
--  * near the end it asks whether the person wants an R2L representative, and
--    that outcome is shown in the admin dashboard (handoff_status);
--  * it then asks for consent before collecting personal details
--    (consent_status), which are stored on the client record.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_status VARCHAR(20) NOT NULL DEFAULT 'not_asked';
-- handoff_status values: not_asked | asked | requested | declined

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS consent_status VARCHAR(20) NOT NULL DEFAULT 'not_asked';
-- consent_status values: not_asked | asked | granted | declined

ALTER TABLE clients ADD COLUMN IF NOT EXISTS age INT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(40);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMPTZ;

-- Knowledge-base documents imported from a link keep their source address.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Conversations stuck in the old menu stages carry on as normal chats.
UPDATE conversations SET stage = 'in_chat' WHERE stage IN ('awaiting_language', 'awaiting_category', 'awaiting_scenario');

-- Conversations that already asked for a human before this migration.
UPDATE conversations SET handoff_status = 'requested'
WHERE id IN (SELECT conversation_id FROM human_handoffs);

CREATE INDEX IF NOT EXISTS idx_conversations_handoff_status ON conversations(handoff_status);
