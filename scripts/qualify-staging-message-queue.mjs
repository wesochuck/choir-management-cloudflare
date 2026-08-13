import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const organizationSlug = (process.env.STAGING_ORG_SLUG ?? "lcc").trim().toLowerCase();
const wrongOrganizationSlug = (process.env.STAGING_SECOND_ORG_SLUG ?? "lmc").trim().toLowerCase();
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
const targetProfileId = process.env.STAGING_QUEUE_PROFILE_ID?.trim() ?? "";
const targetMessageId = process.env.STAGING_QUEUE_MESSAGE_ID?.trim() ?? "";
const targetProfilePrefix = (
  process.env.STAGING_QUEUE_PROFILE_PREFIX ?? "Qualification Queue Temp 2026-08-12"
).trim();
const organizationHost = `https://${organizationSlug}.${new URL(productUrl).hostname}`;
const wrongOrganizationHost = `https://${wrongOrganizationSlug}.${new URL(productUrl).hostname}`;
const planOnly = process.argv.includes("--plan-only");
const pollingAttempts = 16;
const pollingDelayMs = 2_500;

if (!/^[a-z0-9-]+$/.test(organizationSlug) || !/^[a-z0-9-]+$/.test(wrongOrganizationSlug)) {
  throw new Error("Organization slugs must contain only lowercase letters, numbers, or hyphens.");
}
if (organizationSlug === wrongOrganizationSlug) {
  throw new Error("The wrong-Organization host must be different from the target host.");
}
if (!targetProfileId && targetProfilePrefix.length === 0) {
  throw new Error("Set STAGING_QUEUE_PROFILE_ID or STAGING_QUEUE_PROFILE_PREFIX.");
}

function uuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
  return value;
}

if (targetProfileId) uuid(targetProfileId, "STAGING_QUEUE_PROFILE_ID");
if (targetMessageId) uuid(targetMessageId, "STAGING_QUEUE_MESSAGE_ID");

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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function messageQueueQualificationPlan(profileId = "<qualification-profile-id>") {
  return [
    `send one targeted sandbox email to Profile ${profileId} through the supported communications API`,
    "wait for one sent delivery with one queue attempt and one provider-accepted result",
    "repeat read-only history and delivery inspection without creating a second delivery",
    "prove the message and its delivery summary are rejected on the wrong Organization host",
    "retain only safe message/profile IDs and bounded delivery counts; do not retry a queue job",
  ];
}

export function safeMessageQueueQualificationSummary(input) {
  return {
    attempts: input.attempts === 1,
    crossOrganizationRejected: input.crossOrganizationRejected === true,
    deliveryState: input.deliveryState === "sent",
    messageId: input.messageId,
    profileId: input.profileId,
    providerAccepted: input.providerStatus === "accepted" || input.providerStatus === "delivered",
    replayStable: input.replayStable === true,
    sentDeliveries: input.sentDeliveries === 1,
  };
}

export function messageQueueFailure(status, body) {
  const code =
    typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
      ? body.code
      : null;
  return `HTTP ${String(status)}${code ? ` (${code})` : ""}`;
}

export function messageQueueAudience(profileId) {
  return {
    eventId: null,
    globalStatuses: ["Active"],
    profileIds: [profileId],
    rsvp: "All",
    targetAudiences: ["Members"],
    voiceParts: [],
  };
}

export function messageQueueReachFailure(profile, reach) {
  const reasons = [];
  if (reach?.total !== 1) {
    reasons.push(
      `reach preview returned ${String(reach?.total ?? "an unknown number of")} recipients`,
    );
  }
  if (!profile) {
    reasons.push("the selected Profile was not found in the Organization profile list");
  } else {
    if (profile.globalStatus !== "Active") reasons.push("Profile status is not Active");
    if (typeof profile.voicePart !== "string" || profile.voicePart.trim().length === 0) {
      reasons.push("Profile has no assigned voice part");
    }
    if (profile.doNotEmail === true) reasons.push("Profile is marked do-not-email");
    if (profile.providerEmailSuppressed === true) {
      reasons.push("Profile has a provider email suppression");
    }
  }
  if (reach?.total === 0) {
    reasons.push(
      "the linked membership email is missing or an active unsubscribe suppression exists",
    );
  }
  if (reasons.length === 0) {
    reasons.push("the selected Profile is not eligible for exactly one email recipient");
  }
  return `Message queue target has no exactly-one reachable email recipient: ${reasons.join(
    "; ",
  )}. Use a dedicated, unsuppressed qualification Profile.`;
}

