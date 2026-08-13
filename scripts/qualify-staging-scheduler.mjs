import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  qualificationSnapshot,
  qualificationSnapshotsMatch,
  summarizeCommunicationMessages,
  summarizeDeliverySummary,
  summarizeScheduledMessages,
} from "./staging-qualification-inspection.mjs";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const productHostname = new URL(productUrl).hostname;
const organizationSlug = (process.env.STAGING_ORG_SLUG ?? "lcc").trim().toLowerCase();
const wrongOrganizationSlug = (process.env.STAGING_SECOND_ORG_SLUG ?? "lmc").trim().toLowerCase();
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
const targetProfileId = process.env.STAGING_SCHEDULER_PROFILE_ID?.trim() ?? "";
const targetProfilePrefix = (
  process.env.STAGING_SCHEDULER_PROFILE_PREFIX ?? "Qualification Queue Temp 2026-08-12"
).trim();
const reportProfileId = process.env.STAGING_SCHEDULER_REPORT_PROFILE_ID?.trim() ?? "";
const organizationHost = `https://${organizationSlug}.${productHostname}`;
const wrongOrganizationHost = `https://${wrongOrganizationSlug}.${productHostname}`;
const pollingAttempts = 24;
const pollingDelayMs = 2_500;
const planOnly = process.argv.includes("--plan-only");

if (!/^[a-z0-9-]+$/.test(organizationSlug) || !/^[a-z0-9-]+$/.test(wrongOrganizationSlug)) {
  throw new Error("Organization slugs must contain only lowercase letters, numbers, or hyphens.");
}
if (organizationSlug === wrongOrganizationSlug) {
  throw new Error("The wrong-Organization host must be different from the target host.");
}
if (!targetProfileId && targetProfilePrefix.length === 0) {
  throw new Error("Set STAGING_SCHEDULER_PROFILE_ID or STAGING_SCHEDULER_PROFILE_PREFIX.");
}

function uuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
  return value;
}

if (targetProfileId) uuid(targetProfileId, "STAGING_SCHEDULER_PROFILE_ID");
if (reportProfileId) uuid(reportProfileId, "STAGING_SCHEDULER_REPORT_PROFILE_ID");

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sessionCookieFrom(response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""];
  return setCookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

function requestFailure(status, body) {
  const code =
    typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
      ? body.code
      : null;
  return `HTTP ${String(status)}${code ? ` (${code})` : ""}`;
}

export function schedulerQualificationPlan(profileId = "<qualification-profile-id>") {
  return [
    "sign in and verify the fresh Platform Administrator factor in memory",
    `resolve exactly one active, voice-part, reachable Profile (${profileId}) without printing its email`,
    "create one future Performance and linked Rehearsal inside the 48-hour event-reminder horizon; RSVP only the parent Performance Yes",
    "run canonical-LCC maintenance and prove each event_reminder uses the parent Performance RSVP roster and has one sent delivery",
    "run maintenance again and prove both reminder snapshots are idempotently unchanged",
    "create one past Performance with the same controlled RSVP and Present attendance row",
    "run canonical-LCC maintenance and prove one attendance_report communication with the expected 1-of-1 aggregate",
    "run maintenance again and prove the attendance-report snapshot is idempotently unchanged",
    "prove LMC cannot read the scheduled rows, messages, or delivery summaries",
    "archive all qualification-owned Performance/Rehearsal fixtures and print only safe IDs, counts, and statuses",
  ];
}

