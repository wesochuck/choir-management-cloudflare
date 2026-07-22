export type DomainErrorCode =
  "conflict" | "forbidden" | "not_found" | "unauthorized" | "validation_failed";

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
}

export type DomainResult<T> =
  { readonly ok: true; readonly value: T } | { readonly error: DomainError; readonly ok: false };

export function success<T>(value: T): DomainResult<T> {
  return { ok: true, value };
}

export function failure(code: DomainErrorCode, message: string): DomainResult<never> {
  return { error: { code, message }, ok: false };
}

export function isPerformer(profile: { readonly voicePart: string | null }): boolean {
  return Boolean(profile.voicePart?.trim());
}

export {
  datePartInTimeZone,
  isValidTimeZone,
  utcToZonedLocalDateTime,
  zonedLocalDateTimeToUtc,
} from "./calendarTime";
export { renderRosterCsv, type RosterCsvProfile } from "./rosterCsv";
export { defaultRosterConfiguration } from "./rosterConfiguration";
export { eventRsvpExportFilename, renderEventRsvpCsv } from "./eventRsvpCsv";
export type { EventRsvpExportSort, EventRsvpStatus } from "./eventRsvpCsv";
