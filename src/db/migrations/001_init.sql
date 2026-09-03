-- R2L Chatbot — Initial schema
-- Run this against the r2l_chatbot database (see README for instructions)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------- Roles & Admin/Staff users ----------
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) UNIQUE NOT NULL, -- super_admin | admin | staff
  description TEXT
);

CREATE TABLE admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role_id UUID REFERENCES roles(id),
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Clients & Leads ----------
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(150),
  phone VARCHAR(30),
  email VARCHAR(150),
  location VARCHAR(150),
  preferred_language VARCHAR(10) DEFAULT 'en', -- en | si | ta
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  source VARCHAR(30), -- website | whatsapp | messenger
  request_type VARCHAR(100),
  status VARCHAR(30) DEFAULT 'new', -- new | in_progress | closed
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Conversations & Messages ----------
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  channel VARCHAR(20) NOT NULL, -- website | whatsapp | messenger
  language VARCHAR(10) DEFAULT 'en',
  status VARCHAR(30) DEFAULT 'open', -- open | needs_human | resolved | closed
  assigned_staff_id UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type VARCHAR(20) NOT NULL, -- user | ai | staff
  sender_id UUID, -- admin_users.id when sender_type = staff
  content TEXT NOT NULL,
  language VARCHAR(10),
  retrieved_chunk_ids UUID[], -- traceability: which KB chunks the AI used
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Human handoff tracking ----------
CREATE TABLE human_handoffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ DEFAULT now(),
  accepted_by UUID REFERENCES admin_users(id),
  accepted_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  status VARCHAR(30) DEFAULT 'pending' -- pending | accepted | resolved
);

-- ---------- Services (what R2L offers) ----------
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(150) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Knowledge base documents & chunks ----------
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  file_type VARCHAR(20), -- pdf | docx | txt
  language VARCHAR(10) DEFAULT 'en',
  status VARCHAR(30) DEFAULT 'pending', -- pending | processing | processed | failed
  uploaded_by UUID REFERENCES admin_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  qdrant_point_id UUID, -- links to the vector stored in Qdrant
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Analytics (lightweight event log; roll up in queries) ----------
CREATE TABLE analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type VARCHAR(50) NOT NULL, -- conversation_started | escalated | resolved | message_sent
  channel VARCHAR(20),
  language VARCHAR(10),
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ---------- Settings (key-value config editable from admin) ----------
CREATE TABLE settings (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default roles
INSERT INTO roles (name, description) VALUES
  ('super_admin', 'Full system access'),
  ('admin', 'Manage staff, clients, leads, knowledge base, analytics'),
  ('staff', 'Handle conversations and human handoffs');

-- Helpful indexes
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_document_chunks_document ON document_chunks(document_id);
CREATE INDEX idx_analytics_events_type ON analytics_events(event_type);
