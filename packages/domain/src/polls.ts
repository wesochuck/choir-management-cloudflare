export const POLL_EXPIRATION_DEFAULT_DAYS = 3;
export const POLL_ARCHIVE_DELAY_DAYS = 2;

export function defaultPollExpirationAt(createdAt: Date): string {
  return new Date(
    createdAt.getTime() + POLL_EXPIRATION_DEFAULT_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString();
}

export function pollArchiveDueAt(expiresAt: Date): string {
  return new Date(
    expiresAt.getTime() + POLL_ARCHIVE_DELAY_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString();
}
