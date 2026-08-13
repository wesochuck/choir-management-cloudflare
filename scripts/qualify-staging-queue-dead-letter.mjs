import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const organizationSlug = (process.env.STAGING_ORG_SLUG ?? "lcc").trim().toLowerCase();
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
const failureEmail = (
  process.env.STAGING_QUEUE_FAILURE_EMAIL ??
  `qual-queue-failure-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}@example.test`
)
  .trim()
  .toLowerCase();
const failureName = `QUAL-QUEUE-FAIL-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
const organizationHost = `https://${organizationSlug}.${new URL(productUrl).hostname}`;
const pollingAttempts = 36;
const pollingDelayMs = 5_000;
const planOnly = process.argv.includes("--plan-only");

if (!/^[a-z0-9-]+$/.test(organizationSlug)) {
  throw new Error("STAGING_ORG_SLUG must contain only lowercase letters, numbers, or hyphens.");
}
if (!failureEmail.endsWith("@example.test") && !failureEmail.endsWith("@example.invalid")) {
  throw new Error(
    "The failure fixture must use an RFC-reserved example.test or example.invalid address.",
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function uuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
  return value;
}

export function queueDeadLetterQualificationPlan() {
  return [
    "sign in and verify the fresh Platform Administrator factor in memory",
    "snapshot open queue dead letters without printing operational payloads",
    "create one temporary audition addressed only to an RFC-reserved example.test fixture",
    "delete the audition through the supported Organization API before notification resolution",
    "poll for a new Organization-owned audition_notification dead letter with bounded waits",
    "dismiss each newly owned dead letter once and prove a repeated dismissal is rejected",
    "leave no audition or provider-recipient state behind and never invoke queue retry",
  ];
}

export function safeQueueDeadLetterSummary(input) {
  return {
    cleanupCompleted: input.cleanupCompleted === true,
    deadLetterCount: input.deadLetterCount,
    dismissalCount: input.dismissalCount,
    duplicateDismissalRejected: input.duplicateDismissalRejected === true,
    qualificationOwned: input.qualificationOwned === true,
  };
}

async function request(url, method, body, cookie) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
      ...(cookie ? { cookie } : {}),
      "content-type": "application/json",
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
    // Do not print or retain unexpected response bodies.
  }
  return { body: parsed, response };
}

