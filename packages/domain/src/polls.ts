export const POLL_EXPIRATION_DEFAULT_DAYS = 3;

export function defaultPollExpirationAt(createdAt: Date): string {
  return new Date(
    createdAt.getTime() + POLL_EXPIRATION_DEFAULT_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString();
}
