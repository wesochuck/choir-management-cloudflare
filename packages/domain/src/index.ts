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
export {
  inspectRosterCsv,
  mapRosterCsvColumns,
  parseRosterCsv,
  renderRosterCsv,
  RosterCsvError,
  rosterCsvColumnForHeader,
  rosterCsvColumnOptions,
  type RosterCsvImportProfile,
  type RosterCsvProfile,
  type RosterCsvColumnWarning,
  type RosterCsvInspection,
} from "./rosterCsv";
export { defaultRosterConfiguration } from "./rosterConfiguration";
export {
  calculateOnBreakInactiveAt,
  calculateRsvpDeadline,
  evaluateProfileStatus,
  isMissedPerformance,
  isRsvpDeadlinePassed,
  performanceHasEnded,
  type AttendanceStatus,
  type AutomatedProfileStatus,
  type PerformanceAutomationRecord,
  type ProfileAutomationSnapshot,
  type ProfileStatusEvaluation,
  type RsvpDeadline,
  type RsvpStatus,
  type StatusAutomationConfiguration,
} from "./statusAutomation";
export { eventRsvpExportFilename, renderEventRsvpCsv } from "./eventRsvpCsv";
export type { EventRsvpExportSort, EventRsvpStatus } from "./eventRsvpCsv";
export { lastNameSortKey } from "./name";
export {
  calculateMusicFolderCounts,
  deriveMusicFolderStatus,
  musicFolderReportFilename,
  normalizeFolderNumber,
  normalizedFolderNumberKey,
  renderMusicFolderReportCsv,
  sortMusicFolderProfiles,
  type MusicFolderCountRow,
  type MusicFolderCsvRow,
  type MusicFolderProfileSortValue,
  type MusicFolderReportCounts,
  type MusicFolderReportStatus,
} from "./musicFolderReport";
export type { CsvColumnMapping } from "./csvMapping";
export {
  MusicCsvError,
  inspectMusicCsv,
  mapMusicCsvColumns,
  musicCsvHeader,
  musicCsvColumnForHeader,
  musicCsvColumnOptions,
  parseMusicCsv,
  renderMusicCsv,
  selectMusicCsvColumns,
  type MusicCsvColumnWarning,
  type MusicCsvInspection,
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
  normalizeSetListDuration,
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
  defaultTransactionFeeSettings,
  transactionProcessingFeeCents,
  ticketWillCallFilename,
  type TicketPriceInput,
  type TransactionFeeSettings,
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
  defaultPollExpirationAt,
  pollArchiveDueAt,
  POLL_ARCHIVE_DELAY_DAYS,
  POLL_EXPIRATION_DEFAULT_DAYS,
} from "./polls";
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
