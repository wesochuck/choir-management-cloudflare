import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const productHostname = new URL(productUrl).hostname;
const organizationSlug = (process.env.STAGING_ORG_SLUG ?? "lcc").trim().toLowerCase();
const wrongOrganizationSlug = (process.env.STAGING_SECOND_ORG_SLUG ?? "lmc").trim().toLowerCase();
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
const targetProfileId = process.env.STAGING_STATUS_AUTOMATION_PROFILE_ID?.trim() ?? "";
const targetProfilePrefix = process.env.STAGING_STATUS_AUTOMATION_PROFILE_PREFIX?.trim() ?? "";
const onBreakProfileId = process.env.STAGING_STATUS_AUTOMATION_ON_BREAK_PROFILE_ID?.trim() ?? "";
const organizationHost = `https://${organizationSlug}.${productHostname}`;
const wrongOrganizationHost = `https://${wrongOrganizationSlug}.${productHostname}`;
const planOnly = process.argv.includes("--plan-only");

if (!/^[a-z0-9-]+$/.test(organizationSlug) || !/^[a-z0-9-]+$/.test(wrongOrganizationSlug)) {
  throw new Error("Organization slugs must contain only lowercase letters, numbers, or hyphens.");
}
if (organizationSlug === wrongOrganizationSlug) {
  throw new Error("The wrong-Organization host must be different from the target host.");
}

function uuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
  return value;
}

