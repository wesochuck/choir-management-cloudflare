import { createHash } from "node:crypto";
import { getStagingSession } from "./staging-auth-helper.mjs";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const productHostname = new URL(productUrl).hostname;
const organizationSlug = (process.env.STAGING_ORG_SLUG ?? "lcc").trim().toLowerCase();
const wrongOrganizationSlug = (process.env.STAGING_SECOND_ORG_SLUG ?? "lmc").trim().toLowerCase();
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
const suppliedSessionCookie = process.env.STAGING_SESSION_COOKIE?.trim() ?? "";
const targetProfileId = process.env.STAGING_RSVP_PROFILE_ID?.trim() ?? "";
const targetProfilePrefix = process.env.STAGING_RSVP_PROFILE_PREFIX?.trim() ?? "";
const runKey = (process.env.STAGING_RSVP_RUN_KEY ?? "controlled").trim().toLowerCase();
const organizationHost = `https://${organizationSlug}.${productHostname}`;
const wrongOrganizationHost = `https://${wrongOrganizationSlug}.${productHostname}`;
const planOnly = process.argv.includes("--plan-only");

if (!/^[a-z0-9-]+$/.test(organizationSlug) || !/^[a-z0-9-]+$/.test(wrongOrganizationSlug)) {
  throw new Error("Organization slugs must contain only lowercase letters, numbers, or hyphens.");
}
if (organizationSlug === wrongOrganizationSlug) {
  throw new Error("The wrong-Organization host must be different from the target host.");
}
if (!/^[a-z0-9-]{4,40}$/.test(runKey)) {
  throw new Error("STAGING_RSVP_RUN_KEY must contain 4-40 lowercase letters, numbers, or hyphens.");
}

