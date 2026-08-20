CREATE TABLE IF NOT EXISTS organization_email_domains (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  verified_at INTEGER,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_organization_email_domains_org
  ON organization_email_domains(organization_id);
