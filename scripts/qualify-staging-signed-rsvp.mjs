import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const organizationSlug = (process.env.STAGING_ORG_SLUG ?? "lcc").trim().toLowerCase();
const wrongOrganizationSlug = (process.env.STAGING_SECOND_ORG_SLUG ?? "lmc").trim().toLowerCase();
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
const targetProfileId = process.env.STAGING_RSVP_PROFILE_ID?.trim() ?? "";
const targetProfilePrefix = (
  process.env.STAGING_RSVP_PROFILE_PREFIX ??
  process.env.STAGING_PHOTO_PROFILE_PREFIX ??
  "QUAL-"
).trim();
const organizationHost = `https://${organizationSlug}.${new URL(productUrl).hostname}`;
const wrongOrganizationHost = `https://${wrongOrganizationSlug}.${new URL(productUrl).hostname}`;
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

function fixtureTitle() {
  const date = new Date().toISOString().slice(0, 10);
  const suffix = crypto.randomUUID().slice(0, 8);
  return `QUAL-${date}-${suffix} signed RSVP`;
}

export function signedRsvpQualificationPlan(profileId = "<qualification-profile-id>") {
  return [
    `create one temporary Performance and link Profile ${profileId} through supported APIs`,
    "issue an RSVP link without printing or persisting the signed value",
    "verify LCC details, Yes/No updates with replay, and required response fields",
    "verify the same signed value is rejected on the LMC Organization host",
    "archive the temporary Performance and verify the previously valid link is revoked",
    "retain only safe fixture IDs and status evidence; never retain the signed value",
  ];
}

export function safeRsvpQualificationSummary(input) {
  return {
    archived: input.archived === true,
    crossOrganizationRejected: input.crossOrganizationRejected === true,
    eventId: input.eventId,
    replayAllowed: input.replayAllowed === true,
    restored: input.restored === true,
    validDetails: input.validDetails === true,
  };
}

async function request(url, method, cookie, body, headers = {}) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
      ...(cookie ? { cookie } : {}),
      origin: new URL(url).origin,
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      ...headers,
    },
    method,
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(15_000),
  });
  return response;
}

async function jsonRequest(url, method, cookie, body) {
  const response = await request(
    url,
    method,
    cookie,
    body === undefined ? undefined : JSON.stringify(body),
    body === undefined ? {} : { "content-type": "application/json" },
  );
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Do not print or retain unexpected response bodies in qualification output.
  }
  return { body: parsed, response };
}

async function prompt(readline, message) {
  return (await readline.question(message)).trim();
}

