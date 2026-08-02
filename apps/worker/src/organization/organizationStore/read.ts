import {
  listOrganizationEventsFromStore,
  readOrganizationDashboardSummaryFromStore,
  readEventRsvpExportFromStore,
  listEventAttendanceFromStore,
  listEventRsvpHistoryFromStore,
  listMemberEventsFromStore,
  listProfileFolderNumbersFromStore,
  listProfilePerformanceHistoryFromStore,
  listOrganizationVenuesFromStore,
  readOrganizationCalendarSettingsFromStore,
  readProfileEventRsvpFromStore,
  readRosterConfigurationFromStore,
} from "../calendarManagementStore";
import { listProfileStatusHistoryFromStore } from "../statusAutomationStore";
import { readPlayerDetailsFromStore, readPlayerPlaylistFromStore } from "../playerStore";
import { readPracticePlayerLinkFromStore } from "../playerLinkStore";
import {
  readAuditionFromStore,
  readPublicAuditionSettingsFromStore,
  readAuditionSettingsFromStore,
  listAuditionsFromStore,
  readAuditionNotificationJobFromStore,
} from "../auditionStore";
import { readOrganizationExportJobFromStore, readOrganizationExportSnapshot } from "../exportStore";
import {
  listPollsFromStore,
  listArchivedPollsFromStore,
  readPollFromStore,
  readProfilePollFromStore,
} from "../pollStore";
import { listMusicPiecesFromStore, readMusicLibrarySettingsFromStore } from "../musicStore";
import { listResourcesFromStore } from "../resourceStore";
import {
  listCommunicationMessagesFromStore,
  listMemberBulletinsFromStore,
  listCommunicationScheduledMessagesFromStore,
  listCommunicationTemplatesFromStore,
  readCommunicationTemplateFromStore,
  manageCommunicationInStore,
  readCommunicationJobFromStore,
  readCommunicationSummaryFromStore,
  resolveCommunicationAudienceFromStore,
  unsubscribeCommunicationProfileInStore,
} from "../communicationStore";
import {
  listSeatingChartsFromStore,
  readSeatingConfigurationFromStore,
  readSingerSeatingFromStore,
} from "../seatingStore";
import {
  managePublicWebsiteInStore,
  readPublicCommerceProjectionFromStore,
  readPublicWebsiteSettingsFromStore,
} from "../publicWebsiteStore";
import {
  listTicketBundlesFromStore,
  listTicketOrdersFromStore,
  readTicketNotificationJobFromStore,
  readTicketPurchaseFromStore,
  readTicketWillCallFromStore,
} from "../ticketingStore";
import {
  listDonationsFromStore,
  listPatronsFromStore,
  readDonationFromStore,
} from "../donationStore";
import { readDonationSettingsFromStore } from "../donationSettingsStore";
import { readTransactionFeeSettingsFromStore } from "../transactionFeeSettingsStore";
import { readTicketConfirmationSettingsFromStore } from "../ticketConfirmationSettingsStore";
import { getSetupStateFromStore, getModuleStateFromStore } from "../setupStore";
import { readPaymentSettingsFromStore } from "../paymentSettingsStore";
import { readEventReminderJobFromStore, readRsvpFollowUpJobFromStore } from "../schedulingStore";
import { readPaymentNotificationJobFromStore } from "../paymentNotificationStore";
import { readPaymentRefundTargetFromStore } from "../paymentRefundStore";
import {
  listSeasonsFromStore,
  listDuesFromStore,
  readMemberActiveSeasonFromStore,
} from "../seasonStore";
import { readStripeConnectStatusFromStore } from "../stripeConnectStore";
import { readOrganizationReconciliationReport } from "../reconciliationStore";

import {
  getProfileIdentity,
  listProfiles,
  readMemberProfile,
  listDirectoryProfiles,
  createProfile,
  importProfiles,
  updateProfile,
  deleteProfile,
  updateMemberProfile,
  manageProfilePhoto,
} from "./profiles";

import {
  reservePrivateFile,
  finalizePrivateFile,
  abortPrivateFile,
  claimPrivateFileReclamation,
  finishPrivateFileReclamation,
  abortPrivateFileReclamation,
  getPrivateFileMetadata,
} from "./files";

export const contentGetHandlers: Record<
  string,
  (storage: DurableObjectStorage, url: URL, organizationId: string | null) => Response | null
