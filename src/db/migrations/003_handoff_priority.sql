-- The "immediate danger" onboarding path already flags its handoff as
-- priority:'emergency' in the live Socket.io event, but that flag was never
-- persisted — a dashboard page reload lost it and fell back to plain
-- chronological queue order. This column fixes that.

ALTER TABLE human_handoffs ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal';
-- priority values: normal | emergency

CREATE INDEX IF NOT EXISTS idx_human_handoffs_priority ON human_handoffs(priority);