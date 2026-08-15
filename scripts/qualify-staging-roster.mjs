import { createHash, randomUUID } from "node:crypto";
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
const runKey = (process.env.STAGING_ROSTER_RUN_KEY ?? randomUUID().slice(0, 8))
  .trim()
  .toLowerCase();
const primaryProfileId = process.env.STAGING_ROSTER_PRIMARY_PROFILE_ID?.trim() ?? "";
const importedProfileId = process.env.STAGING_ROSTER_IMPORTED_PROFILE_ID?.trim() ?? "";
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
  throw new Error(
    "STAGING_ROSTER_RUN_KEY must contain 4-40 lowercase letters, numbers, or hyphens.",
  );
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

export function rosterQualificationPlan() {
  return [
    "sign in as an Organization Administrator without recording the session or one-time code",
    "create one no-email Profile and update its performer, status, notes, and directory fields",
    "import one no-email Profile through the supported roster CSV endpoint",
    "prove neither controlled Profile is linked to a login Membership",
    "verify both controlled Profiles in the canonical roster export and record only its checksum",
    "verify directory inclusion, then directory exclusion by preference and Inactive status",
    "prove the controlled Profiles and export bytes are absent on the wrong Organization host",
    "leave both qualification-owned Profiles Inactive and hidden because no supported delete route exists",
  ];
}

export function rosterBoundaryResponsesSafe(responses, profileIds, expectedCsvNames) {
  const [profiles, exportResult, directory] = responses;
  const profileTarget =
    Array.isArray(profiles.body?.profiles) &&
    profiles.body.profiles.some((profile) => profileIds.includes(profile?.id));
  const exportTarget =
    typeof exportResult.text === "string" &&
    expectedCsvNames.some((name) => exportResult.text.includes(name));
  const directoryTarget =
    Array.isArray(directory.body?.profiles) &&
    directory.body.profiles.some((profile) => profileIds.includes(profile?.id));
  const safe = (status, containsTarget) =>
    status === 401 || status === 403 || status === 404 || (status === 200 && !containsTarget);
  return (
    safe(profiles.status, profileTarget) &&
    safe(exportResult.status, exportTarget) &&
    safe(directory.status, directoryTarget)
  );
}

export function safeRosterQualificationSummary(result) {
  return {
    cleanupCompleted: result.cleanupCompleted === true,
    createAndUpdateVerified: result.createAndUpdateVerified === true,
    crossOrganizationRejected: result.crossOrganizationRejected === true,
    directoryTransitionsVerified: result.directoryTransitionsVerified === true,
    exportChecksum: typeof result.exportChecksum === "string" ? result.exportChecksum : null,
    importVerified: result.importVerified === true,
    importedProfileId: result.importedProfileId ?? null,
    noLoginProfilesVerified: result.noLoginProfilesVerified === true,
    primaryProfileId: result.primaryProfileId ?? null,
  };
}

export function rosterImportedProfileMatches(profile, displayName) {
  return (
    profile?.displayName === displayName &&
    profile?.globalStatus === "Active" &&
    profile?.voicePart === "A1"
  );
}

