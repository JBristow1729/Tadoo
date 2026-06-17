CREATE TABLE IF NOT EXISTS tadoo_accounts (
  id TEXT PRIMARY KEY,
  identity_id TEXT UNIQUE,
  chores JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tadoo_accounts_identity_id_idx
  ON tadoo_accounts (identity_id);