> = {
  "/internal/resources": (storage, _url, organizationId) =>
    listResourcesFromStore(storage, organizationId),
  "/internal/communications": (storage, _url, organizationId) =>
    listCommunicationMessagesFromStore(storage, organizationId),
  "/internal/communications/member-bulletins": (storage, url, organizationId) =>
    listMemberBulletinsFromStore(storage, {
      organizationId,
      profileId: url.searchParams.get("profileId"),
    }),
  "/internal/communications/scheduled": (storage, _url, organizationId) =>
    listCommunicationScheduledMessagesFromStore(storage, organizationId),
  "/internal/communications/templates": (storage, _url, organizationId) =>
    listCommunicationTemplatesFromStore(storage, organizationId),
  "/internal/communications/template": (storage, url, organizationId) =>
    readCommunicationTemplateFromStore(storage, organizationId, url.searchParams.get("templateId")),
  "/internal/communications/summary": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) =>
    readCommunicationSummaryFromStore(storage, organizationId, url.searchParams.get("messageId")),
  "/internal/communications/job": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readCommunicationJobFromStore(storage, organizationId, url.searchParams.get("jobId")),
  "/internal/export/snapshot": (storage, _url, organizationId) =>
    readExportSnapshot(storage, organizationId),
  "/internal/export/job": (storage, url, organizationId) =>
    readOrganizationExportJobFromStore(storage, organizationId, url.searchParams.get("exportId")),
  "/internal/website/settings": (storage, _url, organizationId) =>
    readPublicWebsiteSettingsFromStore(storage, organizationId),
  "/internal/website/commerce-projection": (storage, _url, organizationId) =>
    readPublicCommerceProjectionFromStore(storage, organizationId),
  "/internal/polls": (storage, _url, organizationId) => listPollsFromStore(storage, organizationId),
  "/internal/polls/archived": (storage, _url, organizationId) =>
    listArchivedPollsFromStore(storage, organizationId),
  "/internal/polls/poll": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readPollFromStore(storage, organizationId, url.searchParams.get("pollId")),
  "/internal/polls/profile-poll": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) =>
    readProfilePollFromStore(storage, {
      organizationId,
      pollId: url.searchParams.get("pollId"),
      profileId: url.searchParams.get("profileId"),
    }),
  "/internal/ticketing/orders": (storage, _url, organizationId) =>
    listTicketOrdersFromStore(storage, organizationId),
  "/internal/ticketing/bundles": (storage, _url, organizationId) =>
    listTicketBundlesFromStore(storage, organizationId),
  "/internal/ticketing/purchase": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readTicketPurchaseFromStore(storage, organizationId, url.searchParams.get("purchaseId")),
  "/internal/ticketing/will-call": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readTicketWillCallFromStore(storage, organizationId, url.searchParams.get("eventId")),
  "/internal/ticketing/notification-job": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readTicketNotificationJobFromStore(storage, organizationId, url.searchParams.get("jobId")),
  "/internal/audition/notification-job": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readAuditionNotificationJobFromStore(storage, organizationId, url.searchParams.get("jobId")),
  "/internal/donations/list": (storage, _url, organizationId) =>
    listDonationsFromStore(storage, organizationId),
  "/internal/donations/patrons": (storage, _url, organizationId) =>
    listPatronsFromStore(storage, organizationId),
  "/internal/donations/donation": (storage, url, organizationId) =>
    readDonationFromStore(storage, organizationId, url.searchParams.get("donationId")),
  "/internal/payments/refund-target": (storage, url, organizationId) =>
    readPaymentRefundTargetFromStore(
      storage,
      organizationId,
      url.searchParams.get("paymentType"),
      url.searchParams.get("resourceId"),
    ),
  "/internal/payments/notification-job": (storage, url, organizationId) =>
    readPaymentNotificationJobFromStore(storage, organizationId, url.searchParams.get("jobId")),
  "/internal/scheduling/event-reminder-job": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readEventReminderJobFromStore(storage, organizationId, url.searchParams.get("jobId")),
  "/internal/scheduling/rsvp-follow-up-job": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readRsvpFollowUpJobFromStore(storage, organizationId, url.searchParams.get("jobId")),
  "/internal/player/details": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) =>
    readPlayerDetailsFromStore(
      storage,
      organizationId,
      url.searchParams.get("eventId"),
      url.searchParams.get("profileId"),
    ),
  "/internal/player/playlist": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readPlayerPlaylistFromStore(storage, organizationId, url.searchParams.get("eventId")),
  "/internal/player/public-link": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) =>
    readPracticePlayerLinkFromStore(storage, {
      eventId: url.searchParams.get("eventId"),
      nonce: url.searchParams.get("nonce"),
      organizationId,
    }),
  "/internal/audition/details": (
    storage: DurableObjectStorage,
    url: URL,
    organizationId: string | null,
  ) => readAuditionFromStore(storage, organizationId, url.searchParams.get("auditionId") ?? ""),
  "/internal/seasons/list": (storage, _url, organizationId) =>
    listSeasonsFromStore(storage, organizationId),
  "/internal/seasons/dues": (storage, _url, organizationId) =>
    listDuesFromStore(storage, organizationId),
  "/internal/seasons/member-active": (storage, url, organizationId) =>
    readMemberActiveSeasonFromStore(storage, {
      organizationId,
      profileId: url.searchParams.get("profileId"),
    }),
};

