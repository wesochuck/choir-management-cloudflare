CREATE INDEX IF NOT EXISTS email_change_requests_pending_expiry
  ON email_change_requests(expires_at, id)
  WHERE status = 'pending';