async function signIn(readline) {
  const otpRequest = await jsonRequest(
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
  const signInResponse = await request(
    `${productUrl}/api/auth/sign-in/email-otp`,
    "POST",
    "",
    JSON.stringify({ email, otp: code }),
    { "content-type": "application/json" },
  );
  if (!signInResponse.ok) {
    throw new Error(`Sign-in request failed with HTTP ${String(signInResponse.status)}.`);
  }
  const cookie = sessionCookieFrom(signInResponse);
  if (!cookie.includes("choir-management.session_token=")) {
    throw new Error("The sign-in response did not return a staging session cookie.");
  }
  return cookie;
}

async function resolveTargetProfile(cookie) {
  if (targetProfileId) return uuid(targetProfileId, "STAGING_RSVP_PROFILE_ID");
  const { body, response } = await jsonRequest(
    `${organizationHost}/api/organization/profiles`,
    "GET",
    cookie,
  );
  if (response.status !== 200 || !Array.isArray(body?.profiles)) {
    throw new Error(`Profile list failed with HTTP ${String(response.status)}.`);
  }
  const matches = body.profiles.filter(
    (profile) =>
      typeof profile?.id === "string" &&
      typeof profile?.displayName === "string" &&
      profile.displayName.startsWith(targetProfilePrefix),
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one qualification Profile matching ${targetProfilePrefix}; found ${String(matches.length)}. Set STAGING_RSVP_PROFILE_ID explicitly.`,
    );
  }
  return uuid(matches[0].id, "qualification Profile");
}

async function createPerformance(cookie, title) {
  const { body, response } = await jsonRequest(
    `${organizationHost}/api/organization/events`,
    "POST",
    cookie,
    {
      advancePriceCents: 0,
      callTime: "",
      dayOfPriceCents: 0,
      details: "Controlled signed-link qualification fixture.",
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
      startsAt: new Date(Date.now() + 48 * 60 * 60 * 1_000).toISOString(),
      ticketCapacity: null,
      title,
      type: "Performance",
      venueId: null,
    },
  );
  if (response.status !== 201 || typeof body?.id !== "string") {
    throw new Error(`Temporary Performance creation failed with HTTP ${String(response.status)}.`);
  }
  return uuid(body.id, "temporary Performance");
}

async function setAdminRsvp(cookie, eventId, profileId, rsvp) {
  const { response } = await jsonRequest(
    `${organizationHost}/api/organization/events/${eventId}/rsvp`,
    "PUT",
    cookie,
    { profileId, rsvp, rsvpNote: rsvp === "No" ? "Controlled signed-link qualification." : "" },
  );
  if (response.status !== 200) {
    throw new Error(`Administrator RSVP setup failed with HTTP ${String(response.status)}.`);
  }
}

async function generateToken(cookie, eventId, profileId) {
  const { body, response } = await jsonRequest(
    `${organizationHost}/api/organization/rsvp-tokens`,
    "POST",
    cookie,
    { eventId, profileIds: [profileId] },
  );
  const token = body?.tokens?.[profileId];
  if (response.status !== 200 || typeof token !== "string" || token.length === 0) {
    throw new Error(`RSVP token generation failed with HTTP ${String(response.status)}.`);
  }
  return token;
}

async function readRsvpDetails(host, token) {
  return jsonRequest(`${host}/api/public/rsvp-details`, "POST", "", { token });
}

async function submitRsvp(host, token, rsvp) {
  return jsonRequest(`${host}/api/public/quick-rsvp`, "POST", "", {
    rsvp,
    rsvpNote: rsvp === "No" ? "Controlled signed-link qualification." : "",
    token,
  });
}

async function archivePerformance(cookie, eventId) {
  const { body, response } = await jsonRequest(
    `${organizationHost}/api/organization/events/${eventId}`,
    "DELETE",
    cookie,
  );
  if (response.status !== 200 || body?.status !== "archived") {
    throw new Error(`Temporary Performance archive failed with HTTP ${String(response.status)}.`);
  }
}

async function main() {
  if (planOnly) {
    for (const step of signedRsvpQualificationPlan(
      targetProfileId || "<qualification-profile-id>",
    )) {
      console.log(`- ${step}`);
    }
    return;
  }

  const readline = createInterface({ input, output });
  let cookie = "";
  let eventId = null;
  let archived = false;
  const summary = {
    archived: false,
    crossOrganizationRejected: false,
    eventId: null,
    replayAllowed: false,
    restored: false,
    validDetails: false,
  };
  try {
    cookie = await signIn(readline);
    const profileId = await resolveTargetProfile(cookie);
    const title = fixtureTitle();
    eventId = await createPerformance(cookie, title);
    summary.eventId = eventId;
    console.log(`PASS temporary signed-RSVP Performance created (${eventId})`);

    await setAdminRsvp(cookie, eventId, profileId, "Yes");
    const token = await generateToken(cookie, eventId, profileId);

    const details = await readRsvpDetails(organizationHost, token);
    summary.validDetails =
      details.response.status === 200 &&
      details.body?.event?.id === eventId &&
      details.body?.profileId === profileId &&
      details.body?.rsvp === "Yes" &&
      details.body?.canSubmit === true;
    console.log(`${summary.validDetails ? "PASS" : "FAIL"} signed RSVP LCC details`);
    if (!summary.validDetails) throw new Error("Valid LCC RSVP details were not returned.");

    const yes = await submitRsvp(organizationHost, token, "Yes");
    if (yes.response.status !== 200) throw new Error("Signed RSVP Yes update failed.");
    const no = await submitRsvp(organizationHost, token, "No");
    if (no.response.status !== 200) throw new Error("Signed RSVP No update failed.");
    const restored = await submitRsvp(organizationHost, token, "Yes");
    summary.restored = restored.response.status === 200;
    console.log(`${summary.restored ? "PASS" : "FAIL"} signed RSVP Yes/No update and restore`);
    if (!summary.restored) throw new Error("Signed RSVP state could not be restored.");

    const replay = await readRsvpDetails(organizationHost, token);
    summary.replayAllowed = replay.response.status === 200;
    console.log(`${summary.replayAllowed ? "PASS" : "FAIL"} signed RSVP replay while active`);
    if (!summary.replayAllowed) throw new Error("Active signed RSVP replay was rejected.");

    const crossOrganization = await readRsvpDetails(wrongOrganizationHost, token);
    summary.crossOrganizationRejected = crossOrganization.response.status === 404;
    console.log(
      `${summary.crossOrganizationRejected ? "PASS" : "FAIL"} signed RSVP cross-Organization boundary`,
    );
    if (!summary.crossOrganizationRejected) {
      throw new Error("Signed RSVP was accepted on the wrong Organization host.");
    }

    await archivePerformance(cookie, eventId);
    archived = true;
    summary.archived = true;
    const revoked = await readRsvpDetails(organizationHost, token);
    const revokedMutation = await submitRsvp(organizationHost, token, "No");
    const revocationPassed =
      revoked.response.status === 404 && revokedMutation.response.status === 404;
    console.log(`${revocationPassed ? "PASS" : "FAIL"} signed RSVP revocation after archive`);
    if (!revocationPassed) throw new Error("Archived event still accepted its signed RSVP link.");

    console.log(JSON.stringify(safeRsvpQualificationSummary(summary)));
  } finally {
    if (cookie && eventId && !archived) {
      await archivePerformance(cookie, eventId).catch(() => undefined);
    }
    readline.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