export function rosterQualificationRequestHeaders(url, cookie = "", hasBody = false, headers = {}) {
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
    headers: rosterQualificationRequestHeaders(url, cookie, body !== undefined, headers),
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

async function listProfiles(cookie, host = organizationHost) {
  const result = await jsonRequest(`${host}/api/organization/profiles`, "GET", cookie);
  if (result.response.status !== 200 || !Array.isArray(result.body?.profiles)) {
    throw new Error(
      `Profile list failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.profiles;
}

function profileRequest(displayName, overrides = {}) {
  return {
    displayName,
    doNotEmail: false,
    email: "",
    globalStatus: "Active",
    isSectionLeader: false,
    notes: "Controlled permanent-staging roster qualification fixture.",
    phone: "",
    receiveAdminNotifications: false,
    receiveAttendanceReports: false,
    receiveFinancialAlerts: false,
    receiveRsvpDeclineNotices: false,
    showInDirectory: true,
    statusIsManual: true,
    voicePart: "S1",
    ...overrides,
  };
}

async function createProfile(cookie, displayName) {
  const result = await jsonRequest(
    `${organizationHost}/api/organization/profiles`,
    "POST",
    cookie,
    {
      displayName,
      email: "",
    },
  );
  if (result.response.status !== 201 || typeof result.body?.id !== "string") {
    throw new Error(
      `Profile creation failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return uuid(result.body.id, "Created Profile ID");
}

async function updateProfile(cookie, profileId, details) {
  const result = await jsonRequest(
    `${organizationHost}/api/organization/profiles/${encodeURIComponent(profileId)}`,
    "PUT",
    cookie,
    details,
  );
  if (result.response.status !== 200 || result.body?.id !== profileId) {
    throw new Error(
      `Profile update failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body;
}

async function importProfile(cookie, displayName) {
  const csv = [
    "Name,Email,Phone,Voice Part,Status,Notes,Section Leader",
    `"${displayName}",,,A1,Active,"Controlled roster CSV qualification fixture.",no`,
  ].join("\n");
  const result = await request(
    `${organizationHost}/api/organization/profiles/import`,
    "POST",
    cookie,
    csv,
    { "content-type": "text/csv" },
  );
  if (result.response.status !== 201 || result.body?.imported !== 1) {
    throw new Error(
      `Roster import failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  const matches = (await listProfiles(cookie)).filter(
    (profile) => profile?.displayName === displayName,
  );
  if (matches.length !== 1 || typeof matches[0]?.id !== "string") {
    throw new Error("The imported qualification Profile did not resolve exactly once.");
  }
  return uuid(matches[0].id, "Imported Profile ID");
}

async function listMembershipProfileIds(cookie) {
  const result = await jsonRequest(`${organizationHost}/api/organization/members`, "GET", cookie);
  if (result.response.status !== 200 || !Array.isArray(result.body?.memberships)) {
    throw new Error(
      `Membership list failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return new Set(
    result.body.memberships
      .map((member) => member?.profileId)
      .filter((profileId) => typeof profileId === "string"),
  );
}

async function readDirectory(cookie, host = organizationHost) {
  const result = await jsonRequest(`${host}/api/singer/directory`, "GET", cookie);
  if (result.response.status !== 200 || !Array.isArray(result.body?.profiles)) {
    throw new Error(
      `Directory read failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.profiles;
}

async function readExport(cookie, host = organizationHost) {
  return request(`${host}/api/organization/profiles/export.csv`, "GET", cookie);
}

async function inspectBoundary(cookie, profileIds, expectedCsvNames) {
  const [profiles, exportResult, directory] = await Promise.all([
    jsonRequest(`${wrongOrganizationHost}/api/organization/profiles`, "GET", cookie),
    readExport(cookie, wrongOrganizationHost),
    jsonRequest(`${wrongOrganizationHost}/api/singer/directory`, "GET", cookie),
  ]);
  return rosterBoundaryResponsesSafe(
    [
      { status: profiles.response.status, body: profiles.body },
      { status: exportResult.response.status, text: exportResult.text },
      { status: directory.response.status, body: directory.body },
    ],
    profileIds,
    expectedCsvNames,
  );
}

async function resolveExistingProfile(cookie, profileId, displayName, label) {
  const profiles = await listProfiles(cookie);
  const matches = profiles.filter((profile) =>
    profileId ? profile?.id === profileId : profile?.displayName === displayName,
  );
  if (matches.length > 1 || (profileId && matches.length !== 1)) {
    throw new Error(`${label} did not resolve to exactly one Organization Profile.`);
  }
  return matches[0] ?? null;
}

async function main() {
  const plan = rosterQualificationPlan();
  if (planOnly) {
    for (const [index, step] of plan.entries()) console.log(`${String(index + 1)}. ${step}`);
    return;
  }

  let cookie = "";
  let primaryId = primaryProfileId ? uuid(primaryProfileId, "Primary Profile ID") : "";
  let importedId = importedProfileId ? uuid(importedProfileId, "Imported Profile ID") : "";
  const primaryName = `Qualification Roster CRUD ${runKey}`;
  const importedName = `Qualification Roster Import ${runKey}`;
  const summary = {
    cleanupCompleted: false,
    createAndUpdateVerified: false,
    crossOrganizationRejected: false,
    directoryTransitionsVerified: false,
    exportChecksum: null,
    importVerified: false,
    importedProfileId: null,
    noLoginProfilesVerified: false,
    primaryProfileId: null,
  };

  try {
    cookie = await signIn();

    const existingPrimary = await resolveExistingProfile(
      cookie,
      primaryId,
      primaryName,
      "Primary qualification Profile",
    );
    primaryId = existingPrimary?.id ?? (await createProfile(cookie, primaryName));
    summary.primaryProfileId = primaryId;
    const updatedPrimary = await updateProfile(
      cookie,
      primaryId,
      profileRequest(primaryName, {
        globalStatus: "Idle",
        isSectionLeader: true,
        notes: "Controlled roster create/update/export/directory qualification fixture.",
        phone: "555-0199",
      }),
    );
    summary.createAndUpdateVerified =
      updatedPrimary.displayName === primaryName &&
      updatedPrimary.globalStatus === "Idle" &&
      updatedPrimary.isSectionLeader === true &&
      updatedPrimary.phone === "555-0199" &&
      updatedPrimary.showInDirectory === true &&
      updatedPrimary.voicePart === "S1";
    console.log(
      `${summary.createAndUpdateVerified ? "PASS" : "FAIL"} roster Profile create/update`,
    );
    if (!summary.createAndUpdateVerified) {
      throw new Error("The controlled Profile update did not persist its expected fields.");
    }

    const existingImported = await resolveExistingProfile(
      cookie,
      importedId,
      importedName,
      "Imported qualification Profile",
    );
    importedId = existingImported?.id ?? (await importProfile(cookie, importedName));
    summary.importedProfileId = importedId;
    await updateProfile(
      cookie,
      importedId,
      profileRequest(importedName, {
        globalStatus: "Active",
        showInDirectory: true,
        voicePart: "A1",
      }),
    );
    const profilesAfterImport = await listProfiles(cookie);
    const imported = profilesAfterImport.find((profile) => profile?.id === importedId);
    summary.importVerified = rosterImportedProfileMatches(imported, importedName);
    console.log(`${summary.importVerified ? "PASS" : "FAIL"} roster CSV import`);
    if (!summary.importVerified) {
      throw new Error("The controlled CSV import did not persist its expected Profile.");
    }

    const linkedProfileIds = await listMembershipProfileIds(cookie);
    summary.noLoginProfilesVerified =
      !linkedProfileIds.has(primaryId) && !linkedProfileIds.has(importedId);
    console.log(`${summary.noLoginProfilesVerified ? "PASS" : "FAIL"} no-login Profile boundary`);
    if (!summary.noLoginProfilesVerified) {
      throw new Error("A controlled no-email Profile was unexpectedly linked to a Membership.");
    }

    const rosterExport = await readExport(cookie);
    if (rosterExport.response.status !== 200) {
      throw new Error(
        `Roster export failed with ${requestFailure(rosterExport.response.status, rosterExport.body)}.`,
      );
    }
    if (!rosterExport.text.includes(primaryName) || !rosterExport.text.includes(importedName)) {
      throw new Error("The roster export omitted a controlled qualification Profile.");
    }
    summary.exportChecksum = createHash("sha256").update(rosterExport.text).digest("hex");
    console.log("PASS canonical roster CSV export and checksum");

    const initialDirectory = await readDirectory(cookie);
    const initiallyVisible = [primaryId, importedId].every((profileId) =>
      initialDirectory.some((profile) => profile?.id === profileId),
    );
    await updateProfile(
      cookie,
      primaryId,
      profileRequest(primaryName, { globalStatus: "Inactive", showInDirectory: true }),
    );
    await updateProfile(
      cookie,
      importedId,
      profileRequest(importedName, {
        globalStatus: "Active",
        showInDirectory: false,
        voicePart: "A1",
      }),
    );
    const finalDirectory = await readDirectory(cookie);
    const finallyHidden = [primaryId, importedId].every(
      (profileId) => !finalDirectory.some((profile) => profile?.id === profileId),
    );
    summary.directoryTransitionsVerified = initiallyVisible && finallyHidden;
    console.log(
      `${summary.directoryTransitionsVerified ? "PASS" : "FAIL"} directory inclusion and exclusion`,
    );
    if (!summary.directoryTransitionsVerified) {
      throw new Error("The controlled directory inclusion/exclusion transitions did not match.");
    }

    summary.crossOrganizationRejected = await inspectBoundary(
      cookie,
      [primaryId, importedId],
      [primaryName, importedName],
    );
    console.log(
      `${summary.crossOrganizationRejected ? "PASS" : "FAIL"} roster cross-Organization boundary`,
    );
    if (!summary.crossOrganizationRejected) {
      throw new Error("Controlled roster data was accessible on the wrong Organization host.");
    }
  } finally {
    let cleanupCompleted = true;
    for (const [profileId, displayName, voicePart] of [
      [primaryId, primaryName, "S1"],
      [importedId, importedName, "A1"],
    ]) {
      if (!cookie || !profileId) continue;
      try {
        await updateProfile(
          cookie,
          profileId,
          profileRequest(displayName, {
            globalStatus: "Inactive",
            showInDirectory: false,
            voicePart,
          }),
        );
      } catch {
        cleanupCompleted = false;
        console.error("Roster qualification Profile cleanup did not complete.");
      }
    }
    summary.cleanupCompleted = cleanupCompleted;
  }

  const result = safeRosterQualificationSummary(summary);
  console.log(JSON.stringify(result));
  if (
    ![
      result.cleanupCompleted,
      result.createAndUpdateVerified,
      result.crossOrganizationRejected,
      result.directoryTransitionsVerified,
      result.importVerified,
      result.noLoginProfilesVerified,
      typeof result.exportChecksum === "string" && result.exportChecksum.length === 64,
    ].every(Boolean)
  ) {
    throw new Error("Roster qualification did not satisfy every required check.");
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