function requestFailure(status, body) {
  const code =
    typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
      ? body.code
      : null;
  return `HTTP ${String(status)}${code ? ` (${code})` : ""}`;
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

export function rosterAutomationQualificationPlan() {
  return [
    "sign in and resolve one explicitly selected performer Profile without printing its email",
    "resolve one non-manual Idle performer whose existing status age is eligible for the On Break timeout",
    "capture the Profile and roster-automation settings without changing existing Organization configuration",
    "create the configured number of ended Performance fixtures with controlled No RSVPs",
    "preview and run roster automation, proving the Profile becomes Inactive with a system status-history entry",
    "set one future Performance RSVP to Yes and prove automation recovers the Profile to Active",
    "create one future Performance whose RSVP deadline has passed and prove the pending RSVP expires to No",
    "record Present attendance at a linked Rehearsal and prove the parent Performance RSVP is reconciled to Yes",
    "prove the wrong Organization host cannot read the qualification Profile or fixture events",
    "archive every qualification-owned event, restore the qualification Profiles, and print bounded results",
  ];
}

export function rosterAutomationBoundaryResponsesSafe(responses, profileId, eventIds) {
  const [profiles, events, history] = responses;
  const profileTarget = (body) =>
    Array.isArray(body?.profiles) && body.profiles.some((profile) => profile?.id === profileId);
  const eventTarget = (body) =>
    Array.isArray(body?.events) && body.events.some((event) => eventIds.includes(event?.id));
  const collectionSafe = (result, containsTarget) =>
    result.status === 401 ||
    result.status === 403 ||
    result.status === 404 ||
    (result.status === 200 && !containsTarget(result.body));
  return (
    collectionSafe(profiles, profileTarget) &&
    collectionSafe(events, eventTarget) &&
    (history.status === 401 || history.status === 403 || history.status === 404)
  );
}

export function safeRosterAutomationQualificationSummary(input) {
  return {
    attendanceReconciled: input.attendanceReconciled === true,
    cleanupCompleted: input.cleanupCompleted === true,
    crossOrganizationRejected: input.crossOrganizationRejected === true,
    expiredRsvp: input.expiredRsvp === true,
    futureRecovery: input.futureRecovery === true,
    inactiveAfterMisses: input.inactiveAfterMisses === true,
    onBreakTimeout: input.onBreakTimeout === true,
    previewMatched: input.previewMatched === true,
    profileId: input.profileId ?? null,
    qualificationEventCount: input.qualificationEventCount ?? 0,
  };
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

async function resolveOrganizationId(cookie) {
  const result = await request(`${organizationHost}/api/organization/context`, "GET", cookie);
  if (result.response.status !== 200 || typeof result.body?.organizationId !== "string") {
    throw new Error(
      `Organization context failed with ${requestFailure(result.response.status, result.body)}.`,
    );
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

function resolveTargetProfile(profiles) {
  if (!targetProfileId && !targetProfilePrefix) {
    throw new Error(
      "Set STAGING_STATUS_AUTOMATION_PROFILE_ID to an existing performer Profile before running this qualification.",
    );
  }
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
        ? "STAGING_STATUS_AUTOMATION_PROFILE_ID did not resolve to exactly one Organization Profile."
        : `Expected exactly one Profile matching ${targetProfilePrefix}; found ${String(matches.length)}.`,
    );
  }
  const profile = matches[0];
  if (typeof profile.voicePart !== "string" || profile.voicePart.trim() === "") {
    throw new Error("The selected status-automation Profile must have an assigned voice part.");
  }
  return { ...profile, id: uuid(profile.id, "Status-automation Profile") };
}

function resolveOnBreakProfile(profiles, primaryProfileId) {
  const matches = profiles.filter(
    (profile) =>
      typeof profile?.id === "string" &&
      profile.id !== primaryProfileId &&
      (onBreakProfileId
        ? profile.id === onBreakProfileId
        : profile.globalStatus === "Idle" &&
          profile.statusIsManual === false &&
          typeof profile.voicePart === "string" &&
          profile.voicePart.trim() !== ""),
  );
  if (matches.length !== 1) {
    throw new Error(
      onBreakProfileId
        ? "STAGING_STATUS_AUTOMATION_ON_BREAK_PROFILE_ID did not resolve to exactly one other Profile."
        : "Set STAGING_STATUS_AUTOMATION_ON_BREAK_PROFILE_ID to exactly one existing non-manual Idle performer.",
    );
  }
  const profile = matches[0];
  if (profile.globalStatus !== "Idle" || profile.statusIsManual !== false) {
    throw new Error(
      "The On Break qualification Profile must currently be Idle with automation enabled.",
    );
  }
  if (typeof profile.voicePart !== "string" || profile.voicePart.trim() === "") {
    throw new Error("The On Break qualification Profile must have an assigned voice part.");
  }
  return { ...profile, id: uuid(profile.id, "On Break qualification Profile") };
}

function profileMutation(profile, overrides = {}) {
  return {
    doNotEmail: profile.doNotEmail === true,
    displayName: profile.displayName,
    globalStatus: profile.globalStatus,
    isSectionLeader: profile.isSectionLeader === true,
    notes: profile.notes ?? "",
    phone: profile.phone ?? "",
    receiveAdminNotifications: profile.receiveAdminNotifications !== false,
    receiveAttendanceReports: profile.receiveAttendanceReports !== false,
    receiveFinancialAlerts: profile.receiveFinancialAlerts === true,
    receiveRsvpDeclineNotices: profile.receiveRsvpDeclineNotices === true,
    showInDirectory: profile.showInDirectory !== false,
    statusIsManual: profile.statusIsManual === true,
    voicePart: profile.voicePart,
    ...overrides,
  };
}

async function updateProfile(cookie, profileId, profile) {
  const result = await request(
    `${organizationHost}/api/organization/profiles/${encodeURIComponent(profileId)}`,
    "PUT",
    cookie,
    profile,
  );
  if (result.response.status !== 200 || result.body?.id !== profileId) {
    throw new Error(
      `Profile update failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body;
}

async function readRosterConfiguration(cookie) {
  const result = await request(
    `${organizationHost}/api/organization/roster-configuration`,
    "GET",
    cookie,
  );
  if (result.response.status !== 200 || typeof result.body !== "object" || result.body === null) {
    throw new Error(
      `Roster configuration read failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  const configuration = { ...result.body };
  delete configuration.requestId;
  return configuration;
}

function eventRequest(title, startsAt, options = {}) {
  return {
    advancePriceCents: 0,
    callTime: "",
    dayOfPriceCents: 0,
    details: "Controlled roster automation qualification fixture.",
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

async function createEvent(cookie, title, startsAt, options = {}) {
  const result = await request(
    `${organizationHost}/api/organization/events`,
    "POST",
    cookie,
    eventRequest(title, startsAt, options),
  );
  if (result.response.status !== 201 || typeof result.body?.id !== "string") {
    throw new Error(
      `Event creation failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return uuid(result.body.id, "Qualification event ID");
}

async function archiveEvent(cookie, eventId) {
  const result = await request(
    `${organizationHost}/api/organization/events/${encodeURIComponent(eventId)}`,
    "DELETE",
    cookie,
  );
  if (result.response.status !== 200) {
    throw new Error(
      `Event archive failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
}

async function setRsvp(cookie, eventId, profileId, rsvp) {
  const result = await request(
    `${organizationHost}/api/organization/events/${encodeURIComponent(eventId)}/rsvp`,
    "PUT",
    cookie,
    { profileId, rsvp, rsvpNote: "" },
  );
  if (result.response.status !== 200 || result.body?.eventId !== eventId) {
    throw new Error(
      `RSVP update failed with ${requestFailure(result.response.status, result.body)}.`,
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
      `Attendance update failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  const row = result.body.rows.find((candidate) => candidate?.profileId === profileId);
  if (row?.attendance !== "Present" || row?.rsvp !== "Yes") {
    throw new Error("Present attendance did not reconcile the rehearsal RSVP to Yes.");
  }
}

async function readAttendance(cookie, eventId, profileId) {
  const result = await request(
    `${organizationHost}/api/organization/events/${encodeURIComponent(eventId)}/attendance`,
    "GET",
    cookie,
  );
  if (result.response.status !== 200 || !Array.isArray(result.body?.rows)) {
    throw new Error(
      `Attendance read failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.rows.find((candidate) => candidate?.profileId === profileId) ?? null;
}

async function readStatusHistory(cookie, profileId) {
  const result = await request(
    `${organizationHost}/api/organization/profiles/${encodeURIComponent(profileId)}/status-history`,
    "GET",
    cookie,
  );
  if (result.response.status !== 200 || !Array.isArray(result.body?.entries)) {
    throw new Error(
      `Status history read failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.entries;
}

async function readRsvpHistory(cookie, eventId) {
  const result = await request(
    `${organizationHost}/api/organization/events/${encodeURIComponent(eventId)}/rsvp-history`,
    "GET",
    cookie,
  );
  if (result.response.status !== 200 || !Array.isArray(result.body?.entries)) {
    throw new Error(
      `RSVP history read failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.entries;
}

async function runMaintenance(cookie) {
  const result = await request(`${organizationHost}/api/platform/maintenance/run`, "GET", cookie);
  if (
    result.response.status !== 200 ||
    result.body?.success !== true ||
    !Number.isInteger(result.body?.enqueuedJobCount)
  ) {
    throw new Error(
      `Staging maintenance failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.enqueuedJobCount;
}

async function preview(cookie, configuration, profileId) {
  const result = await request(
    `${organizationHost}/api/organization/roster-configuration/preview`,
    "POST",
    cookie,
    { configuration, profileId },
  );
  if (result.response.status !== 200 || typeof result.body?.selectedProfile !== "object") {
    throw new Error(
      `Roster automation preview failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body;
}

async function readProfile(cookie, profileId) {
  const profiles = await listProfiles(cookie);
  const profile = profiles.find((candidate) => candidate?.id === profileId);
  if (!profile)
    throw new Error("The selected status-automation Profile disappeared from the roster.");
  return profile;
}

async function inspectBoundary(cookie, profileId, eventIds) {
  const responses = await Promise.all([
    request(`${wrongOrganizationHost}/api/organization/profiles`, "GET", cookie),
    request(`${wrongOrganizationHost}/api/organization/events`, "GET", cookie),
    request(
      `${wrongOrganizationHost}/api/organization/profiles/${encodeURIComponent(profileId)}/status-history`,
      "GET",
      cookie,
    ),
  ]);
  return rosterAutomationBoundaryResponsesSafe(
    responses.map(({ response, body }) => ({ status: response.status, body })),
    profileId,
    eventIds,
  );
}

function fixtureTitle(kind) {
  return `QUAL-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)} ${kind}`;
}

function futureRsvpExpiryStart(now, leadDays) {
  if (!Number.isInteger(leadDays) || leadDays < 1) {
    throw new Error("The Organization RSVP expiry lead time is invalid.");
  }
  return new Date(now + Math.max(2 * 60 * 60 * 1_000, (leadDays - 1) * 86_400_000));
}

async function main() {
  const plan = rosterAutomationQualificationPlan();
  if (planOnly) {
    for (const [index, step] of plan.entries()) console.log(`${String(index + 1)}. ${step}`);
    return;
  }

  const readline = createInterface({ input, output });
  let cookie = "";
  let profile = null;
  let onBreakProfile = null;
  const eventIds = [];
  const summary = {
    attendanceReconciled: false,
    cleanupCompleted: false,
    crossOrganizationRejected: false,
    expiredRsvp: false,
    futureRecovery: false,
    inactiveAfterMisses: false,
    onBreakTimeout: false,
    previewMatched: false,
    profileId: null,
    qualificationEventCount: 0,
  };

  try {
    cookie = await signIn(readline);
    await resolveOrganizationId(cookie);
    const profiles = await listProfiles(cookie);
    profile = resolveTargetProfile(profiles);
    onBreakProfile = resolveOnBreakProfile(profiles, profile.id);
    summary.profileId = profile.id;
    const controlledConfiguration = await readRosterConfiguration(cookie);
    if (!controlledConfiguration.statusAutomationEnabled) {
      throw new Error("Roster status automation is disabled in the target Organization.");
    }
    if (!controlledConfiguration.statusAutomationRecoveryEnabled) {
      throw new Error("Roster status automation recovery is disabled in the target Organization.");
    }
    if (!controlledConfiguration.rsvpExpiryEnabled) {
      throw new Error("Roster RSVP expiry is disabled in the target Organization.");
    }
    if (
      !Number.isInteger(controlledConfiguration.statusAutomationMissThreshold) ||
      controlledConfiguration.statusAutomationMissThreshold < 1
    ) {
      throw new Error("The Organization status-automation miss threshold is invalid.");
    }
    const onBreakPreview = await preview(cookie, controlledConfiguration, onBreakProfile.id);
    const onBreakPredicted =
      onBreakPreview.selectedProfile?.nextStatus === "Inactive" &&
      onBreakPreview.selectedProfile?.nextStatusReason.startsWith("On Break has reached");
    console.log(`${onBreakPredicted ? "PASS" : "FAIL"} On Break timeout preview`);
    if (!onBreakPredicted) {
      throw new Error(
        "The selected Idle Profile has not reached the controlled one-day On Break timeout.",
      );
    }
    await runMaintenance(cookie);
    const onBreakAfter = await readProfile(cookie, onBreakProfile.id);
    const onBreakHistory = await readStatusHistory(cookie, onBreakProfile.id);
    summary.onBreakTimeout =
      onBreakAfter.globalStatus === "Inactive" &&
      onBreakHistory.some(
        (entry) =>
          entry?.newStatus === "Inactive" &&
          entry?.triggerType === "on_break_timeout" &&
          entry?.actorType === "system",
      );
    console.log(`${summary.onBreakTimeout ? "PASS" : "FAIL"} On Break timeout maintenance`);
    if (!summary.onBreakTimeout) {
      throw new Error(
        "The selected Idle Profile did not become Inactive through On Break automation.",
      );
    }
    await updateProfile(
      cookie,
      profile.id,
      profileMutation(profile, { globalStatus: "Active", statusIsManual: false }),
    );

    const now = Date.now();
    for (
      let index = 1;
      index <= controlledConfiguration.statusAutomationMissThreshold;
      index += 1
    ) {
      const eventId = await createEvent(
        cookie,
        fixtureTitle(`Missed Performance ${String(index)}`),
        new Date(now - index * 3 * 86_400_000).toISOString(),
      );
      eventIds.push(eventId);
      await setRsvp(cookie, eventId, profile.id, "No");
    }
    summary.qualificationEventCount = eventIds.length;

    const previewResult = await preview(cookie, controlledConfiguration, profile.id);
    summary.previewMatched =
      previewResult.selectedProfile?.nextStatus === "Inactive" &&
      previewResult.selectedProfile?.nextStatusReason.includes(
        `latest ${String(controlledConfiguration.statusAutomationMissThreshold)} ended Performances`,
      );
    console.log(`${summary.previewMatched ? "PASS" : "FAIL"} roster automation preview`);
    if (!summary.previewMatched)
      throw new Error(
        `Roster automation preview did not predict Inactive after ${String(controlledConfiguration.statusAutomationMissThreshold)} misses.`,
      );

    await runMaintenance(cookie);
    const inactiveProfile = await readProfile(cookie, profile.id);
    const inactiveHistory = await readStatusHistory(cookie, profile.id);
    summary.inactiveAfterMisses =
      inactiveProfile.globalStatus === "Inactive" &&
      inactiveHistory.some(
        (entry) =>
          entry?.newStatus === "Inactive" &&
          entry?.triggerType === "performance_miss" &&
          entry?.actorType === "system",
      );
    console.log(
      `${summary.inactiveAfterMisses ? "PASS" : "FAIL"} status automation after ${String(controlledConfiguration.statusAutomationMissThreshold)} missed Performances`,
    );
    if (!summary.inactiveAfterMisses)
      throw new Error("The Profile did not become Inactive through performance-miss automation.");

    const recoveryPerformance = await createEvent(
      cookie,
      fixtureTitle("Recovery Performance"),
      futureRsvpExpiryStart(now, controlledConfiguration.rsvpExpiryLeadDays).toISOString(),
    );
    eventIds.push(recoveryPerformance);
    await setRsvp(cookie, recoveryPerformance, profile.id, "Yes");
    await runMaintenance(cookie);
    const recoveredProfile = await readProfile(cookie, profile.id);
    const recoveryHistory = await readStatusHistory(cookie, profile.id);
    summary.futureRecovery =
      recoveredProfile.globalStatus === "Active" &&
      recoveryHistory.some(
        (entry) =>
          entry?.newStatus === "Active" &&
          entry?.triggerType === "future_performance_rsvp" &&
          entry?.actorType === "system",
      );
    console.log(`${summary.futureRecovery ? "PASS" : "FAIL"} future RSVP status recovery`);
    if (!summary.futureRecovery)
      throw new Error("The future Yes RSVP did not recover the Profile to Active.");

    const expiryPerformance = await createEvent(
      cookie,
      fixtureTitle("RSVP Expiry Performance"),
      new Date(now + 2 * 86_400_000).toISOString(),
    );
    eventIds.push(expiryPerformance);
    await runMaintenance(cookie);
    const expiredRow = await readAttendance(cookie, expiryPerformance, profile.id);
    const expiryHistory = await readRsvpHistory(cookie, expiryPerformance);
    summary.expiredRsvp =
      expiredRow?.rsvp === "No" &&
      expiryHistory.some((entry) => entry?.newRsvp === "No" && entry?.automatic === true);
    console.log(`${summary.expiredRsvp ? "PASS" : "FAIL"} pending RSVP expiry`);
    if (!summary.expiredRsvp)
      throw new Error("The pending future RSVP did not expire through automation.");

    const linkedPerformance = await createEvent(
      cookie,
      fixtureTitle("Linked Parent Performance"),
      new Date(now + 40 * 86_400_000).toISOString(),
    );
    eventIds.push(linkedPerformance);
    const linkedRehearsal = await createEvent(
      cookie,
      fixtureTitle("Linked Rehearsal"),
      new Date(now + 35 * 86_400_000).toISOString(),
      { parentPerformanceId: linkedPerformance, type: "Rehearsal" },
    );
    eventIds.push(linkedRehearsal);
    await setAttendance(cookie, linkedRehearsal, profile.id);
    const parentRow = await readAttendance(cookie, linkedPerformance, profile.id);
    const rehearsalHistory = await readRsvpHistory(cookie, linkedRehearsal);
    summary.attendanceReconciled =
      parentRow?.rsvp === "Yes" &&
      rehearsalHistory.some((entry) => entry?.newRsvp === "Yes" && entry?.automatic === true);
    console.log(
      `${summary.attendanceReconciled ? "PASS" : "FAIL"} linked rehearsal attendance reconciliation`,
    );
    if (!summary.attendanceReconciled)
      throw new Error("Linked rehearsal Present attendance did not reconcile the parent RSVP.");

    summary.crossOrganizationRejected = await inspectBoundary(cookie, profile.id, eventIds);
    console.log(
      `${summary.crossOrganizationRejected ? "PASS" : "FAIL"} roster automation cross-Organization boundary`,
    );
    if (!summary.crossOrganizationRejected) {
      throw new Error(
        "Qualification Profile or event data was accessible on the wrong Organization host.",
      );
    }
  } finally {
    let cleanupSucceeded = true;
    for (const eventId of [...eventIds].reverse()) {
      try {
        await archiveEvent(cookie, eventId);
      } catch {
        cleanupSucceeded = false;
        console.error("Roster automation qualification event cleanup did not complete.");
      }
    }
    if (cookie && profile) {
      try {
        await updateProfile(cookie, profile.id, profileMutation(profile));
      } catch {
        cleanupSucceeded = false;
        console.error("Roster automation qualification Profile cleanup did not complete.");
      }
    }
    if (cookie && onBreakProfile) {
      try {
        await updateProfile(cookie, onBreakProfile.id, profileMutation(onBreakProfile));
      } catch {
        cleanupSucceeded = false;
        console.error("Roster automation On Break Profile cleanup did not complete.");
      }
    }
    summary.cleanupCompleted = cleanupSucceeded && (eventIds.length === 0 || cookie !== "");
    readline.close();
  }

  const result = safeRosterAutomationQualificationSummary(summary);
  console.log(JSON.stringify(result));
  const checks = [
    result.attendanceReconciled,
    result.cleanupCompleted,
    result.crossOrganizationRejected,
    result.expiredRsvp,
    result.futureRecovery,
    result.inactiveAfterMisses,
    result.onBreakTimeout,
    result.previewMatched,
  ];
  if (!checks.every(Boolean)) {
    throw new Error("Roster automation qualification did not satisfy all checks.");
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