export function safeSchedulerQualificationSummary(input) {
  return {
    cleanupCompleted: input.cleanupCompleted === true,
    crossOrganizationRejected: input.crossOrganizationRejected === true,
    eventReminder: {
      communicationCount: input.eventReminder?.communicationCount ?? 0,
      deliveryState: input.eventReminder?.deliveryState ?? "unknown",
      eventId: input.eventReminder?.eventId ?? null,
      jobCount: input.eventReminder?.jobCount ?? 0,
      messageId: input.eventReminder?.messageId ?? null,
      reach: input.eventReminder?.reach ?? 0,
      replayStable: input.eventReminder?.replayStable === true,
    },
    rehearsalParent: {
      communicationCount: input.rehearsalParent?.communicationCount ?? 0,
      deliveryState: input.rehearsalParent?.deliveryState ?? "unknown",
      eventId: input.rehearsalParent?.eventId ?? null,
      jobCount: input.rehearsalParent?.jobCount ?? 0,
      messageId: input.rehearsalParent?.messageId ?? null,
      parentRosterApplied: input.rehearsalParent?.parentRosterApplied === true,
      reach: input.rehearsalParent?.reach ?? 0,
      replayStable: input.rehearsalParent?.replayStable === true,
    },
    postEventReport: {
      aggregateMatched: input.postEventReport?.aggregateMatched === true,
      communicationCount: input.postEventReport?.communicationCount ?? 0,
      deliveryState: input.postEventReport?.deliveryState ?? "unknown",
      eventId: input.postEventReport?.eventId ?? null,
      jobCount: input.postEventReport?.jobCount ?? 0,
      messageId: input.postEventReport?.messageId ?? null,
      reach: input.postEventReport?.reach ?? 0,
      replayStable: input.postEventReport?.replayStable === true,
    },
    profileId: input.profileId ?? null,
  };
}

export function schedulerBoundaryStatusesRejected(statuses) {
  return statuses.every((status) => status === 401 || status === 403 || status === 404);
}

function responseContainsTargetSchedulerData(body, messageIds, eventIds) {
  if (!Array.isArray(body?.messages)) return true;
  const targetMessageIds = new Set(messageIds);
  const targetEventIds = new Set(eventIds);
  return body.messages.some((message) => {
    if (typeof message?.id === "string" && targetMessageIds.has(message.id)) return true;
    if (typeof message?.eventId === "string" && targetEventIds.has(message.eventId)) return true;
    return (
      typeof message?.audience?.eventId === "string" && targetEventIds.has(message.audience.eventId)
    );
  });
}

export function schedulerBoundaryResponsesSafe(responses, messageIds, eventIds) {
  const collectionResponses = responses.slice(0, 2);
  const detailStatuses = responses.slice(2).map(({ status }) => status);
  const collectionsAreSafe = collectionResponses.every(({ status, body }) => {
    if (status === 401 || status === 403 || status === 404) return true;
    return status === 200 && !responseContainsTargetSchedulerData(body, messageIds, eventIds);
  });
  return collectionsAreSafe && schedulerBoundaryStatusesRejected(detailStatuses);
}

async function request(url, method, cookie, body) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      origin: new URL(url).origin,
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    },
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const responseText = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    // Do not retain or print unexpected response bodies.
  }
  return { body: parsed, response };
}

async function prompt(readline, message) {
  return (await readline.question(message)).trim();
}

async function signIn(readline) {
  const otpRequest = await request(
    `${productUrl}/api/auth/email-otp/send-verification-otp`,
    "POST",
    "",
    { email, type: "sign-in" },
  );
  if (otpRequest.response.status !== 200) {
    throw new Error(`Sign-in code request failed with HTTP ${String(otpRequest.response.status)}.`);
  }
  console.log(`A sign-in code was requested for ${email}.`);
  const code = await prompt(readline, "Enter the six-digit sign-in code (not recorded): ");
  if (!/^\d{6}$/.test(code)) throw new Error("The sign-in code must contain exactly six digits.");
  const signInResponse = await request(`${productUrl}/api/auth/sign-in/email-otp`, "POST", "", {
    email,
    otp: code,
  });
  if (!signInResponse.response.ok) {
    throw new Error(`Sign-in request failed with HTTP ${String(signInResponse.response.status)}.`);
  }
  const cookie = sessionCookieFrom(signInResponse.response);
  if (!cookie.includes("choir-management.session_token=")) {
    throw new Error("The sign-in response did not return a staging session cookie.");
  }
  return cookie;
}

