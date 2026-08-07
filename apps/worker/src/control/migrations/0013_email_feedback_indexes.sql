CREATE INDEX email_provider_events_operator_status
  ON email_provider_events(operator_status, state, updated_at DESC, event_id DESC);

CREATE INDEX email_feedback_dead_letters_operator_status
  ON email_feedback_dead_letters(operator_status, last_seen_at DESC, id DESC);
