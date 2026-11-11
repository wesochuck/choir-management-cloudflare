import { readCommunicationOverview } from "./communicationOverview";
import {
  readTicketNotificationDetails,
  cancelTicketNotification,
} from "./ticketNotificationManagement";
import {
  checkCommunicationDelivery,
  type CommunicationDeliveryCheckInput,
  communicationBatchInputSchema,
  finishCommunicationBatch,
  type CommunicationBatchInput,
} from "./communicationStore/batches";
import { readCommunicationJobFromStore } from "./communicationStore/deliveryQueries";
import {
  deliveryJobResponseSchema,
  upcomingPerformancesContextInputSchema,
  type UpcomingPerformancesContextInput,
} from "./communicationStore/contracts";
import {
  identityMatches as communicationIdentityMatches,
  queryUpcomingPerformancesForCommunication,
} from "./communicationStore/shared";
import {
  claimCheckoutReminder,
  confirmCheckoutReminderSend,
  checkoutReminderDestination,
  recordCheckoutReminderResult,
} from "./checkoutReminderDeliveryStore";
import {
  readCheckoutReminderSettings,
  setCheckoutReminderSettings,
  capturePaymentResourceReminder,
  stopCheckoutReminders,
  readCheckoutRecoveryChoices,
} from "./checkoutReminderStore";
import {
  listDonationPublications,
  saveDonationPublication,
  setDonationInclusion,
  reviewDonationPublications,
} from "./donationPublicationStore";
import {
  managePublicWebsiteOperationInStore,
  readPublicWebsiteSettingsFromStore,
  type publicWebsiteOperationSchema,
} from "./publicWebsiteStore";
import {
  startLoudness,
  loudnessStatus,
  loudnessFailures,
  claimLoudness,
  bindLoudnessVersion,
  renewLoudness,
  submitLoudness,
} from "./loudnessStore";
import {
  createPublicWebsiteDocumentInStore,
  deletePublicWebsiteDocumentInStore,
  getPublicWebsiteDocumentForDownloadFromStore,
  listPublicWebsiteDocumentsInStore,
  updatePublicWebsiteDocumentInStore,
} from "./publicDocumentStore";
import { DurableObject } from "cloudflare:workers";
import type { z } from "zod";

import {
  addContactsToListInStore,
  bulkDeleteContactsInStore,
  createContactInStore,
  createContactListInStore,
  deleteContactInStore,
  deleteContactListInStore,
  getContactFromStore,
  listContactListsFromStore,
  listContactsFromStore,
  removeContactsFromListInStore,
  updateContactInStore,
  updateContactListInStore,
  type BulkMembershipInput,
  type CreateContactInput,
  type CreateContactListInput,
  type ListContactsInput,
  type UpdateContactInput,
  type UpdateContactListInput,
} from "./contactStore";
import type {
  OrganizationEmailDomainDnsRecord,
  PlatformStripeReconciliationCursor,
} from "@choir/contracts";
import {
  commitEmailDomainVerificationInStore,
  prepareEmailDomainVerificationInStore,
} from "./organizationEmailSettingsStore";
import {
  cancelPreparedRosterInviteEnrollmentInStore,
  commitRosterInviteEnrollmentInStore,
  getRosterInviteEnrollmentResultInStore,
  getRosterInviteOptionsInStore,
  prepareRosterInviteEnrollmentInStore,
  protectRosterInviteProfileForLinkInStore,
  resolveRosterInviteProfileMatchInStore,
  type CommitRosterInviteEnrollmentInput,
  type PrepareRosterInviteEnrollmentInput,
} from "./rosterInviteEnrollmentStore";
import {
  cancelContactImportInStore,
  confirmContactImportInStore,
  createContactImportInStore,
  getContactImportFromStore,
  previewContactImportFromStore,
  processContactImportBatchInStore,
  readContactImportErrorCsvFromStore,
  updateContactImportMappingInStore,
} from "./contactImportStore";
import {
  claimMusicTrackImportCleanupBatchInStore,
  claimMusicTrackImportUploadInStore,
  commitMusicTrackImportInStore,
  completeMusicTrackImportCleanupInStore,
  createMusicTrackImportSessionInStore,
  discardMusicTrackImportSessionInStore,
  failMusicTrackImportUploadInStore,
  finalizeMusicTrackImportUploadInStore,
  getMusicTrackImportSessionInStore,
  listMusicTrackImportSessionsInStore,
  prepareMusicTrackImportCleanupSweepInStore,
  scheduleMusicTrackImportCleanupContinuationInStore,
  updateMusicTrackImportAssignmentsInStore,
  type AssignmentPatch,
} from "./music/trackImportStore";
import {
  applyHistoricalStripeReconciliationInStore,
  listStripePaymentReconciliationCandidatesInStore,
  type ApplyHistoricalStripeReconciliationInput,
} from "./stripePaymentReconciliationStore";
import {
  archiveComplianceTaskInStore,
  completeComplianceTaskInStore,
  createComplianceTaskInStore,
  readNonprofitComplianceFromStore,
  recordComplianceInboxNoticesInStore,
  restoreComplianceTaskInStore,
  setNonprofitEnabledInStore,
  type RecordComplianceInboxNoticesInput,
  updateComplianceTaskInStore,
} from "./complianceStore";
import {
  commitProfileReconciliationInStore,
  findReconciliationCandidatesInStore,
  getProfileReconciliationStatusInStore,
  prepareProfileReconciliationInStore,
  previewProfileReconciliationInStore,
  resolveCanonicalProfileId,
  type CommitProfileReconciliationInput,
  type PrepareProfileReconciliationInput,
  type PreviewProfileReconciliationInput,
} from "./organizationStore/profileReconciliation";
import { migrateOrganization } from "./migrations";
import {
  readPaymentFeeReconciliationStatus,
  schedulePaymentFeeReconciliationInStore,
} from "./feeReconciliation";
import { runOrganizationAlarm, wakeOrganizationAlarm } from "./scheduler";
import { clearUnsuccessfulEventReminderMarkers } from "./schedulingStore";
import { dispatchPostRequest } from "./organizationStore/post";
import { dispatchGetRequest } from "./organizationStore/read";
import {
  isOrganizationRpcRecord,
  isOrganizationRpcValue,
  organizationRpcDomainForPath,
  organizationRpcOperationForPath,
  parseOrganizationRpcCall,
  type OrganizationRpcCall,
  type OrganizationRpcResult,
} from "./rpc/types";

