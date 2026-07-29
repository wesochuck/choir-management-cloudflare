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
  addDays,
  datePartInTimeZone,
  formatTime,
  isValidTimeZone,
  utcToZonedLocalDateTime,
  zonedLocalDateTimeToUtc,
} from "./calendarTime";
export {
  parseRosterCsv,
  renderRosterCsv,
  RosterCsvError,
  type RosterCsvImportProfile,
  type RosterCsvProfile,
} from "./rosterCsv";
export { defaultRosterConfiguration } from "./rosterConfiguration";
export { eventRsvpExportFilename, renderEventRsvpCsv } from "./eventRsvpCsv";
export type { EventRsvpExportSort, EventRsvpStatus } from "./eventRsvpCsv";
export {
  MusicCsvError,
  musicCsvHeader,
  parseMusicCsv,
  renderMusicCsv,
  type MusicCsvPiece,
} from "./musicCsv";
export { calculateSeatingSuggestions, isSeatingSectionMismatch } from "./seatingAlgorithm";
export type { SeatingFormationStrategy } from "./seatingAlgorithm";
export { defaultSeatingConfiguration } from "./seatingConfiguration";
export {
  addRow,
  addSeat,
  moveAssignment,
  removeRow,
  removeSeat,
  swapAssignments,
  unassignProfile,
  type SeatingKeyMap,
  type SeatingLayoutState,
} from "./seatingLayout";
export {
  calculateSetListDuration,
  formatSetListDuration,
  hasSetListPiece,
  moveSetListItem,
  parseSetListDuration,
  type SetListDurationItem,
} from "./setList";
export {
  communicationFailureCategory,
  communicationReach,
  maskCommunicationDestination,
  renderCommunicationTemplate,
  summarizeCommunicationDeliveries,
  type CommunicationFailureCategory,
  type DeliveryChannel,
  type DeliveryRecord,
  type DeliveryStatus,
  type ReachableRecipient,
} from "./communications";
export {
  canTransitionTicketPurchase,
  remainingTicketCapacity,
  renderTicketWillCallCsv,
  ticketProcessingFeeCents,
  ticketUnitPriceCents,
  ticketWillCallFilename,
  type TicketPriceInput,
  type TicketWillCallRow,
} from "./ticketing";
export {
  attendanceReportFilename,
  renderAttendanceReportCsv,
  type AttendanceReportInput,
  type AttendanceReportSinger,
  type AttendanceExportSort,
} from "./attendanceReportCsv";
export { donationExportFilename, renderDonationCsv, type DonationExportRow } from "./donationCsv";
export {
  canTransitionDonation,
  type DonationInput,
  type DonationRecord,
  type DonationStatus,
  type DonationTributeType,
  type PatronRecord,
} from "./donations";
export {
  renderRepertoireReportCsv,
  repertoireReportFilename,
  type RepertoireReportInput,
  type RepertoireReportPiece,
} from "./repertoireReportCsv";
export { canTransitionDues, type DuesRecord, type DuesStatus, type SeasonInput } from "./seasons";
export { nextSetupStep, isSetupComplete } from "./setup";
export type { SetupStep, SetupProgress, OrganizationSetup } from "./setup";
