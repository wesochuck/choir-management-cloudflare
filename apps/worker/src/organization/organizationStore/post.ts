import { z } from "zod";
import {
  organizationAuditionCreateRequestSchema,
  organizationAuditionSettingsSchema,
  organizationAuditionUpdateRequestSchema,
} from "@choir/contracts";
import { type DeliveryJob } from "../../jobs/contracts";
import { manageOrganizationCalendarInStore } from "../calendarManagementStore";
import { readRosterAutomationPreviewFromStore } from "../statusAutomationStore";
import { runOrganizationAlarm } from "../scheduler";
import {
  createAuditionInStore,
  deleteAuditionInStore,
  readAuditionFromStore,
  listAuditionsFromStore,
  updateAuditionInStore,
  updateAuditionSettingsInStore,
  auditionSlotsAreConfigured,
  recordAuditionNotificationResult,
} from "../auditionStore";
import {
  completeOrganizationExportInStore,
  createOrganizationExportInStore,
  failOrganizationExportInStore,
} from "../exportStore";
import { managePollInStore } from "../pollStore";
import { manageMusicInStore } from "../musicStore";
import { manageResourceInStore } from "../resourceStore";
import { manageSeatingInStore } from "../seatingStore";
import { manageTicketingInStore } from "../ticketingStore";
import { manageDonationsInStore } from "../donationStore";
import { manageSetupInStore } from "../setupStore";
import { updatePaymentActivationInStore } from "../paymentSettingsStore";
import { prepareAttendanceReportJobFromStore } from "../schedulingStore";
import { recordPaymentDisputeInStore } from "../paymentDisputeStore";
import { expireStalePaymentsInStore } from "../paymentCleanupStore";
import {
  queuePaymentNotificationInStore,
  recordPaymentNotificationResultInStore,
} from "../paymentNotificationStore";
import { recordProviderRefundRequestedInStore } from "../paymentRefundStore";
import { manageSeasonsInStore } from "../seasonStore";
import { upsertStripeConnectAccountInStore } from "../stripeConnectStore";

import {
  provisionOrganizationStore,
  claimJob,
  completeJob,
  failJob,
  terminalJob,
  prepareOrganizationSchema,
} from "./provision";

import {
  donationSettingsUpdateHandler,
  transactionFeeSettingsUpdateHandler,
  ticketConfirmationSettingsUpdateHandler,
  manageCalendarCredential,
  validateCalendarFeed,
} from "./audit";

import {
  dispatchWebsitePostRequest,
  dispatchCommunicationPostRequest,
  dispatchPrivateFilePostRequest,
  dispatchProfilePostRequest,
} from "./read";

// eslint-disable-next-line complexity -- dispatches the bounded internal mutation union without changing its routing semantics.
export async function dispatchPostRequest(
  storage: DurableObjectStorage,
  queue: Queue<DeliveryJob>,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  const profileResponse = await dispatchProfilePostRequest(storage, pathname, request);
  if (profileResponse) return profileResponse;
  const fileResponse = await dispatchPrivateFilePostRequest(storage, pathname, request);
  if (fileResponse) return fileResponse;
  const communicationResponse = await dispatchCommunicationPostRequest(storage, pathname, request);
  if (communicationResponse) return communicationResponse;
  const websiteResponse = await dispatchWebsitePostRequest(storage, pathname, request);
  if (websiteResponse) return websiteResponse;
  if (pathname === "/internal/ticketing/manage") return manageTicketingInStore(storage, request);
  if (pathname === "/internal/donations/settings") {
    return donationSettingsUpdateHandler(storage, request);
  }
  if (pathname === "/internal/transaction-fee-settings") {
    return transactionFeeSettingsUpdateHandler(storage, request);
  }
  if (pathname === "/internal/stripe-connect") {
    return upsertStripeConnectAccountInStore(storage, request);
  }
  if (pathname === "/internal/payment-settings") {
    return updatePaymentActivationInStore(storage, await request.json().catch(() => null));
  }
  if (pathname === "/internal/payments/manage") {
    return recordPaymentDisputeInStore(storage, await request.json().catch(() => null));
  }
  if (pathname === "/internal/payments/cleanup") {
    return expireStalePaymentsInStore(storage, await request.json().catch(() => null));
  }
  if (pathname === "/internal/payments/refund-request") {
    return recordProviderRefundRequestedInStore(storage, await request.json().catch(() => null));
  }
  if (pathname === "/internal/payments/notification") {
    return queuePaymentNotificationInStore(storage, await request.json().catch(() => null));
  }
  if (pathname === "/internal/payments/notification-result") {
    return recordPaymentNotificationResultInStore(storage, await request.json().catch(() => null));
  }
  if (pathname === "/internal/ticket-confirmation-settings") {
    return ticketConfirmationSettingsUpdateHandler(storage, request);
  }
  if (pathname === "/internal/donations/manage") return manageDonationsInStore(storage, request);
  if (pathname === "/internal/seasons/manage") return manageSeasonsInStore(storage, request);
  if (pathname === "/internal/setup/manage") return manageSetupInStore(storage, request);
  if (pathname === "/internal/polls/manage") return managePollInStore(storage, request);
  if (pathname === "/internal/roster/automation-preview") {
    const body: unknown = await request.json().catch(() => null);
    const parsed = z.looseObject({ organizationId: z.string().min(1).max(128) }).safeParse(body);
    return parsed.success
      ? readRosterAutomationPreviewFromStore(storage, parsed.data.organizationId, parsed.data)
      : Response.json({ code: "invalid_roster_automation_preview" }, { status: 400 });
  }
  if (pathname === "/internal/scheduling/attendance-report-prepare") {
    const body: unknown = await request.json().catch(() => null);
    const parsed = z
      .object({
        jobId: z.uuid(),
        organizationId: z.string().min(1).max(128),
      })
      .safeParse(body);
    return parsed.success
      ? prepareAttendanceReportJobFromStore(storage, parsed.data.organizationId, parsed.data.jobId)
      : Response.json({ code: "invalid_attendance_report_request" }, { status: 400 });
  }
  if (pathname === "/internal/scheduler/run-now") {
    const body: unknown = await request.json().catch(() => null);
    const parsed = z.object({ organizationId: z.string().min(1).max(128) }).safeParse(body);
    if (!parsed.success) {
      return Response.json({ code: "invalid_scheduler_request" }, { status: 400 });
    }
    const identityRow = storage.sql
      .exec<{ readonly [column: string]: SqlStorageValue; readonly organizationId: string }>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0);
    if (identityRow?.organizationId !== parsed.data.organizationId) {
      return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
    }
    const result = await runOrganizationAlarm(storage, queue);
    return Response.json({ ...result, ranAt: new Date().toISOString() });
  }
  return dispatchOperationalPostRequest(storage, pathname, request);
}

