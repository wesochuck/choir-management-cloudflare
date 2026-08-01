CREATE TABLE stripe_connected_accounts (
  account_id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id)
) STRICT;

CREATE INDEX stripe_connected_accounts_organization_id
  ON stripe_connected_accounts (organization_id);
