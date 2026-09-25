-- Adds structured onboarding/triage state to conversations, per R2L's request:
-- greeting -> language selection -> category selection -> free-form chat.

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS stage VARCHAR(30) DEFAULT 'greeting';
-- stage values: greeting | awaiting_language | awaiting_category | in_chat

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS category VARCHAR(50);
-- category values: police | cyber | financial | land | family | danger | null

-- Conversations that already exist (from before this migration) should NOT be
-- forced back through onboarding — treat them as already past it.
UPDATE conversations SET stage = 'in_chat' WHERE stage = 'greeting';

CREATE INDEX IF NOT EXISTS idx_conversations_stage ON conversations(stage);
