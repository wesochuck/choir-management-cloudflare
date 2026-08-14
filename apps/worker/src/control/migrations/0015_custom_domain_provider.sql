ALTER TABLE organization_domains ADD COLUMN provider_hostname_id TEXT;
ALTER TABLE organization_domains ADD COLUMN provider_status TEXT NOT NULL DEFAULT 'not_configured';
ALTER TABLE organization_domains ADD COLUMN provider_ssl_status TEXT;
ALTER TABLE organization_domains ADD COLUMN validation_records_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE organization_domains ADD COLUMN provider_error TEXT;
ALTER TABLE organization_domains ADD COLUMN provider_checked_at TEXT;

CREATE UNIQUE INDEX organization_domains_provider_hostname_id
  ON organization_domains (provider_hostname_id)
  WHERE provider_hostname_id IS NOT NULL;