async function verifyPlatformFactor(readline, cookie) {
  const status = await request(`${productUrl}/api/platform/mfa/status`, "GET", cookie);
  if (status.response.status !== 200) {
    throw new Error(`Platform MFA status failed with HTTP ${String(status.response.status)}.`);
  }
  const code = await prompt(
    readline,
    "Enter the six-digit Platform authenticator code (not recorded): ",
  );
  if (!/^\d{6}$/.test(code)) {
    throw new Error("The Platform authenticator code must contain exactly six digits.");
  }
  const verification = await request(`${productUrl}/api/platform/mfa/verify`, "POST", cookie, {
    code,
    method: "totp",
  });
  if (verification.response.status !== 200) {
    throw new Error(
      `Platform MFA verification failed with HTTP ${String(verification.response.status)}.`,
    );
  }
}

async function resolveOrganizationId(cookie) {
  const result = await request(`${organizationHost}/api/organization/context`, "GET", cookie);
  if (result.response.status !== 200 || typeof result.body?.organizationId !== "string") {
    throw new Error(`Organization context failed with HTTP ${String(result.response.status)}.`);
  }
  return uuid(result.body.organizationId, "Organization ID");
}

async function listProfiles(cookie) {
  const result = await request(`${organizationHost}/api/organization/profiles`, "GET", cookie);
  if (result.response.status !== 200 || !Array.isArray(result.body?.profiles)) {
    throw new Error(
      `Profile list failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.profiles;
}

async function listMemberships(cookie) {
  const result = await request(`${organizationHost}/api/organization/members`, "GET", cookie);
  if (result.response.status !== 200 || !Array.isArray(result.body?.memberships)) {
    throw new Error(
      `Organization membership list failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.memberships;
}

function resolveTargetProfile(profiles) {
  const matches = profiles.filter(
    (profile) =>
      typeof profile?.id === "string" &&
      (targetProfileId
        ? profile.id === targetProfileId
        : typeof profile?.displayName === "string" &&
          profile.displayName.startsWith(targetProfilePrefix)),
  );
  if (matches.length !== 1) {
    throw new Error(
      targetProfileId
        ? "STAGING_SCHEDULER_PROFILE_ID did not resolve to exactly one Organization Profile."
        : `Expected exactly one Profile matching ${targetProfilePrefix}; found ${String(matches.length)}. Set STAGING_SCHEDULER_PROFILE_ID explicitly.`,
    );
  }
  const profile = matches[0];
  if (profile.globalStatus !== "Active") throw new Error("Scheduler Profile is not Active.");
  if (typeof profile.voicePart !== "string" || profile.voicePart.trim() === "") {
    throw new Error("Scheduler Profile has no assigned voice part.");
  }
  if (profile.doNotEmail === true || profile.providerEmailSuppressed === true) {
    throw new Error("Scheduler Profile is suppressed for email.");
  }
  return { ...profile, id: uuid(profile.id, "Scheduler Profile") };
}

function profileAudience(profileId) {
  return {
    eventId: null,
    globalStatuses: ["Active"],
    profileIds: [profileId],
    rsvp: "All",
    targetAudiences: ["Members"],
    voiceParts: [],
  };
}

export function schedulerProfileReachFailure(
  profile,
  memberships,
  reach,
  label = "Scheduler Profile",
) {
  const linkedMemberships = memberships.filter(
    (membership) => membership?.profileId === profile?.id,
  );
  const linkedMembershipsWithEmail = linkedMemberships.filter(
    (membership) => typeof membership?.email === "string" && membership.email.trim() !== "",
  );
  const reasons = [
    `reach preview returned ${String(reach?.total ?? "an unknown number")} recipients`,
  ];

  if (linkedMemberships.length === 0) {
    reasons.push("no Organization Membership is currently linked to the selected Profile");
  } else if (linkedMembershipsWithEmail.length === 0) {
    reasons.push("the linked Organization Membership has no email address");
  } else if (reach?.total === 0) {
    if (typeof profile?.voicePart !== "string" || profile.voicePart.trim() === "") {
      reasons.push("the Profile has no assigned voice part");
    } else {
      reasons.push(
        "the Profile may be excluded by an active communication suppression or a configured track-only voice-part audience rule",
      );
    }
  }

  if (profile?.doNotEmail === true) reasons.push("Profile is marked do-not-email");
  if (profile?.providerEmailSuppressed === true) {
    reasons.push("Profile has a provider email suppression");
  }

  return `${label} must resolve to exactly one email recipient: ${reasons.join("; ")}.`;
}

export function validateAttendanceReportRecipient(reportRecipient, profiles) {
  const profile = profiles.find((candidate) => candidate?.id === reportRecipient?.profileId);
  const reasons = [];
  if (!profile) reasons.push("the linked Profile could not be found");
  if (typeof reportRecipient?.email !== "string" || reportRecipient.email.trim() === "") {
    reasons.push("the linked Organization Membership has no email address");
  }
  if (profile?.globalStatus !== "Active") reasons.push("the Profile is not Active");
  if (profile?.receiveAttendanceReports !== true) {
    reasons.push("attendance reports are not enabled for the Profile");
  }
  if (profile?.doNotEmail === true) reasons.push("Profile is marked do-not-email");
  if (profile?.providerEmailSuppressed === true) {
    reasons.push("Profile has a provider email suppression");
  }
  if (reasons.length > 0) {
    throw new Error(
      `Attendance-report Profile must resolve to exactly one email recipient: ${reasons.join("; ")}.`,
    );
  }
  return profile;
}

async function previewProfileReach(cookie, profile, memberships, label = "Scheduler Profile") {
  const result = await request(
    `${organizationHost}/api/organization/communications/reach-preview`,
    "POST",
    cookie,
    { audience: profileAudience(profile.id), channel: "Email" },
  );
  if (
    result.response.status !== 200 ||
    typeof result.body?.total !== "number" ||
    typeof result.body?.email !== "number"
  ) {
    throw new Error(
      `Profile reach preview failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  if (result.body.total !== 1 || result.body.email !== 1) {
    throw new Error(schedulerProfileReachFailure(profile, memberships, result.body, label));
  }
  return result.body;
}

function resolveReportRecipient(profiles, memberships) {
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const candidates = memberships.filter((membership) => {
    if (!membership.profileId || !["owner", "administrator"].includes(membership.role)) {
      return false;
    }
    const profile = profileMap.get(membership.profileId);
    return (
      profile?.globalStatus === "Active" &&
      profile.receiveAttendanceReports === true &&
      profile.doNotEmail === false &&
      profile.providerEmailSuppressed === false
    );
  });
  if (reportProfileId) {
    const selected = candidates.filter(({ profileId }) => profileId === reportProfileId);
    if (selected.length !== 1) {
      throw new Error(
        "STAGING_SCHEDULER_REPORT_PROFILE_ID is not the sole eligible report Profile.",
      );
    }
    if (candidates.length !== 1) {
      throw new Error(
        `Attendance reports currently have ${String(candidates.length)} eligible recipients; configure only the qualification recipient before running this fixture.`,
      );
    }
    return selected[0];
  }
  const currentAccountCandidates = candidates.filter(
    ({ email: memberEmail }) =>
      typeof memberEmail === "string" && memberEmail.trim().toLowerCase() === email,
  );
  if (candidates.length !== 1 || currentAccountCandidates.length !== 1) {
    throw new Error(
      `Attendance reports require exactly one eligible report recipient linked to ${email}; found ${String(candidates.length)}. Set STAGING_SCHEDULER_REPORT_PROFILE_ID only after configuring the recipient.`,
    );
  }
  return currentAccountCandidates[0];
}

function eventRequest(title, startsAt, options = {}) {
  return {
    advancePriceCents: 0,
    callTime: "",
    dayOfPriceCents: 0,
    details: "Controlled scheduler qualification fixture.",
    doorsOpenTime: "",
    durationMinutes: 60,
    isTicketingEnabled: false,
    location: "Qualification only",
    parentPerformanceId: options.parentPerformanceId ?? null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: false,
    rsvpFollowUpLeadHours: null,
    rsvpFollowUpMode: "inherit",
    setList: [],
    setListApproved: false,
    startsAt,
    ticketCapacity: null,
    title,
    type: options.type ?? "Performance",
    venueId: null,
  };
}

function fixtureTitle(kind) {
  const suffix = crypto.randomUUID().slice(0, 8);
  return `QUAL-${new Date().toISOString().slice(0, 10)}-${suffix} ${kind}`;
}

async function createEvent(cookie, title, startsAt, options = {}) {
  const result = await request(
    `${organizationHost}/api/organization/events`,
    "POST",
    cookie,
    eventRequest(title, startsAt, options),
  );
  if (result.response.status !== 201 || typeof result.body?.id !== "string") {
    throw new Error(
      `Performance creation failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return uuid(result.body.id, "Performance ID");
}

async function archiveEvent(cookie, eventId) {
  const result = await request(
    `${organizationHost}/api/organization/events/${encodeURIComponent(eventId)}`,
    "DELETE",
    cookie,
  );
  if (result.response.status !== 200) {
    throw new Error(
      `Performance archive failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
}

async function setRsvp(cookie, eventId, profileId) {
  const result = await request(
    `${organizationHost}/api/organization/events/${encodeURIComponent(eventId)}/rsvp`,
    "PUT",
    cookie,
    { profileId, rsvp: "Yes", rsvpNote: "" },
  );
  if (result.response.status !== 200 || result.body?.eventId !== eventId) {
    throw new Error(
      `Performance RSVP failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
}

async function setAttendance(cookie, eventId, profileId) {
  const result = await request(
    `${organizationHost}/api/organization/events/${encodeURIComponent(eventId)}/attendance`,
    "PUT",
    cookie,
    { updates: [{ attendance: "Present", profileId }] },
  );
  if (result.response.status !== 200 || !Array.isArray(result.body?.rows)) {
    throw new Error(
      `Performance attendance update failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  const row = result.body.rows.find((candidate) => candidate?.profileId === profileId);
  if (row?.attendance !== "Present" || row?.rsvp !== "Yes") {
    throw new Error("The qualification attendance row did not persist Present/Yes.");
  }
}

async function readRsvpHistory(cookie, eventId) {
  const result = await request(
    `${organizationHost}/api/organization/events/${encodeURIComponent(eventId)}/rsvp-history`,
    "GET",
    cookie,
  );
  if (result.response.status !== 200 || !Array.isArray(result.body?.entries)) {
    throw new Error(
      `RSVP history inspection failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.entries;
}

async function runMaintenance(cookie) {
  const result = await request(`${organizationHost}/api/platform/maintenance/run`, "GET", cookie);
  if (
    result.response.status !== 200 ||
    result.body?.success !== true ||
    typeof result.body?.organizationId !== "string" ||
    !Number.isInteger(result.body?.enqueuedJobCount)
  ) {
    throw new Error(
      `Staging maintenance failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.enqueuedJobCount;
}

async function inspectEvents(cookie, eventIds) {
  const [scheduled, communications] = await Promise.all([
    request(`${organizationHost}/api/organization/communications/scheduled`, "GET", cookie),
    request(`${organizationHost}/api/organization/communications`, "GET", cookie),
  ]);
  if (scheduled.response.status !== 200 || !Array.isArray(scheduled.body?.messages)) {
    throw new Error(
      `Scheduled communication inspection failed with ${requestFailure(scheduled.response.status, scheduled.body)}.`,
    );
  }
  if (communications.response.status !== 200 || !Array.isArray(communications.body?.messages)) {
    throw new Error(
      `Communication inspection failed with ${requestFailure(communications.response.status, communications.body)}.`,
    );
  }
  const scheduledSummary = summarizeScheduledMessages(scheduled.body.messages, eventIds);
  const communicationSummary = summarizeCommunicationMessages(
    communications.body.messages,
    eventIds,
  );
  const deliveries = [];
  for (const message of communicationSummary.rows) {
    const delivery = await request(
      `${organizationHost}/api/organization/communications/${encodeURIComponent(message.id)}/delivery-summary`,
      "GET",
      cookie,
    );
    if (delivery.response.status !== 200 || !delivery.body) {
      throw new Error(
        `Delivery inspection failed with ${requestFailure(delivery.response.status, delivery.body)}.`,
      );
    }
    deliveries.push({
      messageId: message.id,
      status: message.status,
      summary: summarizeDeliverySummary(delivery.body),
    });
  }
  const messages = communications.body.messages
    .filter((message) => {
      const eventId = message?.audience?.eventId;
      return typeof eventId === "string" && eventIds.includes(eventId);
    })
    .map((message) => ({
      contentMarkdown: typeof message.contentMarkdown === "string" ? message.contentMarkdown : "",
      id: typeof message.id === "string" ? message.id : "",
    }));
  return {
    communications: communicationSummary,
    deliveries,
    messages,
    scheduled: scheduledSummary,
  };
}

function reportAggregateMatched(state) {
  return state.messages.some(
    ({ contentMarkdown }) =>
      /Attendance rate:\s*\*\*100%\*\*/.test(contentMarkdown) &&
      /Present:\s*1\s*\/\s*1/.test(contentMarkdown),
  );
}

function eventDeliveryReady(state, kind, expectReportAggregate = false) {
  const scheduledRows = state.scheduled.rows.filter((row) => row.kind === kind);
  if (scheduledRows.length !== 1 || scheduledRows[0].status !== "Sent") return false;
  const communications = state.communications.rows;
  if (
    communications.length !== 1 ||
    communications[0].channel !== "Email" ||
    communications[0].status !== "Sent" ||
    communications[0].reachTotal !== 1
  ) {
    return false;
  }
  const delivery = state.deliveries[0];
  if (
    !delivery ||
    delivery.summary.state !== "sent" ||
    delivery.summary.emailSent !== 1 ||
    delivery.summary.emailTotal !== 1 ||
    delivery.summary.totalSent !== 1 ||
    delivery.summary.total !== 1
  ) {
    return false;
  }
  return !expectReportAggregate || reportAggregateMatched(state);
}

async function waitForEventDelivery(cookie, eventId, kind, expectReportAggregate = false) {
  for (let attempt = 0; attempt < pollingAttempts; attempt += 1) {
    if (attempt === 0 || (attempt + 1) % 3 === 0) {
      console.log(`WAIT ${kind} (${String(attempt + 1)}/${String(pollingAttempts)})`);
    }
    const state = await inspectEvents(cookie, [eventId]);
    if (eventDeliveryReady(state, kind, expectReportAggregate)) return state;
    if (attempt < pollingAttempts - 1) await sleep(pollingDelayMs);
  }
  throw new Error(`${kind} did not reach exactly-once sent state in time.`);
}

async function wrongOrganizationBoundary(cookie, messageIds) {
  const responses = await Promise.all([
    request(`${wrongOrganizationHost}/api/organization/communications/scheduled`, "GET", cookie),
    request(`${wrongOrganizationHost}/api/organization/communications`, "GET", cookie),
    ...messageIds.map((messageId) =>
      request(
        `${wrongOrganizationHost}/api/organization/communications/${encodeURIComponent(messageId)}/delivery-summary`,
        "GET",
        cookie,
      ),
    ),
  ]);
  return responses.map(({ body, response }) => ({ body, status: response.status }));
}

function eventResult(eventId, first, replay, kind, reportAggregate) {
  const firstSnapshot = qualificationSnapshot(
    first.scheduled,
    first.communications,
    first.deliveries,
  );
  const replaySnapshot = qualificationSnapshot(
    replay.scheduled,
    replay.communications,
    replay.deliveries,
  );
  const delivery = first.deliveries[0];
  return {
    aggregateMatched: reportAggregate,
    communicationCount: first.communications.total,
    deliveryState: delivery?.summary.state ?? "unknown",
    eventId,
    jobCount: first.scheduled.rows.filter((row) => row.kind === kind).length,
    messageId: first.communications.rows[0]?.id ?? null,
    reach: first.communications.rows[0]?.reachTotal ?? 0,
    replayStable: qualificationSnapshotsMatch(firstSnapshot, replaySnapshot),
  };
}

function linkedRehearsalUsesParentRoster(state, rehearsalRsvpHistory) {
  return (
    rehearsalRsvpHistory.length === 0 &&
    state.communications.rows.length === 1 &&
    state.communications.rows[0].channel === "Email" &&
    state.communications.rows[0].reachTotal === 1
  );
}

async function main() {
  if (planOnly) {
    for (const step of schedulerQualificationPlan(targetProfileId || targetProfilePrefix)) {
      console.log(`- ${step}`);
    }
    return;
  }

  const readline = createInterface({ input, output });
  let cookie = null;
  const createdEventIds = [];
  let cleanupCompleted = true;
  let summary;
  try {
    cookie = await signIn(readline);
    await verifyPlatformFactor(readline, cookie);
    const organizationId = await resolveOrganizationId(cookie);
    const profiles = await listProfiles(cookie);
    const memberships = await listMemberships(cookie);
    const targetProfile = resolveTargetProfile(profiles);
    const targetReach = await previewProfileReach(cookie, targetProfile, memberships);
    console.log("PASS one reachable scheduler Profile preflight");
    const reportRecipient = resolveReportRecipient(profiles, memberships);
    validateAttendanceReportRecipient(reportRecipient, profiles);
    console.log("PASS one eligible attendance-report recipient preflight");

    const preflightEnqueuedJobCount = await runMaintenance(cookie);
    console.log(
      `PASS scheduler maintenance preflight — ${String(preflightEnqueuedJobCount)} job(s) enqueued`,
    );

    const reminderEventId = await createEvent(
      cookie,
      fixtureTitle("event reminder"),
      new Date(Date.now() + 36 * 60 * 60 * 1_000).toISOString(),
    );
    createdEventIds.push(reminderEventId);
    const rehearsalEventId = await createEvent(
      cookie,
      fixtureTitle("linked rehearsal reminder"),
      new Date(Date.now() + 37 * 60 * 60 * 1_000).toISOString(),
      { parentPerformanceId: reminderEventId, type: "Rehearsal" },
    );
    createdEventIds.push(rehearsalEventId);
    await setRsvp(cookie, reminderEventId, targetProfile.id);
    console.log(`PASS event-reminder Performance created (${reminderEventId})`);
    console.log(`PASS linked rehearsal created (${rehearsalEventId})`);
    console.log("PASS event-reminder controlled RSVP Yes");
    const reminderEnqueuedJobCount = await runMaintenance(cookie);
    console.log(
      `PASS event-reminder maintenance — ${String(reminderEnqueuedJobCount)} job(s) enqueued`,
    );
    const reminderFirst = await waitForEventDelivery(cookie, reminderEventId, "event_reminder");
    console.log("PASS event reminder scheduled job and sent delivery");
    const rehearsalFirst = await waitForEventDelivery(cookie, rehearsalEventId, "event_reminder");
    const rehearsalRsvpHistory = await readRsvpHistory(cookie, rehearsalEventId);
    const rehearsalParentRosterApplied = linkedRehearsalUsesParentRoster(
      rehearsalFirst,
      rehearsalRsvpHistory,
    );
    if (!rehearsalParentRosterApplied) {
      throw new Error("Linked rehearsal reminder did not use the parent Performance RSVP roster.");
    }
    console.log("PASS linked rehearsal reminder used the parent Performance RSVP roster");
    const reminderReplayMaintenance = await runMaintenance(cookie);
    const reminderReplay = await inspectEvents(cookie, [reminderEventId]);
    const rehearsalReplay = await inspectEvents(cookie, [rehearsalEventId]);
    const reminderResult = eventResult(
      reminderEventId,
      reminderFirst,
      reminderReplay,
      "event_reminder",
      false,
    );
    const rehearsalResult = eventResult(
      rehearsalEventId,
      rehearsalFirst,
      rehearsalReplay,
      "event_reminder",
      false,
    );
    rehearsalResult.parentRosterApplied = rehearsalParentRosterApplied;
    if (!reminderResult.replayStable || !rehearsalResult.replayStable)
      throw new Error("Event reminder replay changed delivery counts.");
    console.log(
      `PASS event-reminder idempotency — ${String(reminderReplayMaintenance)} job(s) enqueued on replay`,
    );
    console.log("PASS linked rehearsal reminder idempotency");

    const reportEventId = await createEvent(
      cookie,
      fixtureTitle("post-event report"),
      new Date(Date.now() - 13 * 60 * 60 * 1_000).toISOString(),
    );
    createdEventIds.push(reportEventId);
    await setRsvp(cookie, reportEventId, targetProfile.id);
    await setAttendance(cookie, reportEventId, targetProfile.id);
    console.log(`PASS post-event-report Performance created (${reportEventId})`);
    console.log("PASS post-event-report controlled RSVP Yes and Present attendance");
    const reportEnqueuedJobCount = await runMaintenance(cookie);
    console.log(
      `PASS post-event-report maintenance — ${String(reportEnqueuedJobCount)} job(s) enqueued`,
    );
    const reportFirst = await waitForEventDelivery(
      cookie,
      reportEventId,
      "attendance_report",
      true,
    );
    console.log("PASS post-event attendance report aggregate and sent delivery");
    const reportReplayMaintenance = await runMaintenance(cookie);
    const reportReplay = await inspectEvents(cookie, [reportEventId]);
    const reportResult = eventResult(
      reportEventId,
      reportFirst,
      reportReplay,
      "attendance_report",
      reportAggregateMatched(reportFirst),
    );
    if (!reportResult.replayStable) {
      throw new Error("Attendance-report replay changed delivery counts.");
    }
    console.log(
      `PASS post-event-report idempotency — ${String(reportReplayMaintenance)} job(s) enqueued on replay`,
    );

    const messageIds = [
      reminderResult.messageId,
      rehearsalResult.messageId,
      reportResult.messageId,
    ].filter((messageId) => typeof messageId === "string");
    const boundaryResponses = await wrongOrganizationBoundary(cookie, messageIds);
    const boundaryStatuses = boundaryResponses.map(({ status }) => status);
    const crossOrganizationRejected = schedulerBoundaryResponsesSafe(
      boundaryResponses,
      messageIds,
      [reminderEventId, rehearsalEventId, reportEventId],
    );
    console.log(
      `${crossOrganizationRejected ? "PASS" : "FAIL"} scheduler cross-Organization boundary (HTTP ${boundaryStatuses.join("/")}; target data absent)`,
    );
    if (!crossOrganizationRejected) {
      throw new Error(
        "The scheduler rows or delivery summaries were accessible on the wrong Organization host.",
      );
    }

    summary = safeSchedulerQualificationSummary({
      cleanupCompleted: false,
      crossOrganizationRejected,
      eventReminder: reminderResult,
      rehearsalParent: rehearsalResult,
      postEventReport: reportResult,
      profileId: targetProfile.id,
      targetReach,
      organizationId,
    });
  } finally {
    if (cookie) {
      for (const eventId of [...createdEventIds].reverse()) {
        try {
          await archiveEvent(cookie, eventId);
        } catch {
          cleanupCompleted = false;
          console.error("Scheduler qualification event cleanup did not complete.");
        }
      }
    } else if (createdEventIds.length > 0) {
      cleanupCompleted = false;
    }
    readline.close();
  }

  if (!summary) throw new Error("Scheduler qualification did not produce a result.");
  summary.cleanupCompleted = cleanupCompleted;
  if (!cleanupCompleted)
    throw new Error("Scheduler qualification fixture cleanup did not complete.");
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
