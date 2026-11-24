-- Record Organization-scoped portal activity timestamps on Better Auth memberships.
-- Nullable INTEGER Unix epoch milliseconds; existing rows stay NULL until next visit.
ALTER TABLE member ADD COLUMN lastActiveAt INTEGER;
