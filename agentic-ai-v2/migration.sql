-- Optional dedicated Agentic AI storage. Existing deployments can operate using idms_docs only.
CREATE TABLE IF NOT EXISTS agentic_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  source TEXT DEFAULT '',
  entity_type TEXT DEFAULT '',
  entity_id TEXT DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agentic_events_status_created ON agentic_events(status, created_at DESC);

CREATE TABLE IF NOT EXISTS agentic_proposals (
  proposal_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  event_id TEXT DEFAULT '',
  proposal_type TEXT NOT NULL,
  title TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'Pending Review',
  proposed_by TEXT NOT NULL DEFAULT 'AI agent',
  reviewed_by TEXT DEFAULT '',
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agentic_proposals_status ON agentic_proposals(status, created_at DESC);

CREATE TABLE IF NOT EXISTS agentic_schedules (
  agent_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  interval_minutes INTEGER NOT NULL DEFAULT 1440,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);