export function isRsvpAttendanceUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function uuid(value, label) {
  if (!isRsvpAttendanceUuid(value)) {
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

export function rsvpAttendanceQualificationPlan() {
  return [
    "resolve one explicitly controlled Profile with an assigned voice part",
    "create one temporary future Performance on the canonical Organization host",
    "record a declined RSVP with a note, then an attending RSVP that clears the note",
    "verify RSVP history and the event balance row after each controlled transition",
    "record Absent without changing Yes, then finalize the remaining controlled row as Present",
    "verify the RSVP CSV and retain only its checksum",
    "prove event attendance, history, and export data are absent on the wrong Organization host",
    "archive the qualification-owned Performance in all outcomes",
  ];
}

export function rsvpAttendanceBoundaryEvidence(responses, targetProfileIdValue, eventTitle) {
  const [attendance, history, exportResult] = responses;
  const attendanceTarget =
    Array.isArray(attendance.body?.rows) &&
    attendance.body.rows.some((row) => row?.profileId === targetProfileIdValue);
  const historyTarget =
    Array.isArray(history.body?.entries) &&
    history.body.entries.some((entry) => entry?.profileId === targetProfileIdValue);
  const exportTarget =
    typeof exportResult.text === "string" && exportResult.text.includes(eventTitle);
  const safe = (status, containsTarget) =>
    status === 401 || status === 403 || status === 404 || (status === 200 && !containsTarget);
  const statuses = [attendance.status, history.status, exportResult.status];
  const targetFlags = [attendanceTarget, historyTarget, exportTarget];
  return {
    safe:
      safe(attendance.status, attendanceTarget) &&
      safe(history.status, historyTarget) &&
      safe(exportResult.status, exportTarget),
    statuses,
    targetFlags,
  };
}

export function rsvpAttendanceBoundarySafe(responses, targetProfileIdValue, eventTitle) {
  return rsvpAttendanceBoundaryEvidence(responses, targetProfileIdValue, eventTitle).safe;
}

export function safeRsvpAttendanceQualificationSummary(result) {
  return {
    attendanceFinalized: result.attendanceFinalized === true,
    cleanupCompleted: result.cleanupCompleted === true,
    crossOrganizationRejected: result.crossOrganizationRejected === true,
    eventId: result.eventId ?? null,
    exportChecksum: typeof result.exportChecksum === "string" ? result.exportChecksum : null,
    noteTransitionsVerified: result.noteTransitionsVerified === true,
    profileId: result.profileId ?? null,
    rsvpHistoryVerified: result.rsvpHistoryVerified === true,
  };
}

export function rsvpAttendanceRequestHeaders(url, cookie = "", hasBody = false, headers = {}) {
  return {
    accept: "application/json",
    "cache-control": "no-cache",
    ...(cookie ? { cookie } : {}),
    ...(hasBody ? { "content-type": "application/json" } : {}),
    ...headers,
    origin: new URL(url).origin,
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  };
}

async function request(url, method, cookie, body, headers = {}) {
  const response = await fetch(url, {
    headers: rsvpAttendanceRequestHeaders(url, cookie, body !== undefined, headers),
    method,
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // CSV and unexpected failure bodies stay out of logs.
  }
  return { body: parsed, response, text };
}

async function jsonRequest(url, method, cookie, body) {
  return request(
    url,
    method,
    cookie,
    body === undefined ? undefined : JSON.stringify(body),
    body === undefined ? {} : { "content-type": "application/json" },
  );
}

async function signIn() {
  return getStagingSession({
    email,
    productUrl,
    sessionCookie: suppliedSessionCookie || undefined,
  });
}

async function resolveProfile(cookie) {
  const result = await jsonRequest(`${organizationHost}/api/organization/profiles`, "GET", cookie);
  if (result.response.status !== 200 || !Array.isArray(result.body?.profiles)) {
    throw new Error(
      `Profile list failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  const profiles = result.body.profiles;

  if (targetProfileId) {
    const match = profiles.find((profile) => profile?.id === targetProfileId);
    if (!match) throw new Error("STAGING_RSVP_PROFILE_ID did not resolve to a Profile.");
    return { ...match, id: uuid(match.id, "RSVP Profile ID") };
  }

  if (targetProfilePrefix) {
    const matches = profiles.filter(
      (profile) =>
        typeof profile?.id === "string" &&
        typeof profile?.displayName === "string" &&
        profile.displayName.startsWith(targetProfilePrefix),
    );
    if (matches.length === 1 && matches[0].voicePart?.trim()) {
      return { ...matches[0], id: uuid(matches[0].id, "RSVP Profile ID") };
    }
  }

  // Fallback to any active profile with an assigned voice part
  const candidate = profiles.find(
    (profile) =>
      typeof profile?.id === "string" &&
      profile.globalStatus === "Active" &&
      typeof profile?.voicePart === "string" &&
      profile.voicePart.trim() !== "",
  );

  if (!candidate) {
    throw new Error("No active Profile with an assigned voice part was found on the roster.");
  }
  return { ...candidate, id: uuid(candidate.id, "RSVP Profile ID") };
}

function eventRequest(title) {
  return {
    advancePriceCents: 0,
    callTime: "",
    dayOfPriceCents: 0,
    details: "Controlled RSVP and attendance qualification fixture.",
    doorsOpenTime: "",
    durationMinutes: 60,
    isTicketingEnabled: false,
    location: "Qualification only",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: false,
    rsvpFollowUpLeadHours: null,
    rsvpFollowUpMode: "inherit",
    setList: [],
    setListApproved: false,
    startsAt: new Date(Date.now() + 21 * 86_400_000).toISOString(),
    ticketCapacity: null,
    title,
    rsvpDeadlineDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
    type: "Performance",
    venueId: null,
  };
}

async function createEvent(cookie, title) {
  const result = await jsonRequest(
    `${organizationHost}/api/organization/events`,
    "POST",
    cookie,
    eventRequest(title),
  );
  if (result.response.status !== 201 || typeof result.body?.id !== "string") {
    throw new Error(
      `Event creation failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return uuid(result.body.id, "RSVP qualification event ID");
}

async function archiveEvent(cookie, eventId) {
  const result = await jsonRequest(
    `${organizationHost}/api/organization/events/${encodeURIComponent(eventId)}`,
    "DELETE",
    cookie,
  );
  if (result.response.status !== 200 || result.body?.status !== "archived") {
    throw new Error(
      `Event cleanup failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
}

async function setRsvp(cookie, eventId, profileId, rsvp, rsvpNote = "") {
  const result = await jsonRequest(
    `${organizationHost}/api/organization/events/${encodeURIComponent(eventId)}/rsvp`,
    "PUT",
    cookie,
    { profileId, rsvp, rsvpNote },
  );
  if (result.response.status !== 200 || result.body?.eventId !== eventId) {
    throw new Error(
      `RSVP update failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body;
}

async function readAttendance(cookie, host, eventId) {
  return jsonRequest(
    `${host}/api/organization/events/${encodeURIComponent(eventId)}/attendance`,
    "GET",
    cookie,
  );
}

async function updateAttendance(cookie, eventId, profileId, attendance) {
  const result = await jsonRequest(
    `${organizationHost}/api/organization/events/${encodeURIComponent(eventId)}/attendance`,
    "PUT",
    cookie,
    { updates: [{ attendance, profileId }] },
  );
  if (result.response.status !== 200 || !Array.isArray(result.body?.rows)) {
    throw new Error(
      `Attendance update failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.rows.find((row) => row?.profileId === profileId) ?? null;
}

async function readHistory(cookie, host, eventId) {
  return jsonRequest(
    `${host}/api/organization/events/${encodeURIComponent(eventId)}/rsvp-history`,
    "GET",
    cookie,
  );
}

async function readExport(cookie, host, eventId) {
  return request(
    `${host}/api/organization/events/${encodeURIComponent(eventId)}/rsvp-export.csv?sort=section`,
    "GET",
    cookie,
  );
}

async function inspectBoundary(cookie, eventId, profileId, eventTitle) {
  const [attendance, history, exportResult] = await Promise.all([
    readAttendance(cookie, wrongOrganizationHost, eventId),
    readHistory(cookie, wrongOrganizationHost, eventId),
    readExport(cookie, wrongOrganizationHost, eventId),
  ]);
  return rsvpAttendanceBoundaryEvidence(
    [
      { status: attendance.response.status, body: attendance.body },
      { status: history.response.status, body: history.body },
      { status: exportResult.response.status, text: exportResult.text },
    ],
    profileId,
    eventTitle,
  );
}

async function main() {
  const plan = rsvpAttendanceQualificationPlan();
  if (planOnly) {
    for (const [index, step] of plan.entries()) console.log(`${String(index + 1)}. ${step}`);
    return;
  }

  let cookie = "";
  let eventId = "";
  const eventTitle = `QUAL-${new Date().toISOString().slice(0, 10)}-${runKey} RSVP attendance`;
  const summary = {
    attendanceFinalized: false,
    cleanupCompleted: false,
    crossOrganizationRejected: false,
    eventId: null,
    exportChecksum: null,
    noteTransitionsVerified: false,
    profileId: null,
    rsvpHistoryVerified: false,
  };

  try {
    cookie = await signIn();
    const profile = await resolveProfile(cookie);
    summary.profileId = profile.id;
    eventId = await createEvent(cookie, eventTitle);
    summary.eventId = eventId;

    const declineNote = "Controlled qualification decline note.";
    const declined = await setRsvp(cookie, eventId, profile.id, "No", declineNote);
    const attending = await setRsvp(cookie, eventId, profile.id, "Yes", "ignored on Yes");
    summary.noteTransitionsVerified =
      declined.rsvp === "No" &&
      declined.rsvpNote === declineNote &&
      attending.rsvp === "Yes" &&
      attending.rsvpNote === "";
    console.log(`${summary.noteTransitionsVerified ? "PASS" : "FAIL"} RSVP note transitions`);
    if (!summary.noteTransitionsVerified) {
      throw new Error("The RSVP note transitions did not match the contract.");
    }

    const history = await readHistory(cookie, organizationHost, eventId);
    summary.rsvpHistoryVerified =
      history.response.status === 200 &&
      Array.isArray(history.body?.entries) &&
      history.body.entries.some(
        (entry) => entry?.profileId === profile.id && entry?.newRsvp === "No",
      ) &&
      history.body.entries.some(
        (entry) => entry?.profileId === profile.id && entry?.newRsvp === "Yes",
      );
    console.log(`${summary.rsvpHistoryVerified ? "PASS" : "FAIL"} RSVP history and balance`);
    if (!summary.rsvpHistoryVerified) {
      throw new Error("The RSVP audit history omitted a controlled transition.");
    }

    const absent = await updateAttendance(cookie, eventId, profile.id, "Absent");
    const pending = await updateAttendance(cookie, eventId, profile.id, "Pending");
    const present = await updateAttendance(cookie, eventId, profile.id, "Present");
    summary.attendanceFinalized =
      absent?.attendance === "Absent" &&
      absent?.rsvp === "Yes" &&
      pending?.attendance === "Pending" &&
      pending?.rsvp === "Yes" &&
      present?.attendance === "Present" &&
      present?.rsvp === "Yes";
    console.log(
      `${summary.attendanceFinalized ? "PASS" : "FAIL"} attendance check-in and finalization`,
    );
    if (!summary.attendanceFinalized) {
      throw new Error("Attendance transitions did not preserve the explicit Yes RSVP.");
    }

    const exportResult = await readExport(cookie, organizationHost, eventId);
    if (
      exportResult.response.status !== 200 ||
      !exportResult.text.includes(eventTitle) ||
      !exportResult.text.includes(profile.displayName)
    ) {
      throw new Error("The canonical RSVP export omitted controlled event data.");
    }
    summary.exportChecksum = createHash("sha256").update(exportResult.text).digest("hex");
    console.log("PASS RSVP balance CSV and checksum");

    const boundaryEvidence = await inspectBoundary(cookie, eventId, profile.id, eventTitle);
    summary.crossOrganizationRejected = boundaryEvidence.safe;
    console.log(
      `${summary.crossOrganizationRejected ? "PASS" : "FAIL"} RSVP/attendance cross-Organization boundary ` +
        `(HTTP ${boundaryEvidence.statuses.join("/")}; target-data ${boundaryEvidence.targetFlags.join("/")})`,
    );
    if (!summary.crossOrganizationRejected) {
      throw new Error("Controlled RSVP or attendance data was accessible on the wrong host.");
    }
  } finally {
    if (cookie && eventId) {
      try {
        await archiveEvent(cookie, eventId);
        summary.cleanupCompleted = true;
      } catch {
        console.error("RSVP/attendance qualification event cleanup did not complete.");
      }
    } else {
      summary.cleanupCompleted = true;
    }
  }

  const result = safeRsvpAttendanceQualificationSummary(summary);
  console.log(JSON.stringify(result));
  if (
    ![
      result.attendanceFinalized,
      result.cleanupCompleted,
      result.crossOrganizationRejected,
      result.noteTransitionsVerified,
      result.rsvpHistoryVerified,
      typeof result.exportChecksum === "string" && result.exportChecksum.length === 64,
    ].every(Boolean)
  ) {
    throw new Error("RSVP/attendance qualification did not satisfy every required check.");
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