async function prompt(readline, message) {
  return (await readline.question(message)).trim();
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

async function signIn(readline) {
  const otpRequest = await request(
    `${productUrl}/api/auth/email-otp/send-verification-otp`,
    "POST",
    { email, type: "sign-in" },
  );
  if (otpRequest.response.status !== 200) {
    throw new Error(`Sign-in code request failed with HTTP ${String(otpRequest.response.status)}.`);
  }
  console.log(`A sign-in code was requested for ${email}.`);
  const code = await prompt(readline, "Enter the six-digit sign-in code (not recorded): ");
  if (!/^\d{6}$/.test(code)) throw new Error("The sign-in code must contain exactly six digits.");
  const signedIn = await request(`${productUrl}/api/auth/sign-in/email-otp`, "POST", {
    email,
    otp: code,
  });
  if (!signedIn.response.ok) {
    throw new Error(`Sign-in request failed with HTTP ${String(signedIn.response.status)}.`);
  }
  const cookie = sessionCookieFrom(signedIn.response);
  if (!cookie.includes("choir-management.session_token=")) {
    throw new Error("The sign-in response did not return a staging session cookie.");
  }
  return cookie;
}

async function verifyPlatformFactor(readline, cookie) {
  const status = await request(`${productUrl}/api/platform/mfa/status`, "GET", undefined, cookie);
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
  const verification = await request(
    `${productUrl}/api/platform/mfa/verify`,
    "POST",
    { code, method: "totp" },
    cookie,
  );
  if (verification.response.status !== 200) {
    throw new Error(
      `Platform MFA verification failed with HTTP ${String(verification.response.status)}.`,
    );
  }
}

async function resolveOrganizationId(cookie) {
  const result = await request(
    `${organizationHost}/api/organization/context`,
    "GET",
    undefined,
    cookie,
  );
  if (result.response.status !== 200 || typeof result.body?.organizationId !== "string") {
    throw new Error(`Organization context failed with HTTP ${String(result.response.status)}.`);
  }
  return uuid(result.body.organizationId, "Organization ID");
}

async function listDeadLetters(cookie) {
  const result = await request(
    `${productUrl}/api/platform/job-dead-letters?view=all`,
    "GET",
    undefined,
    cookie,
  );
  if (result.response.status !== 200 || !Array.isArray(result.body?.deadLetters)) {
    throw new Error(`Queue dead-letter list failed with HTTP ${String(result.response.status)}.`);
  }
  return result.body.deadLetters;
}

async function createFailureAudition(cookie) {
  const result = await request(
    `${organizationHost}/api/organization/auditions`,
    "POST",
    {
      availabilityNotes: "Qualification-owned failure fixture; do not contact.",
      email: failureEmail,
      experience: "",
      name: failureName,
      phone: "",
      requestedSlots: [],
      status: "pending",
      voicePart: "S1",
    },
    cookie,
  );
  if (result.response.status !== 201 || typeof result.body?.id !== "string") {
    throw new Error(
      `Failure audition creation failed with HTTP ${String(result.response.status)}.`,
    );
  }
  return {
    createdAt:
      typeof result.body.createdAt === "string" ? result.body.createdAt : new Date().toISOString(),
    id: uuid(result.body.id, "audition ID"),
  };
}

async function deleteFailureAudition(cookie, auditionId) {
  const result = await request(
    `${organizationHost}/api/organization/auditions/${encodeURIComponent(auditionId)}`,
    "DELETE",
    undefined,
    cookie,
  );
  if (result.response.status !== 200) {
    throw new Error(
      `Failure audition deletion failed with HTTP ${String(result.response.status)}.`,
    );
  }
}

export function ownedFailureRows(rows, baselineIds, organizationId) {
  return rows.filter(
    (row) =>
      typeof row?.id === "string" &&
      !baselineIds.has(row.id) &&
      row.organizationId === organizationId &&
      row.jobKind === "audition_notification" &&
      typeof row.idempotencyKey === "string" &&
      row.idempotencyKey.startsWith("audition-notification:"),
  );
}

async function waitForOwnedDeadLetters(cookie, baselineIds, organizationId) {
  for (let attempt = 0; attempt < pollingAttempts; attempt += 1) {
    if (attempt === 0 || (attempt + 1) % 3 === 0) {
      console.log(`WAIT queue dead letter (${String(attempt + 1)}/${String(pollingAttempts)})`);
    }
    const rows = ownedFailureRows(await listDeadLetters(cookie), baselineIds, organizationId);
    if (rows.length > 0) return rows;
    if (attempt < pollingAttempts - 1) await sleep(pollingDelayMs);
  }
  return [];
}

async function dismissDeadLetter(cookie, deadLetterId) {
  const result = await request(
    `${productUrl}/api/platform/job-dead-letters/${encodeURIComponent(deadLetterId)}/dismiss`,
    "POST",
    { reason: "Qualification-owned source was deleted before notification delivery." },
    cookie,
  );
  return result.response.status === 200 && result.body?.actionStatus === "dismissed";
}

async function repeatedDismissalRejected(cookie, deadLetterId) {
  const result = await request(
    `${productUrl}/api/platform/job-dead-letters/${encodeURIComponent(deadLetterId)}/dismiss`,
    "POST",
    { reason: "Qualification-owned duplicate dismissal guard check." },
    cookie,
  );
  return result.response.status === 409 && result.body?.code === "job_dead_letter_dismissed";
}

async function main() {
  if (planOnly) {
    for (const step of queueDeadLetterQualificationPlan()) console.log(`- ${step}`);
    return;
  }

  const readline = createInterface({ input, output });
  let cookie = null;
  let auditionId = null;
  let deleted = false;
  try {
    cookie = await signIn(readline);
    await verifyPlatformFactor(readline, cookie);
    const organizationId = await resolveOrganizationId(cookie);
    const baseline = await listDeadLetters(cookie);
    const baselineIds = new Set(
      baseline.map((row) => row?.id).filter((id) => typeof id === "string"),
    );

    const fixture = await createFailureAudition(cookie);
    auditionId = fixture.id;
    console.log("PASS qualification-owned audition failure fixture created");
    await deleteFailureAudition(cookie, fixture.id);
    deleted = true;
    console.log("PASS qualification-owned audition source deleted before delivery");

    const deadLetters = await waitForOwnedDeadLetters(cookie, baselineIds, organizationId);
    const qualificationOwned =
      deadLetters.length > 0 &&
      deadLetters.every(
        (row) => row.organizationId === organizationId && row.jobKind === "audition_notification",
      );
    console.log(
      `${qualificationOwned ? "PASS" : "FAIL"} qualification-owned queue dead letter observed`,
    );
    if (!qualificationOwned) {
      throw new Error(
        "No newly created Organization-owned audition notification dead letter was observed.",
      );
    }

    let dismissalCount = 0;
    let duplicateDismissalRejected = true;
    for (const row of deadLetters) {
      if (await dismissDeadLetter(cookie, uuid(row.id, "dead-letter ID"))) dismissalCount += 1;
      if (!(await repeatedDismissalRejected(cookie, uuid(row.id, "dead-letter ID")))) {
        duplicateDismissalRejected = false;
      }
    }
    const dismissed = dismissalCount === deadLetters.length;
    console.log(`${dismissed ? "PASS" : "FAIL"} qualification-owned dead-letter dismissal`);
    console.log(`${duplicateDismissalRejected ? "PASS" : "FAIL"} duplicate dismissal guard`);
    if (!dismissed || !duplicateDismissalRejected) {
      throw new Error(
        "Qualification-owned dead-letter dismissal did not satisfy its guard checks.",
      );
    }

    console.log(
      JSON.stringify(
        safeQueueDeadLetterSummary({
          cleanupCompleted: deleted,
          deadLetterCount: deadLetters.length,
          dismissalCount,
          duplicateDismissalRejected,
          qualificationOwned,
        }),
      ),
    );
  } finally {
    if (auditionId && !deleted && cookie) {
      try {
        await deleteFailureAudition(cookie, auditionId);
        deleted = true;
      } catch {
        // Keep the failure output generic and avoid printing temporary fixture identifiers.
        console.error("Qualification audition cleanup did not complete.");
      }
    }
    readline.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