export function messageQueueCrossOrganizationRejected(status) {
  return status === 401 || status === 403 || status === 404;
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
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Do not print or retain unexpected response bodies.
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

async function listProfiles(cookie) {
  const { body, response } = await request(
    `${organizationHost}/api/organization/profiles`,
    "GET",
    cookie,
  );
  if (response.status !== 200 || !Array.isArray(body?.profiles)) {
    throw new Error(`Profile list failed with HTTP ${String(response.status)}.`);
  }
  return body.profiles;
}

async function resolveTargetProfile(cookie) {
  const profiles = await listProfiles(cookie);
  const matches = profiles.filter(
    (profile) =>
      typeof profile?.id === "string" &&
      (targetProfileId
        ? profile.id === targetProfileId
        : typeof profile?.displayName === "string" &&
          profile.displayName.startsWith(targetProfilePrefix)),
  );
  if (matches.length !== 1) {
    if (targetProfileId) {
      throw new Error(
        "STAGING_QUEUE_PROFILE_ID did not resolve to exactly one Organization Profile.",
      );
    }
    throw new Error(
      `Expected exactly one qualification Profile matching ${targetProfilePrefix}; found ${String(matches.length)}. Set STAGING_QUEUE_PROFILE_ID explicitly.`,
    );
  }
  return {
    ...matches[0],
    id: uuid(matches[0].id, "qualification Profile"),
  };
}

function fixtureSubject() {
  return `QUAL-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)} message queue`;
}

async function sendTargetedMessage(cookie, profileId, subject) {
  const { body, response } = await request(
    `${organizationHost}/api/organization/communications/send`,
    "POST",
    cookie,
    {
      audience: {
        ...messageQueueAudience(profileId),
      },
      channel: "Email",
      contentMarkdown: `Controlled message-queue qualification ${subject}.`,
      subject,
    },
  );
  if (response.status !== 202 || typeof body?.id !== "string") {
    throw new Error(
      `Message queue request failed with ${messageQueueFailure(response.status, body)}.`,
    );
  }
  return uuid(body.id, "communication message");
}

async function previewReach(cookie, profileId) {
  const { body, response } = await request(
    `${organizationHost}/api/organization/communications/reach-preview`,
    "POST",
    cookie,
    { audience: messageQueueAudience(profileId), channel: "Email" },
  );
  if (
    response.status !== 200 ||
    typeof body?.total !== "number" ||
    typeof body?.email !== "number"
  ) {
    throw new Error(`Communication reach preview failed with HTTP ${String(response.status)}.`);
  }
  return body;
}

async function inspectMessage(cookie, profileId, messageId) {
  const [history, deliverySummary, profileDeliveries] = await Promise.all([
    request(`${organizationHost}/api/organization/communications`, "GET", cookie),
    request(
      `${organizationHost}/api/organization/communications/${messageId}/delivery-summary`,
      "GET",
      cookie,
    ),
    request(`${organizationHost}/api/organization/profiles/${profileId}/deliveries`, "GET", cookie),
  ]);
  if (history.response.status !== 200 || !Array.isArray(history.body?.messages)) {
    throw new Error(`Communication history failed with HTTP ${String(history.response.status)}.`);
  }
  if (deliverySummary.response.status !== 200 || !deliverySummary.body) {
    throw new Error(
      `Delivery summary failed with HTTP ${String(deliverySummary.response.status)}.`,
    );
  }
  if (
    profileDeliveries.response.status !== 200 ||
    !Array.isArray(profileDeliveries.body?.deliveries)
  ) {
    throw new Error(
      `Profile delivery history failed with HTTP ${String(profileDeliveries.response.status)}.`,
    );
  }
  const messageRows = history.body.messages.filter((message) => message?.id === messageId);
  const delivery = profileDeliveries.body.deliveries.find(
    (candidate) => candidate?.messageId === messageId,
  );
  if (messageRows.length !== 1 || !delivery) {
    throw new Error("The qualification message was not present in the bounded delivery records.");
  }
  const total = deliverySummary.body.total;
  const emailTotal = deliverySummary.body.email;
  return {
    attempts: delivery.attempts,
    deliveryState: deliverySummary.body.state,
    emailSent: emailTotal?.sent,
    emailTotal: emailTotal?.total,
    messageCount: messageRows.length,
    messageStatus: messageRows[0].status,
    providerStatus: delivery.providerStatus,
    sentDeliveries: total?.sent,
    totalDeliveries: total?.total,
  };
}

function isExactlyOnceSent(snapshot) {
  return (
    snapshot.attempts === 1 &&
    snapshot.deliveryState === "sent" &&
    snapshot.emailSent === 1 &&
    snapshot.emailTotal === 1 &&
    snapshot.messageCount === 1 &&
    snapshot.messageStatus === "Sent" &&
    (snapshot.providerStatus === "accepted" || snapshot.providerStatus === "delivered") &&
    snapshot.sentDeliveries === 1 &&
    snapshot.totalDeliveries === 1
  );
}

async function waitForExactlyOnceSent(cookie, profileId, messageId) {
  for (let attempt = 0; attempt < pollingAttempts; attempt += 1) {
    const snapshot = await inspectMessage(cookie, profileId, messageId);
    if (isExactlyOnceSent(snapshot)) return snapshot;
    if (snapshot.deliveryState === "failed" || snapshot.deliveryState === "partial") {
      throw new Error(`Message queue reached terminal state ${snapshot.deliveryState}.`);
    }
    if (attempt < pollingAttempts - 1) await sleep(pollingDelayMs);
  }
  throw new Error("Message queue delivery did not reach exactly-once sent state in time.");
}

async function wrongOrganizationBoundary(cookie, messageId) {
  const result = await request(
    `${wrongOrganizationHost}/api/organization/communications/${messageId}/delivery-summary`,
    "GET",
    cookie,
  );
  return result.response.status;
}

export async function runMessageQueueQualification(readline) {
  const cookie = await signIn(readline);
  const profile = await resolveTargetProfile(cookie);
  const profileId = profile.id;
  const reach = await previewReach(cookie, profileId);
  if (reach.total !== 1 || reach.email !== 1) {
    throw new Error(messageQueueReachFailure(profile, reach));
  }
  console.log("PASS one reachable email recipient preflight");
  const messageId =
    targetMessageId || (await sendTargetedMessage(cookie, profileId, fixtureSubject()));
  console.log(
    targetMessageId
      ? `PASS reusing existing controlled message (${messageId})`
      : `PASS targeted message queued (${messageId})`,
  );
  const first = await waitForExactlyOnceSent(cookie, profileId, messageId);
  console.log("PASS bounded message-queue delivery state (sent)");

  const replay = await inspectMessage(cookie, profileId, messageId);
  const replayStable = JSON.stringify(first) === JSON.stringify(replay);
  console.log(`${replayStable ? "PASS" : "FAIL"} message-queue replay/idempotency observation`);
  if (!replayStable) throw new Error("Repeated message inspection changed delivery counts.");

  const crossOrganizationStatus = await wrongOrganizationBoundary(cookie, messageId);
  const crossOrganizationRejected = messageQueueCrossOrganizationRejected(crossOrganizationStatus);
  console.log(
    `${crossOrganizationRejected ? "PASS" : "FAIL"} message-queue cross-Organization boundary (HTTP ${String(crossOrganizationStatus)})`,
  );
  if (!crossOrganizationRejected) {
    throw new Error("The message delivery summary was accessible on the wrong Organization host.");
  }

  console.log(
    JSON.stringify(
      safeMessageQueueQualificationSummary({
        attempts: first.attempts,
        crossOrganizationRejected,
        deliveryState: first.deliveryState,
        messageId,
        profileId,
        providerStatus: first.providerStatus,
        replayStable,
        sentDeliveries: first.sentDeliveries,
      }),
    ),
  );
}

async function main() {
  if (planOnly) {
    for (const step of messageQueueQualificationPlan(targetProfileId || targetProfilePrefix)) {
      console.log(`- ${step}`);
    }
    return;
  }
  const readline = createInterface({ input, output });
  try {
    await runMessageQueueQualification(readline);
  } finally {
    readline.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
