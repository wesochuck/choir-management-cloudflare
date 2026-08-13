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
const targetProfileId = process.env.STAGING_UNSUBSCRIBE_PROFILE_ID?.trim() ?? "";

export function signedUnsubscribeProfilePrefix(environment = process.env) {
  return (environment.STAGING_UNSUBSCRIBE_PROFILE_PREFIX ?? "QUAL-Unsubscribe-").trim();
}

const targetProfilePrefix = signedUnsubscribeProfilePrefix();
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

function fixtureSubject() {
  return `QUAL-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)} unsubscribe`;
}

export function signedUnsubscribeQualificationPlan(profileId = "<qualification-profile-id>") {
  return [
    `send one targeted sandbox email to Profile ${profileId} through the supported communications API`,
    "wait for the bounded delivery state without inspecting provider payloads",
    "accept an unsubscribe URL only in the local process and never print or persist its token",
    "verify idempotent unsubscribe success and wrong-Organization rejection",
    "verify a later reach preview excludes the suppressed Profile",
    "retain only safe message/profile IDs and suppression status evidence",
  ];
}

export function parseSignedUnsubscribeUrl(value, expectedHost) {
  const url = new URL(value);
  if (url.origin !== expectedHost || url.pathname !== "/unsubscribe") {
    throw new Error(
      "The entered URL must be the LCC unsubscribe URL from the qualification email.",
    );
  }
  const token = url.searchParams.get("token") ?? "";
  if (token.length < 1 || token.length > 4_096) {
    throw new Error("The entered unsubscribe URL did not contain a valid token parameter.");
  }
  return token;
}

export function safeUnsubscribeQualificationSummary(input) {
  return {
    crossOrganizationRejected: input.crossOrganizationRejected === true,
    idempotent: input.idempotent === true,
    messageId: input.messageId,
    profileId: input.profileId,
    reachExcluded: input.reachExcluded === true,
    unsubscribed: input.unsubscribed === true,
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
  if (targetProfileId) return uuid(targetProfileId, "STAGING_UNSUBSCRIBE_PROFILE_ID");
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
      `Expected exactly one qualification Profile matching ${targetProfilePrefix}; found ${String(matches.length)}. Set STAGING_UNSUBSCRIBE_PROFILE_ID explicitly.`,
    );
  }
  return uuid(matches[0].id, "qualification Profile");
}

async function sendTargetedMessage(cookie, profileId, subject) {
  const { body, response } = await jsonRequest(
    `${organizationHost}/api/organization/communications/send`,
    "POST",
    cookie,
    {
      audience: {
        eventId: null,
        globalStatuses: ["Active"],
        profileIds: [profileId],
        rsvp: "All",
        targetAudiences: ["Members"],
        voiceParts: [],
      },
      channel: "Email",
      contentMarkdown: `Controlled unsubscribe qualification message ${subject}.`,
      subject,
    },
  );
  if (response.status !== 202 || typeof body?.id !== "string") {
    throw new Error(`Targeted message queue failed with HTTP ${String(response.status)}.`);
  }
  return uuid(body.id, "communication message");
}

async function waitForDelivery(cookie, messageId) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { body, response } = await jsonRequest(
      `${organizationHost}/api/organization/communications/${messageId}/delivery-summary`,
      "GET",
      cookie,
    );
    if (response.status !== 200) {
      throw new Error(`Delivery summary failed with HTTP ${String(response.status)}.`);
    }
    if (body?.state === "sent" || body?.state === "tracking-unavailable") return body.state;
    if (body?.state === "failed" || body?.state === "partial") {
      throw new Error(`Controlled unsubscribe message reached terminal state ${body.state}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_500));
  }
  throw new Error("Controlled unsubscribe delivery did not complete within the bounded wait.");
}

async function unsubscribe(host, token) {
  return jsonRequest(`${host}/api/public/unsubscribe`, "POST", "", { token });
}

async function previewReach(cookie, profileId) {
  return jsonRequest(
    `${organizationHost}/api/organization/communications/reach-preview`,
    "POST",
    cookie,
    {
      audience: {
        eventId: null,
        globalStatuses: ["Active"],
        profileIds: [profileId],
        rsvp: "All",
        targetAudiences: ["Members"],
        voiceParts: [],
      },
      channel: "Email",
    },
  );
}

async function main() {
  if (planOnly) {
    for (const step of signedUnsubscribeQualificationPlan(
      targetProfileId || "<qualification-profile-id>",
    )) {
      console.log(`- ${step}`);
    }
    return;
  }

  const readline = createInterface({ input, output });
  const summary = {
    crossOrganizationRejected: false,
    idempotent: false,
    messageId: null,
    profileId: null,
    reachExcluded: false,
    unsubscribed: false,
  };
  try {
    const cookie = await signIn(readline);
    const profileId = await resolveTargetProfile(cookie);
    summary.profileId = profileId;
    const subject = fixtureSubject();
    const messageId = await sendTargetedMessage(cookie, profileId, subject);
    summary.messageId = messageId;
    console.log(`PASS targeted unsubscribe message queued (${messageId})`);
    const deliveryState = await waitForDelivery(cookie, messageId);
    console.log(`PASS bounded delivery state (${deliveryState})`);

    const enteredUrl = await prompt(
      readline,
      "Paste the unsubscribe URL from the controlled qualification email (local terminal only): ",
    );
    const token = parseSignedUnsubscribeUrl(enteredUrl, organizationHost);
    const first = await unsubscribe(organizationHost, token);
    summary.unsubscribed = first.response.status === 200 && first.body?.success === true;
    console.log(`${summary.unsubscribed ? "PASS" : "FAIL"} signed unsubscribe transition`);
    if (!summary.unsubscribed) throw new Error("Signed unsubscribe did not complete successfully.");

    const second = await unsubscribe(organizationHost, token);
    summary.idempotent = second.response.status === 200 && second.body?.success === true;
    console.log(`${summary.idempotent ? "PASS" : "FAIL"} signed unsubscribe replay`);
    if (!summary.idempotent) throw new Error("Signed unsubscribe replay was not idempotent.");

    const crossOrganization = await unsubscribe(wrongOrganizationHost, token);
    summary.crossOrganizationRejected = crossOrganization.response.status === 400;
    console.log(
      `${summary.crossOrganizationRejected ? "PASS" : "FAIL"} signed unsubscribe cross-Organization boundary`,
    );
    if (!summary.crossOrganizationRejected) {
      throw new Error("Signed unsubscribe was accepted on the wrong Organization host.");
    }

    const reach = await previewReach(cookie, profileId);
    summary.reachExcluded = reach.response.status === 200 && reach.body?.total === 0;
    console.log(
      `${summary.reachExcluded ? "PASS" : "FAIL"} suppressed Profile excluded from reach`,
    );
    if (!summary.reachExcluded) throw new Error("Suppressed Profile remained in email reach.");

    console.log(JSON.stringify(safeUnsubscribeQualificationSummary(summary)));
  } finally {
    readline.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
