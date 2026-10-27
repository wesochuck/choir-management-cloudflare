ALTER TABLE organization_roster_invite_enrollments
  ADD COLUMN profile_mode TEXT NOT NULL DEFAULT 'new'
  CHECK (profile_mode IN ('new', 'existing'));