function responseHeaders(response: Response): Readonly<Record<string, string>> {
  return Object.fromEntries(response.headers.entries());
}

function isAlarmWakePath(pathname: string): boolean {
  // Ticketing wake is owned by ticketingStore via wakeOrganizationAlarm; keeping
  // it here would deliberately wake the same operation twice.
  return (
    pathname === "/internal/audition/create" ||
    pathname === "/internal/audition/update" ||
    pathname === "/internal/donations/manage" ||
    pathname === "/internal/export/create" ||
    pathname === "/internal/seasons/manage"
  );
}

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} binding is not configured.`);
  return binding;
}

export class OrganizationStore extends DurableObject {
  constructor(state: DurableObjectState, env: Cloudflare.Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      migrateOrganization(state.storage);
      return Promise.resolve();
    });
  }

  override async fetch(request: Request): Promise<Response> {
    return this.dispatchHttpRequest(request);
  }

  async lifecycleRpc(call: OrganizationRpcCall<"lifecycle">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async profileRpc(call: OrganizationRpcCall<"profile">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async calendarRpc(call: OrganizationRpcCall<"calendar">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async communicationRpc(
    call: OrganizationRpcCall<"communication">,
  ): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async contentRpc(call: OrganizationRpcCall<"content">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async engagementRpc(call: OrganizationRpcCall<"engagement">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async commerceRpc(call: OrganizationRpcCall<"commerce">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async fileRpc(call: OrganizationRpcCall<"file">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async jobRpc(call: OrganizationRpcCall<"job">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async operationsRpc(call: OrganizationRpcCall<"operations">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  readCommunicationOverview(input: Parameters<typeof readCommunicationOverview>[1]) {
    return readCommunicationOverview(this.ctx.storage, input);
  }

  readTicketNotificationDetails(input: Parameters<typeof readTicketNotificationDetails>[1]) {
    return readTicketNotificationDetails(this.ctx.storage, input);
  }
  cancelTicketNotification(input: Parameters<typeof cancelTicketNotification>[1]) {
    return this.ctx.storage.transactionSync(() =>
      cancelTicketNotification(this.ctx.storage, input),
    );
  }

  async schedulePaymentFeeReconciliation(input: {
    readonly organizationId: string;
    readonly providerPaymentId: string;
  }) {
    const result = this.ctx.storage.transactionSync(() =>
      schedulePaymentFeeReconciliationInStore(this.ctx.storage, input),
    );
    if ("wakeScheduler" in result && result.wakeScheduler) {
      await wakeOrganizationAlarm(this.ctx.storage);
    }
    return result;
  }

  readPaymentFeeReconciliationStatus(input: {
    readonly organizationId: string;
    readonly providerPaymentId: string;
  }) {
    return readPaymentFeeReconciliationStatus(this.ctx.storage, input);
  }

  checkoutReminderDestination(input: Parameters<typeof checkoutReminderDestination>[1]) {
    return checkoutReminderDestination(this.ctx.storage, input);
  }
  confirmCheckoutReminderSend(input: Parameters<typeof confirmCheckoutReminderSend>[1]) {
    return confirmCheckoutReminderSend(this.ctx.storage, input);
  }
  claimCheckoutReminder(input: Parameters<typeof claimCheckoutReminder>[1]) {
    return claimCheckoutReminder(this.ctx.storage, input);
  }
  recordCheckoutReminderResult(input: Parameters<typeof recordCheckoutReminderResult>[1]) {
    recordCheckoutReminderResult(this.ctx.storage, input);
  }
  readCheckoutReminderSettings(input: { organizationId: string }) {
    return readCheckoutReminderSettings(this.ctx.storage, input.organizationId);
  }
  async setCheckoutReminderSettings(input: Parameters<typeof setCheckoutReminderSettings>[1]) {
    const result = setCheckoutReminderSettings(this.ctx.storage, input);
    await wakeOrganizationAlarm(this.ctx.storage);
    return result;
  }
  async capturePaymentResourceReminder(
    input: Parameters<typeof capturePaymentResourceReminder>[1],
  ) {
    const result = capturePaymentResourceReminder(this.ctx.storage, input);
    if (result.captured) await wakeOrganizationAlarm(this.ctx.storage);
    return result;
  }
  stopCheckoutReminders(input: Parameters<typeof stopCheckoutReminders>[1]) {
    return stopCheckoutReminders(this.ctx.storage, input);
  }
  readCheckoutRecoveryChoices(input: Parameters<typeof readCheckoutRecoveryChoices>[1]) {
    return readCheckoutRecoveryChoices(this.ctx.storage, input);
  }

  listDonationPublications(input: Parameters<typeof listDonationPublications>[1]) {
    return listDonationPublications(this.ctx.storage, input);
  }
  saveDonationPublication(input: Parameters<typeof saveDonationPublication>[1]) {
    return saveDonationPublication(this.ctx.storage, input);
  }
  setDonationInclusion(input: Parameters<typeof setDonationInclusion>[1]) {
    return setDonationInclusion(this.ctx.storage, input);
  }
  reviewDonationPublications(input: Parameters<typeof reviewDonationPublications>[1]) {
    return reviewDonationPublications(this.ctx.storage, input);
  }

  // Phase 2 marketing contacts: strongly typed Durable Object RPC methods.
  // Call via `stub.methodName(...)`; no internal fetch routing.
  listContacts(input: ListContactsInput) {
    return listContactsFromStore(this.ctx.storage, input);
  }

  getContact(input: { readonly contactId: string; readonly organizationId: string | null }) {
    return getContactFromStore(this.ctx.storage, input.organizationId, input.contactId);
  }

  createContact(input: CreateContactInput) {
    return createContactInStore(this.ctx.storage, input);
  }

  updateContact(input: UpdateContactInput) {
    return updateContactInStore(this.ctx.storage, input);
  }

  deleteContact(input: {
    readonly actorUserId: string;
    readonly contactId: string;
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    return deleteContactInStore(this.ctx.storage, input);
  }

  bulkDeleteContacts(input: {
    readonly actorUserId: string;
    readonly contactIds: readonly string[];
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    return bulkDeleteContactsInStore(this.ctx.storage, input);
  }

  listContactLists(input: { readonly organizationId: string | null }) {
    return listContactListsFromStore(this.ctx.storage, input.organizationId);
  }

  createContactList(input: CreateContactListInput) {
    return createContactListInStore(this.ctx.storage, input);
  }

  updateContactList(input: UpdateContactListInput) {
    return updateContactListInStore(this.ctx.storage, input);
  }

  deleteContactList(input: {
    readonly actorUserId: string;
    readonly listId: string;
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    return deleteContactListInStore(this.ctx.storage, input);
  }

  addContactsToList(input: BulkMembershipInput) {
    return addContactsToListInStore(this.ctx.storage, input);
  }

  removeContactsFromList(input: BulkMembershipInput) {
    return removeContactsFromListInStore(this.ctx.storage, input);
  }

  // Phase 5 staged CSV contact imports: strongly typed Durable Object RPC
  // methods. Call via `stub.methodName(...)`; no internal fetch routing.
  // Only confirmation enqueues async work (via the scheduler outbox + alarm);
  // upload/mapping/preview/cancel never mutate contacts.
  createContactImport(input: {
    readonly actorUserId: string;
    readonly byteCount: number;
    readonly fileName: string;
    readonly headers: readonly string[];
    readonly importId: string;
    readonly malformedRows?:
      | readonly {
          readonly cells: readonly string[];
          readonly error: string;
          readonly rowNumber: number;
        }[]
      | undefined;
    readonly organizationId: string;
    readonly requestId: string;
    readonly rows:
      | readonly (readonly string[])[]
      | readonly {
          readonly cells: readonly string[];
          readonly rowNumber?: number;
        }[];
  }) {
    return createContactImportInStore(this.ctx.storage, input);
  }

  getContactImport(input: { readonly importId: string; readonly organizationId: string | null }) {
    return getContactImportFromStore(this.ctx.storage, input.organizationId, input.importId);
  }

  updateContactImportMapping(input: {
    readonly actorUserId: string;
    readonly importId: string;
    readonly listIds: readonly string[];
    readonly mapping: readonly string[];
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    return updateContactImportMappingInStore(this.ctx.storage, input);
  }

  previewContactImport(input: {
    readonly importId: string;
    readonly organizationId: string | null;
  }) {
    return previewContactImportFromStore(this.ctx.storage, input.organizationId, input.importId);
  }

  async confirmContactImport(input: {
    readonly actorUserId: string;
    readonly importId: string;
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    const result = confirmContactImportInStore(this.ctx.storage, input);
    // Wake the scheduler promptly so the queued import does not wait for the
    // hourly cadence; the alarm drains the outbox through the queue consumer.
    await wakeOrganizationAlarm(this.ctx.storage);
    return result;
  }

  cancelContactImport(input: {
    readonly actorUserId: string;
    readonly importId: string;
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    return cancelContactImportInStore(this.ctx.storage, input);
  }

  // Session-backed bulk practice-track imports (issue #278): strongly typed
  // Durable Object RPC methods. Call via `stub.methodName(...)`; no internal
  // HTTP fetch routing. Upload/commit/cleanup only touch SQLite here; R2
  // bytes move in the Worker route/queue layer between claim and finalize.
  createMusicTrackImportSession(input: {
    readonly actorUserId: string;
    readonly clientBatchKey: string;
    readonly items: readonly {
      readonly clientFileId: string;
      readonly contentType: "audio/mpeg";
      readonly durationSeconds: number | null;
      readonly fileName: string;
      readonly lastModifiedMs: number;
      readonly partKey: string;
      readonly pieceId: string;
      readonly sha256Hex: string;
      readonly sizeBytes: number;
    }[];
    readonly manifestDigest: string;
    readonly now: string;
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    return createMusicTrackImportSessionInStore(this.ctx.storage, input);
  }

  getMusicTrackImportSession(input: {
    readonly actorUserId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly sessionId: string;
  }) {
    return getMusicTrackImportSessionInStore(this.ctx.storage, input);
  }

  listMusicTrackImportSessions(input: {
    readonly actorUserId: string;
    readonly limit?: number | undefined;
    readonly now: string;
    readonly organizationId: string;
  }) {
    return listMusicTrackImportSessionsInStore(this.ctx.storage, input);
  }

  claimMusicTrackImportUpload(input: {
    readonly actorUserId: string;
    readonly clientFileId: string;
    readonly contentType: string;
    readonly expectedSizeBytes: number;
    readonly fileName: string;
    readonly now: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly sessionId: string;
  }) {
    return claimMusicTrackImportUploadInStore(this.ctx.storage, input);
  }

  finalizeMusicTrackImportUpload(input: {
    readonly actorUserId: string;
    readonly clientFileId: string;
    readonly fileId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly r2Version?: string | null | undefined;
    readonly receivedSizeBytes: number;
    readonly requestId: string;
    readonly sessionId: string;
  }) {
    return finalizeMusicTrackImportUploadInStore(this.ctx.storage, input);
  }

  failMusicTrackImportUpload(input: {
    readonly actorUserId: string;
    readonly clientFileId: string;
    readonly errorCode: string;
    readonly fileId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly sessionId: string;
  }) {
    return failMusicTrackImportUploadInStore(this.ctx.storage, input);
  }

  updateMusicTrackImportAssignments(input: {
    readonly actorUserId: string;
    readonly assignments: readonly AssignmentPatch[];
    readonly expectedRevision: number;
    readonly now: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly sessionId: string;
  }) {
    return updateMusicTrackImportAssignmentsInStore(this.ctx.storage, input);
  }

  commitMusicTrackImport(input: {
    readonly actorUserId: string;
    readonly commitKey: string;
    readonly expectedRevision: number;
    readonly now: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly sessionId: string;
  }) {
    return commitMusicTrackImportInStore(this.ctx.storage, input);
  }

  async discardMusicTrackImportSession(input: {
    readonly actorUserId: string;
    readonly now: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly sessionId: string;
  }) {
    const result = discardMusicTrackImportSessionInStore(this.ctx.storage, input);
    // Wake the scheduler promptly so orphaned uploads are reclaimed without
    // waiting for the hourly cadence, mirroring contact-import confirmation.
    await wakeOrganizationAlarm(this.ctx.storage);
    return result;
  }

  prepareMusicTrackImportCleanupSweep(input: {
    readonly limit?: number | undefined;
    readonly now: string;
    readonly organizationId: string;
  }) {
    return prepareMusicTrackImportCleanupSweepInStore(this.ctx.storage, input);
  }

  claimMusicTrackImportCleanupBatch(input: {
    readonly limit?: number | undefined;
    readonly now: string;
    readonly organizationId: string;
    readonly sessionId: string;
  }) {
    return claimMusicTrackImportCleanupBatchInStore(this.ctx.storage, input);
  }

  completeMusicTrackImportCleanup(input: {
    readonly errorCode?: string | undefined;
    readonly fileIds: readonly string[];
    readonly now: string;
    readonly organizationId: string;
    readonly sessionId: string;
  }) {
    return completeMusicTrackImportCleanupInStore(this.ctx.storage, input);
  }

  async scheduleMusicTrackImportCleanupContinuation(input: {
    readonly now: string;
    readonly organizationId: string;
    readonly sessionId: string;
  }) {
    const result = scheduleMusicTrackImportCleanupContinuationInStore(this.ctx.storage, input);
    await wakeOrganizationAlarm(this.ctx.storage);
    return result;
  }

  // Nonprofit compliance tracker: strongly typed Durable Object RPC methods.
  // Call via `stub.methodName(...)`; no internal fetch routing.
  readNonprofitCompliance() {
    return readNonprofitComplianceFromStore(this.ctx.storage);
  }

  setNonprofitEnabled(input: {
    readonly actorUserId: string;
    readonly enabled: boolean;
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    return setNonprofitEnabledInStore(this.ctx.storage, input, input.enabled);
  }

  updateComplianceTask(input: {
    readonly actorUserId: string;
    readonly applicable?: boolean | undefined;
    readonly description?: string | undefined;
    readonly nextDueDate?: string | null | undefined;
    readonly organizationId: string;
    readonly recurrenceMonths?: number | undefined;
    readonly referenceUrl?: string | null | undefined;
    readonly responsibleMembershipId?: string | null | undefined;
    readonly responsibleUserId?: string | null | undefined;
    readonly requestId: string;
    readonly taskId: string;
    readonly title?: string | undefined;
  }) {
    return updateComplianceTaskInStore(this.ctx.storage, input, input.taskId, {
      ...(input.applicable !== undefined ? { applicable: input.applicable } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.nextDueDate !== undefined ? { nextDueDate: input.nextDueDate } : {}),
      ...(input.recurrenceMonths !== undefined ? { recurrenceMonths: input.recurrenceMonths } : {}),
      ...(input.referenceUrl !== undefined ? { referenceUrl: input.referenceUrl } : {}),
      ...(input.responsibleMembershipId !== undefined
        ? { responsibleMembershipId: input.responsibleMembershipId }
        : {}),
      ...(input.responsibleUserId !== undefined
        ? { responsibleUserId: input.responsibleUserId }
        : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
    });
  }

  createComplianceTask(input: {
    readonly actorUserId: string;
    readonly applicable?: boolean | undefined;
    readonly description?: string | undefined;
    readonly nextDueDate?: string | null | undefined;
    readonly organizationId: string;
    readonly recurrenceMonths?: number | undefined;
    readonly referenceUrl?: string | null | undefined;
    readonly requestId: string;
    readonly responsibleMembershipId?: string | null | undefined;
    readonly responsibleUserId?: string | null | undefined;
    readonly title: string;
  }) {
    return createComplianceTaskInStore(this.ctx.storage, input, {
      ...(input.applicable !== undefined ? { applicable: input.applicable } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.nextDueDate !== undefined ? { nextDueDate: input.nextDueDate } : {}),
      ...(input.recurrenceMonths !== undefined ? { recurrenceMonths: input.recurrenceMonths } : {}),
      ...(input.referenceUrl !== undefined ? { referenceUrl: input.referenceUrl } : {}),
      ...(input.responsibleMembershipId !== undefined
        ? { responsibleMembershipId: input.responsibleMembershipId }
        : {}),
      ...(input.responsibleUserId !== undefined
        ? { responsibleUserId: input.responsibleUserId }
        : {}),
      title: input.title,
    });
  }

  archiveComplianceTask(input: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly taskId: string;
  }) {
    return archiveComplianceTaskInStore(this.ctx.storage, input, input.taskId);
  }

  restoreComplianceTask(input: {
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly taskId: string;
  }) {
    return restoreComplianceTaskInStore(this.ctx.storage, input, input.taskId);
  }

  completeComplianceTask(input: {
    readonly actorUserId: string;
    readonly completedDate?: string | null | undefined;
    readonly organizationId: string;
    readonly requestId: string;
    readonly taskId: string;
  }) {
    return completeComplianceTaskInStore(
      this.ctx.storage,
      input,
      input.taskId,
      input.completedDate ?? null,
      new Date(),
    );
  }

  recordComplianceInboxNotices(input: RecordComplianceInboxNoticesInput) {
    return recordComplianceInboxNoticesInStore(this.ctx.storage, input);
  }

  processContactImportBatch(input: {
    readonly actorUserId: string;
    readonly batchSize?: number | undefined;
    readonly importId: string;
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    return processContactImportBatchInStore(this.ctx.storage, input);
  }

  contactImportErrorCsv(input: {
    readonly importId: string;
    readonly organizationId: string | null;
  }) {
    return readContactImportErrorCsvFromStore(
      this.ctx.storage,
      input.organizationId,
      input.importId,
    );
  }

  // Organization roster invite enrollment: strongly typed Durable Object RPC methods.
  // Call via `stub.methodName(...)`; no internal fetch routing.
  getRosterInviteOptions(input: {
    readonly email?: string | null;
    readonly organizationId: string;
    readonly userId?: string | null;
  }) {
    return getRosterInviteOptionsInStore(this.ctx.storage, input);
  }

  resolveRosterInviteProfileMatch(input: {
    readonly email: string;
    readonly organizationId: string;
    readonly userId?: string;
  }) {
    return resolveRosterInviteProfileMatchInStore(this.ctx.storage, input);
  }

  protectRosterInviteProfileForLink(input: {
    readonly email: string;
    readonly organizationId: string;
    readonly profileId: string;
    readonly userId: string;
  }) {
    return protectRosterInviteProfileForLinkInStore(this.ctx.storage, input);
  }

  prepareRosterInviteEnrollment(input: PrepareRosterInviteEnrollmentInput) {
    return prepareRosterInviteEnrollmentInStore(this.ctx.storage, input);
  }

  commitRosterInviteEnrollment(input: CommitRosterInviteEnrollmentInput) {
    return commitRosterInviteEnrollmentInStore(this.ctx.storage, input);
  }

  cancelPreparedRosterInviteEnrollment(input: {
    readonly enrollmentId: string;
    readonly organizationId: string;
  }) {
    return cancelPreparedRosterInviteEnrollmentInStore(this.ctx.storage, input);
  }

  getRosterInviteEnrollmentResult(input: {
    readonly enrollmentId: string;
    readonly organizationId: string;
  }) {
    return getRosterInviteEnrollmentResultInStore(this.ctx.storage, input);
  }

  // Profile reconciliation / duplicate resolution: strongly typed Durable Object RPC methods.
  // Call via `stub.methodName(...)`; no internal fetch routing.
  previewProfileReconciliation(input: PreviewProfileReconciliationInput) {
    return previewProfileReconciliationInStore(this.ctx.storage, input);
  }

  prepareProfileReconciliation(input: PrepareProfileReconciliationInput) {
    return prepareProfileReconciliationInStore(this.ctx.storage, input);
  }

  commitProfileReconciliation(input: CommitProfileReconciliationInput) {
    return commitProfileReconciliationInStore(this.ctx.storage, input);
  }

  findReconciliationCandidates(input: {
    readonly query?: string | undefined;
    readonly sourceProfileId: string;
  }) {
    return findReconciliationCandidatesInStore(this.ctx.storage, input);
  }

  getProfileReconciliationStatus(reconciliationId: string) {
    return getProfileReconciliationStatusInStore(this.ctx.storage, reconciliationId);
  }

  resolveCanonicalProfileId(profileId: string) {
    return resolveCanonicalProfileId(this.ctx.storage, profileId);
  }

  // Email-domain DNS verification: strongly typed Durable Object RPC methods.
  // The DO owns configuration and verification state; DNS resolution runs
  // Worker-side. Call via `stub.methodName(...)`; no internal fetch routing.
  prepareEmailDomainVerification(input: { readonly organizationId: string }) {
    return prepareEmailDomainVerificationInStore(this.ctx.storage, input.organizationId);
  }

  commitEmailDomainVerification(input: {
    readonly checkedAt: string;
    readonly configurationId: string;
    readonly dnsRecords: readonly OrganizationEmailDomainDnsRecord[];
    readonly organizationId: string;
  }) {
    return commitEmailDomainVerificationInStore(this.ctx.storage, input);
  }

  // Platform Stripe reconciliation: strongly typed Durable Object RPC methods.
  listStripePaymentReconciliationCandidates(input: {
    readonly cursor?: PlatformStripeReconciliationCursor;
    readonly limit?: number | null | undefined;
    readonly organizationId: string;
    readonly paymentAttemptIds?: readonly string[] | undefined;
    readonly providerPaymentIds?: readonly string[] | undefined;
    readonly resourceIds?: readonly string[] | undefined;
    readonly snapshotAt?: string | undefined;
    readonly since?: string | null | undefined;
  }) {
    return listStripePaymentReconciliationCandidatesInStore(this.ctx.storage, input);
  }

  applyHistoricalStripeReconciliation(input: ApplyHistoricalStripeReconciliationInput) {
    return applyHistoricalStripeReconciliationInStore(this.ctx.storage, input);
  }

  startAudioLoudness(input: Parameters<typeof startLoudness>[1]) {
    return startLoudness(this.ctx.storage, input);
  }
  audioLoudnessStatus(input: { organizationId: string }) {
    return {
      statuses: loudnessStatus(this.ctx.storage, input.organizationId),
      failures: loudnessFailures(this.ctx.storage, input.organizationId),
    };
  }
  claimAudioLoudness(input: Parameters<typeof claimLoudness>[1]) {
    return claimLoudness(this.ctx.storage, input);
  }
  bindAudioLoudnessVersion(input: Parameters<typeof bindLoudnessVersion>[1]) {
    return bindLoudnessVersion(this.ctx.storage, input);
  }
  renewAudioLoudness(input: Parameters<typeof renewLoudness>[1]) {
    return renewLoudness(this.ctx.storage, input);
  }
  submitAudioLoudness(input: Parameters<typeof submitLoudness>[1]) {
    return submitLoudness(this.ctx.storage, input);
  }

  readPublicWebsiteSettings(input: { readonly organizationId: string }) {
    return readPublicWebsiteSettingsFromStore(this.ctx.storage, input.organizationId);
  }

  managePublicWebsite(input: z.infer<typeof publicWebsiteOperationSchema>) {
    return managePublicWebsiteOperationInStore(this.ctx.storage, input);
  }

  // Public website hosted documents: strongly typed Durable Object RPC methods.
  // Call via `stub.methodName(...)`; no internal fetch routing.
  listPublicWebsiteDocuments(input: { readonly organizationId: string }) {
    return listPublicWebsiteDocumentsInStore(this.ctx.storage, input);
  }

  createPublicWebsiteDocument(input: {
    readonly actorUserId: string;
    readonly documentId: string;
    readonly fileId: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly title: string;
  }) {
    return createPublicWebsiteDocumentInStore(this.ctx.storage, input);
  }

  updatePublicWebsiteDocument(input: {
    readonly actorUserId: string;
    readonly documentId: string;
    readonly fileId: string;
    readonly organizationId: string;
    readonly requestId: string;
    readonly title: string;
  }) {
    return updatePublicWebsiteDocumentInStore(this.ctx.storage, input);
  }

  deletePublicWebsiteDocument(input: {
    readonly actorUserId: string;
    readonly documentId: string;
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    return deletePublicWebsiteDocumentInStore(this.ctx.storage, input);
  }

  getPublicWebsiteDocumentForDownload(input: {
    readonly identifier: string;
    readonly organizationId: string;
  }) {
    return getPublicWebsiteDocumentForDownloadFromStore(this.ctx.storage, input);
  }

  async claimCommunicationDeliveryBatch(input: CommunicationBatchInput) {
    const parsed = communicationBatchInputSchema.parse(input);
    const response = readCommunicationJobFromStore(
      this.ctx.storage,
      parsed.organizationId,
      parsed.jobId,
    );
    if (!response.ok) throw new Error("communication_batch_unavailable");
    return deliveryJobResponseSchema.parse(await response.json());
  }

  checkCommunicationDelivery(input: CommunicationDeliveryCheckInput) {
    return checkCommunicationDelivery(this.ctx.storage, input);
  }

  async finishCommunicationDeliveryBatch(input: CommunicationBatchInput) {
    return finishCommunicationBatch(this.ctx.storage, input);
  }

  async readUpcomingPerformancesContext(input: UpcomingPerformancesContextInput) {
    const parsed = upcomingPerformancesContextInputSchema.parse(input);
    if (!communicationIdentityMatches(this.ctx.storage, parsed.organizationId)) {
      throw new Error("organization_not_found");
    }
    return Promise.resolve(
      queryUpcomingPerformancesForCommunication(this.ctx.storage, parsed.includeUnpublished),
    );
  }

  private async dispatchRpcCall(call: OrganizationRpcCall): Promise<OrganizationRpcResult> {
    const parsedCall = parseOrganizationRpcCall(call);
    if (!parsedCall) {
      return {
        error: {
          body: { code: "invalid_organization_rpc_call" },
          code: "invalid_organization_rpc_call",
          headers: { "content-type": "application/json" },
          status: 400,
        },
        ok: false,
      };
    }
    if (
      parsedCall.domain !== organizationRpcDomainForPath(parsedCall.path) ||
      parsedCall.operation !== organizationRpcOperationForPath(parsedCall.method, parsedCall.path)
    ) {
      return {
        error: {
          body: { code: "invalid_organization_rpc_operation" },
          code: "invalid_organization_rpc_operation",
          headers: { "content-type": "application/json" },
          status: 400,
        },
        ok: false,
      };
    }
    if (parsedCall.path !== "/internal/provision" && !this.rpcIdentityMatches(parsedCall)) {
      return {
        error: {
          body: { code: "organization_not_found" },
          code: "organization_identity_conflict",
          headers: { "content-type": "application/json" },
          status: 404,
        },
        ok: false,
      };
    }
    const url = new URL(`https://organization.internal${parsedCall.path}`);
    for (const [key, value] of Object.entries(parsedCall.query ?? {})) {
      url.searchParams.set(key, value);
    }
    const init: RequestInit = { method: parsedCall.method };
    if (parsedCall.body !== undefined) {
      init.body = JSON.stringify(parsedCall.body);
      init.headers = { "content-type": "application/json" };
    }
    const response = await this.dispatchHttpRequest(new Request(url, init));
    const contentType = response.headers.get("content-type") ?? "application/json";
    const body: unknown = contentType.toLowerCase().includes("json")
      ? await response.json().catch(() => null)
      : await response.text();
    if (!isOrganizationRpcValue(body)) {
      throw new Error("Organization RPC response must be JSON-serializable.");
    }
    if (!response.ok) {
      const code =
        isOrganizationRpcRecord(body) && typeof body.code === "string"
          ? body.code
          : "organization_rpc_error";
      return {
        error: { body, code, headers: responseHeaders(response), status: response.status },
        ok: false,
      };
    }
    return { headers: responseHeaders(response), ok: true, status: response.status, value: body };
  }

  private rpcIdentityMatches(call: OrganizationRpcCall): boolean {
    const storedOrganizationId = this.ctx.storage.sql
      .exec<{ readonly organizationId: string }>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.organizationId;
    if (!storedOrganizationId) return false;

    const requestedOrganizationIds: string[] = [];
    const queryOrganizationId = call.query?.organizationId;
    if (queryOrganizationId) requestedOrganizationIds.push(queryOrganizationId);
    if (isOrganizationRpcRecord(call.body) && typeof call.body.organizationId === "string") {
      requestedOrganizationIds.push(call.body.organizationId);
    }
    return (
      requestedOrganizationIds.length > 0 &&
      requestedOrganizationIds.every((organizationId) => organizationId === storedOrganizationId)
    );
  }

  private async dispatchHttpRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST") {
      const jobsQueue = requireBinding(this.env.JOBS_QUEUE, "JOBS_QUEUE");
      const response = await dispatchPostRequest(
        this.ctx.storage,
        jobsQueue,
        url.pathname,
        request,
      );
      if (response) {
        if (response.ok && isAlarmWakePath(url.pathname)) {
          await wakeOrganizationAlarm(this.ctx.storage);
        }
        return response;
      }
    }
    if (request.method === "GET") {
      const response = dispatchGetRequest(this.ctx.storage, url);
      if (response) return response;
    }
    return Response.json({ code: "not_found" }, { status: 404 });
  }

  override async alarm(): Promise<void> {
    try {
      await runOrganizationAlarm(
        this.ctx.storage,
        requireBinding(this.env.JOBS_QUEUE, "JOBS_QUEUE"),
      );
    } finally {
      clearUnsuccessfulEventReminderMarkers(this.ctx.storage);
    }
  }
}