export async function auditionCreateHandler(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = organizationAuditionCreateRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ code: "validation_failed" }, { status: 400 });
  }
  if (
    parsed.data.performanceId &&
    storage.sql
      .exec(
        "SELECT 1 FROM events WHERE id = ? AND type = 'Performance' AND is_archived = 0 AND is_canceled = 0 LIMIT 1",
        parsed.data.performanceId,
      )
      .toArray().length === 0
  ) {
    return Response.json({ code: "performance_not_found" }, { status: 400 });
  }
  if (!auditionSlotsAreConfigured(storage, parsed.data.requestedSlots)) {
    return Response.json({ code: "invalid_audition_slot" }, { status: 400 });
  }
  const context = z.object({ actorUserId: z.string().min(1), requestId: z.uuid() }).safeParse(raw);
  const id = createAuditionInStore(
    storage,
    {
      availabilityNotes: parsed.data.availabilityNotes ?? "",
      email: parsed.data.email,
      experience: parsed.data.experience ?? "",
      name: parsed.data.name,
      performanceId: parsed.data.performanceId ?? null,
      phone: parsed.data.phone ?? "",
      requestedSlots: parsed.data.requestedSlots,
      scheduledTimeSlot: parsed.data.scheduledTimeSlot ?? null,
      status: parsed.data.status,
      voicePart: parsed.data.voicePart ?? "",
    },
    context.success ? context.data : undefined,
  );
  return readAuditionFromStore(storage, null, id);
}

export interface AuditionUpdatePayload {
  readonly actor?: { readonly actorUserId: string; readonly requestId: string };
  readonly input: {
    readonly adminNotes?: string;
    readonly availabilityNotes?: string;
    readonly email?: string;
    readonly experience?: string;
    readonly name?: string;
    readonly performanceId?: string | null;
    readonly phone?: string;
    readonly requestedSlots?: readonly string[];
    readonly scheduledTimeSlot?: string | null;
    readonly status?: string;
    readonly voicePart?: string;
  };
}

export function auditionInputFromParsed(
  data: z.infer<typeof organizationAuditionUpdateRequestSchema>,
): AuditionUpdatePayload["input"] {
  const input: {
    adminNotes?: string;
    availabilityNotes?: string;
    email?: string;
    experience?: string;
    name?: string;
    performanceId?: string | null;
    phone?: string;
    requestedSlots?: readonly string[];
    scheduledTimeSlot?: string | null;
    status?: string;
    voicePart?: string;
  } = {};
  if (data.adminNotes !== undefined) input.adminNotes = data.adminNotes;
  if (data.availabilityNotes !== undefined) input.availabilityNotes = data.availabilityNotes;
  if (data.email !== undefined) input.email = data.email;
  if (data.experience !== undefined) input.experience = data.experience;
  if (data.name !== undefined) input.name = data.name;
  if (data.performanceId !== undefined) input.performanceId = data.performanceId;
  if (data.phone !== undefined) input.phone = data.phone;
  if (data.requestedSlots !== undefined) input.requestedSlots = data.requestedSlots;
  if (data.scheduledTimeSlot !== undefined) input.scheduledTimeSlot = data.scheduledTimeSlot;
  if (data.status !== undefined) input.status = data.status;
  if (data.voicePart !== undefined) input.voicePart = data.voicePart;
  return input;
}