export function dispatchContentGetRequest(
  storage: DurableObjectStorage,
  url: URL,
  organizationId: string | null,
): Response | null {
  const handler = contentGetHandlers[url.pathname];
  return handler ? handler(storage, url, organizationId) : null;
}

export async function dispatchWebsitePostRequest(
  storage: DurableObjectStorage,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  return pathname === "/internal/website/manage"
    ? managePublicWebsiteInStore(storage, request)
    : null;
}

export async function dispatchCommunicationPostRequest(
  storage: DurableObjectStorage,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  if (pathname === "/internal/communications/audience") {
    return resolveCommunicationAudienceFromStore(storage, request);
  }
  if (pathname === "/internal/communications/manage") {
    return manageCommunicationInStore(storage, request);
  }
  if (pathname === "/internal/communications/unsubscribe") {
    return unsubscribeCommunicationProfileInStore(storage, request);
  }
  return null;
}

export async function dispatchPrivateFilePostRequest(
  storage: DurableObjectStorage,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  switch (pathname) {
    case "/internal/files/abort":
      return abortPrivateFile(storage, request);
    case "/internal/files/ready":
      return finalizePrivateFile(storage, request);
    case "/internal/files/reserve":
      return reservePrivateFile(storage, request);
    case "/internal/files/reclaim":
      return claimPrivateFileReclamation(storage, request);
    case "/internal/files/reclaim-abort":
      return abortPrivateFileReclamation(storage, request);
    case "/internal/files/reclaimed":
      return finishPrivateFileReclamation(storage, request);
    default:
      return null;
  }
}

export async function dispatchProfilePostRequest(
  storage: DurableObjectStorage,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  switch (pathname) {
    case "/internal/profiles":
      return createProfile(storage, request);
    case "/internal/profiles/member-update":
      return updateMemberProfile(storage, request);
    case "/internal/profiles/photo":
      return manageProfilePhoto(storage, request);
    case "/internal/profiles/import":
      return importProfiles(storage, request);
    case "/internal/profiles/update":
      return updateProfile(storage, request);
    case "/internal/profiles/delete":
      return deleteProfile(storage, request);
    default:
      return null;
  }
}

export function dispatchProfileGetRequest(
  storage: DurableObjectStorage,
  url: URL,
  organizationId: string | null,
): Response | null {
  switch (url.pathname) {
    case "/internal/profiles":
      return listProfiles(storage, organizationId);
    case "/internal/profiles/directory":
      return listDirectoryProfiles(storage, organizationId);
    case "/internal/profiles/member":
      return readMemberProfile(storage, organizationId, url.searchParams.get("profileId"));
    case "/internal/profiles/status-history":
      return listProfileStatusHistoryFromStore(storage, {
        organizationId,
        profileId: url.searchParams.get("profileId"),
      });
  }
  const profileIdentityPrefix = "/internal/profiles/";
  return url.pathname.startsWith(profileIdentityPrefix)
    ? getProfileIdentity(storage, url.pathname.slice(profileIdentityPrefix.length))
    : null;
}

