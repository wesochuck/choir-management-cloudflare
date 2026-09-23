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
  rsvpDeadlineFromDate,
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
export {
  getFirstName,
  getInitials,
  getLastName,
  getUniqueDisplayNames,
  lastNameSortKey,
  type DisplayNamed,
} from "./name";
export {
  computeDurationAutoFillDecision,
  computeExpectedTrackDuration,
  formatDetectedDuration,
  initialDurationAutoFillState,
  type DurationAutoFillDecision,
  type DurationAutoFillState,
} from "./durationAutoFill";
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
  type MusicCsvParseResult,
  parseMusicCsv,
  parseMusicCsvWithRows,
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
  clearSeatAssignment,
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
  calculateSetListTiming,
  calculateSetListTransitionCount,
  formatSetListDuration,
  hasSetListPiece,
  isSetListSongItem,
  moveSetListItem,
  normalizeSetListDuration,
  parseSetListDuration,
  type SetListDurationItem,
  type SetListTimingBreakdown,
  type SetListTimingItem,
} from "./setList";
export {
  communicationFailureCategory,
  communicationReach,
  maskCommunicationDestination,
  renderCommunicationTemplate,
  renderOrganizationLogoPlaceholder,
  summarizeCommunicationDeliveries,
  type CommunicationFailureCategory,
  type DeliveryChannel,
  type DeliveryRecord,
  type DeliveryStatus,
  type ReachableRecipient,
} from "./communications";
export {
  dedupeCommunicationCandidates,
  type CommunicationRecipientCandidate,
  type CommunicationRecipientSubjectKind,
  type ResolvedCommunicationRecipient,
} from "./communicationRecipients";
export {
  deriveContactDisplayName,
  deriveDisplayName,
  hasAcceptableContactIdentity,
  mergeContactCommunicationPreferenceStatus,
  mergeContactCommunicationStatus,
  mergeContactConsentStatus,
  normalizeContactEmail,
  normalizeContactPhone,
  normalizeEmail,
  normalizePhone,
  type ContactConsentStatus,
  type ContactConsentStatusWithSuppression,
  type ContactIdentityInput,
} from "./contacts";
export {
  CONTACT_IMPORT_BATCH_SIZE,
  CONTACT_IMPORT_MAX_BYTES,
  CONTACT_IMPORT_MAX_CELL_LENGTH,
  CONTACT_IMPORT_MAX_HEADERS,
  CONTACT_IMPORT_MAX_LISTS,
  CONTACT_IMPORT_ROWS_MAX,
  CONTACT_IMPORT_TARGETS,
  ContactImportError,
  applyContactImportMapping,
  contactImportDedupeKey,
  contactImportRetryDelaySeconds,
  mergeContactImportIntoExisting,
  parseContactImportCsv,
  parseContactImportStatus,
  previewContactImport,
  renderContactImportErrorCsv,
  shouldOverwriteWithImportValue,
  suggestContactImportMapping,
  validateContactImportMapping,
  validateContactImportRecord,
  type ContactImportErrorCode,
  type ContactImportParsedCsv,
  type ContactImportParsedRow,
  type ContactImportPreview,
  type ContactImportPreviewContext,
  type ContactImportRecord,
  type ContactImportResult,
  type ContactImportRowClassification,
  type ContactImportRowOutcome,
  type ContactImportTarget,
  type ContactImportValidatedRow,
  type ContactImportErrorRow,
} from "./contactImport";
export {
  communicationPlaceholderDefinitions,
  determineCommunicationPlaceholderContext,
  extractCommunicationPlaceholders,
  findCommunicationPlaceholderDefinition,
  hasEventDependentCommunicationPlaceholders,
  isPlaceholderCompatibleWithAudience,
  isPlaceholderCompatibleWithChannel,
  removeCommunicationPlaceholder,
  templateMatchesCommunicationContext,
  validateCommunicationContext,
  visibleCommunicationPlaceholders,
  type CommunicationAudienceLike,
  type CommunicationAudienceTarget,
  type CommunicationChannel,
  type CommunicationContextIssue,
  type CommunicationPlaceholderCategory,
  type CommunicationPlaceholderDefinition,
  type CommunicationPlaceholderContext,
  type CommunicationTemplateLike,
} from "./communicationPlaceholders";
export {
  canTransitionTicketPurchase,
  isValidTicketDiscountValue,
  normalizeDiscountCode,
  remainingTicketCapacity,
  renderTicketWillCallCsv,
  ticketOrderQuote,
  ticketProcessingFeeCents,
  ticketUnitPriceCents,
  defaultTransactionFeeSettings,
  transactionProcessingFeeCents,
  ticketWillCallFilename,
  ticketCheckoutLineItems,
  type TicketCheckoutLineItemsInput,
  type TicketPriceInput,
  type TicketDiscountInput,
  type TicketDiscountType,
  type TicketOrderQuote,
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
  buildDonorSuggestions,
  filterDonorSuggestions,
  type DonorSuggestion,
  type DonorSuggestionMemberInput,
  type DonorSuggestionPatronInput,
  type DonorSuggestionSource,
  type DonorSuggestionTicketBuyerInput,
} from "./donorSuggestions";
export {
  defaultPollExpirationAt,
  pollArchiveDueAt,
  POLL_ARCHIVE_DELAY_DAYS,
  POLL_EXPIRATION_DEFAULT_DAYS,
} from "./polls";
export {
  canSetDonationThankYouStatus,
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
export {
  areAuditionDatesPassed,
  type AuditionSettingsLike,
  type AuditionSlotLike,
} from "./auditions";
export { MODULE_DEFINITIONS, resolveModuleEnabled, nextSetupStep, isSetupComplete } from "./setup";
export type {
  ModuleCategory,
  ModuleDefinition,
  SetupStep,
  SetupProgress,
  OrganizationSetup,
} from "./setup";