export function parseAuditionUpdatePayload(raw: unknown, url: URL): AuditionUpdatePayload {
  const parsedBody = organizationAuditionUpdateRequestSchema.safeParse(raw);
  const actor = z.object({ actorUserId: z.string().min(1), requestId: z.uuid() }).safeParse(raw);
  if (parsedBody.success) {
    return {
      ...(actor.success ? { actor: actor.data } : {}),
      input: auditionInputFromParsed(parsedBody.data),
    };
  }
  const availabilityNotes = url.searchParams.get("availabilityNotes") ?? undefined;
  const voicePart = url.searchParams.get("voicePart") ?? undefined;
  if (availabilityNotes !== undefined || voicePart !== undefined) {
    return {
      input: {
        ...(availabilityNotes === undefined ? {} : { availabilityNotes }),
        ...(voicePart === undefined ? {} : { voicePart }),
      },
    };
  }
  const adminNotes = url.searchParams.get("adminNotes") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  return {
    input: {
      ...(adminNotes === undefined ? {} : { adminNotes }),
      ...(status === undefined ? {} : { status }),
    },
  };
}

export async function auditionUpdateHandler(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const auditionId = url.searchParams.get("auditionId") ?? "";
  const payload = parseAuditionUpdatePayload(await request.json().catch(() => null), url);
  return updateAuditionInStore(storage, auditionId, payload.input, payload.actor);
}

export async function auditionSettingsUpdateHandler(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = organizationAuditionSettingsSchema.safeParse(raw);
  const context = z
    .object({
      actorUserId: z.string().min(1),
      organizationId: z.string().min(1),
      requestId: z.uuid(),
    })
    .safeParse(raw);
  if (!parsed.success || !context.success)
    return Response.json({ code: "validation_failed" }, { status: 400 });
  return updateAuditionSettingsInStore(storage, context.data.organizationId, parsed.data, {
    actorUserId: context.data.actorUserId,
    requestId: context.data.requestId,
  });
}

export async function auditionDeleteHandler(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const body = z
    .object({
      actorUserId: z.string().min(1),
      auditionId: z.string().min(1),
      requestId: z.uuid(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ code: "validation_failed" }, { status: 400 });
  return deleteAuditionInStore(storage, body.data.auditionId, {
    actorUserId: body.data.actorUserId,
    requestId: body.data.requestId,
  });
}

export async function auditionNotificationResultHandler(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const body = z
    .object({
      failureDetail: z.string().max(2_000).default(""),
      jobId: z.uuid(),
      organizationId: z.string().min(1),
      providerMessageId: z.string().max(512).nullable(),
      status: z.enum(["failed", "sent", "suppressed"]),
    })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ code: "validation_failed" }, { status: 400 });
  return recordAuditionNotificationResult(storage, body.data.organizationId, body.data);
}

export async function dispatchAuditionPostRequest(
  storage: DurableObjectStorage,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  switch (pathname) {
    case "/internal/audition/update":
      return auditionUpdateHandler(storage, request);
    case "/internal/audition/create":
      return auditionCreateHandler(storage, request);
    case "/internal/audition/delete":
      return auditionDeleteHandler(storage, request);
    case "/internal/audition/settings":
      return auditionSettingsUpdateHandler(storage, request);
    case "/internal/audition/notification-result":
      return auditionNotificationResultHandler(storage, request);
    case "/internal/export/create":
      return createOrganizationExportInStore(storage, await request.json().catch(() => null));
    case "/internal/export/complete":
      return completeOrganizationExportInStore(storage, await request.json().catch(() => null));
    case "/internal/export/fail":
      return failOrganizationExportInStore(storage, await request.json().catch(() => null));
    case "/internal/auditions/list":
      return listAuditionsFromStore(storage);
    default:
      return null;
  }
}

export async function dispatchOperationalPostRequest(
  storage: DurableObjectStorage,
  pathname: string,
  request: Request,
): Promise<Response | null> {
  const auditionResponse = await dispatchAuditionPostRequest(storage, pathname, request);
  if (auditionResponse) return auditionResponse;
  switch (pathname) {
    case "/internal/jobs/claim":
      return claimJob(storage, request);
    case "/internal/jobs/complete":
      return completeJob(storage, request);
    case "/internal/jobs/fail":
      return failJob(storage, request);
    case "/internal/jobs/terminal":
      return terminalJob(storage, request);
    case "/internal/calendar/credential":
      return manageCalendarCredential(storage, request);
    case "/internal/calendar/feed":
      return validateCalendarFeed(storage, request);
    case "/internal/calendar/manage":
      return manageOrganizationCalendarInStore(storage, request);
    case "/internal/seating/manage":
      return manageSeatingInStore(storage, request);
    case "/internal/music/manage":
      return manageMusicInStore(storage, request);
    case "/internal/resources/manage":
      return manageResourceInStore(storage, request);
    case "/internal/provision":
      return provisionOrganizationStore(storage, request);
    case "/internal/schema/prepare":
      return prepareOrganizationSchema(storage, request);
    default:
      return null;
  }
}