export function dispatchCalendarGetRequest(
  storage: DurableObjectStorage,
  url: URL,
  organizationId: string | null,
): Response | null {
  switch (url.pathname) {
    case "/internal/calendar/venues":
      return listOrganizationVenuesFromStore(storage, organizationId);
    case "/internal/calendar/events":
      return listOrganizationEventsFromStore(storage, organizationId);
    case "/internal/calendar/dashboard-summary":
      return readOrganizationDashboardSummaryFromStore(storage, organizationId);
    case "/internal/calendar/attendance":
      return listEventAttendanceFromStore(storage, {
        eventId: url.searchParams.get("eventId"),
        organizationId,
      });
    case "/internal/calendar/event-rsvp-history":
      return listEventRsvpHistoryFromStore(storage, {
        eventId: url.searchParams.get("eventId"),
        organizationId,
      });
    case "/internal/calendar/event-rsvp-export":
      return readEventRsvpExportFromStore(storage, {
        eventId: url.searchParams.get("eventId"),
        organizationId,
      });
    case "/internal/calendar/event-rsvp":
      return readProfileEventRsvpFromStore(storage, {
        eventId: url.searchParams.get("eventId"),
        organizationId,
        profileId: url.searchParams.get("profileId"),
      });
    case "/internal/calendar/settings":
      return readOrganizationCalendarSettingsFromStore(storage, organizationId);
    case "/internal/calendar/member-events":
      return listMemberEventsFromStore(storage, {
        organizationId,
        profileId: url.searchParams.get("profileId"),
        readAt: url.searchParams.get("readAt"),
      });
    case "/internal/calendar/profile-performance-history":
      return listProfilePerformanceHistoryFromStore(storage, {
        organizationId,
        profileId: url.searchParams.get("profileId"),
        readAt: url.searchParams.get("readAt"),
      });
    case "/internal/calendar/profile-folder-numbers":
      return listProfileFolderNumbersFromStore(storage, {
        organizationId,
        profileId: url.searchParams.get("profileId"),
      });
    default:
      return null;
  }
}

// The store's internal read routes intentionally share one dispatch point.
// eslint-disable-next-line complexity
export function dispatchGetRequest(storage: DurableObjectStorage, url: URL): Response | null {
  const organizationId = url.searchParams.get("organizationId");
  const profileResponse = dispatchProfileGetRequest(storage, url, organizationId);
  if (profileResponse) return profileResponse;
  const contentResponse = dispatchContentGetRequest(storage, url, organizationId);
  if (contentResponse) return contentResponse;
  const calendarResponse = dispatchCalendarGetRequest(storage, url, organizationId);
  if (calendarResponse) return calendarResponse;
  switch (url.pathname) {
    case "/internal/auditions/list":
      return listAuditionsFromStore(storage);
    case "/internal/audition/settings":
      return readAuditionSettingsFromStore(storage, organizationId);
    case "/internal/audition/public-settings":
      return readPublicAuditionSettingsFromStore(storage, organizationId);
    case "/internal/donations/settings":
      return readDonationSettingsFromStore(storage, organizationId);
    case "/internal/transaction-fee-settings":
      return readTransactionFeeSettingsFromStore(storage, organizationId);
    case "/internal/stripe-connect":
      return readStripeConnectStatusFromStore(storage, organizationId);
    case "/internal/payment-settings":
      return readPaymentSettingsFromStore(storage, organizationId);
    case "/internal/ticket-confirmation-settings":
      return readTicketConfirmationSettingsFromStore(storage, organizationId);
    case "/internal/reconciliation-report":
      return organizationId
        ? readOrganizationReconciliationReport(storage, organizationId)
        : Response.json({ code: "organization_identity_conflict" }, { status: 409 });
    case "/internal/roster/configuration":
      return readRosterConfigurationFromStore(storage, organizationId);
    case "/internal/seating/configuration":
      return readSeatingConfigurationFromStore(storage, organizationId);
    case "/internal/music/pieces":
      return listMusicPiecesFromStore(storage, organizationId);
    case "/internal/music/settings":
      return readMusicLibrarySettingsFromStore(storage, organizationId);
    case "/internal/seating/charts":
      return listSeatingChartsFromStore(storage, {
        eventId: url.searchParams.get("eventId"),
        organizationId,
      });
    case "/internal/seating/singer":
      return readSingerSeatingFromStore(storage, {
        chartId: url.searchParams.get("chartId"),
        eventId: url.searchParams.get("eventId"),
        organizationId,
        profileId: url.searchParams.get("profileId"),
      });
  }
  if (url.pathname === "/internal/setup/state") {
    return getSetupStateFromStore(storage, organizationId);
  }
  if (url.pathname === "/internal/setup/modules") {
    return getModuleStateFromStore(storage, organizationId);
  }
  const privateFilePrefix = "/internal/files/";
  if (url.pathname.startsWith(privateFilePrefix)) {
    return getPrivateFileMetadata(storage, url.pathname.slice(privateFilePrefix.length));
  }
  return null;
}

export function readExportSnapshot(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  try {
    return Response.json(readOrganizationExportSnapshot(storage, organizationId));
  } catch {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
}
