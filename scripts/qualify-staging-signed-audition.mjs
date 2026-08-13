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
const auditionEmail = (
  process.env.STAGING_AUDITION_EMAIL ?? "qual-audition-20260812-luna@qa-mail.staging.musicsite.org"
)
  .trim()
  .toLowerCase();
const organizationHost = `https://${organizationSlug}.${new URL(productUrl).hostname}`;
const wrongOrganizationHost = `https://${wrongOrganizationSlug}.${new URL(productUrl).hostname}`;
const planOnly = process.argv.includes("--plan-only");

if (!/^[a-z0-9-]+$/.test(organizationSlug) || !/^[a-z0-9-]+$/.test(wrongOrganizationSlug)) {
  throw new Error("Organization slugs must contain only lowercase letters, numbers, or hyphens.");
}
if (organizationSlug === wrongOrganizationSlug) {
  throw new Error("The wrong-Organization host must be different from the target host.");
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

function fixtureName() {
  return `QUAL-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)} audition`;
}

export function signedAuditionQualificationPlan() {
  return [
    "create and schedule one disposable audition through the supported Organization APIs",
    "wait for its normal audition notification without inspecting provider payloads",
    "accept the audition URL only in the local process and never print or persist its token",
    "verify LCC details and an allowed public update",
    "verify the same signed value is rejected on the LMC Organization host",
    "delete the temporary inquiry and verify the old link is revoked",
  ];
}

export function parseSignedAuditionUrl(value, expectedHost) {
  const url = new URL(value);
  if (url.origin !== expectedHost || url.pathname !== "/auditions") {
    throw new Error("The entered URL must be the LCC audition URL from the qualification email.");
  }
  const token = url.searchParams.get("token") ?? "";
  if (token.length < 1 || token.length > 4_096) {
    throw new Error("The entered audition URL did not contain a valid token parameter.");
  }
  return token;
}

export function safeAuditionQualificationSummary(input) {
  return {
    crossOrganizationRejected: input.crossOrganizationRejected === true,
    deleted: input.deleted === true,
    detailsValid: input.detailsValid === true,
    auditionId: input.auditionId,
    updateAllowed: input.updateAllowed === true,
    revoked: input.revoked === true,
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

async function createAudition(cookie, name) {
  const { body, response } = await jsonRequest(
    `${organizationHost}/api/organization/auditions`,
    "POST",
    cookie,
    {
      availabilityNotes: "Controlled signed-link qualification.",
      email: auditionEmail,
      experience: "Controlled qualification fixture.",
      name,
      performanceId: null,
      phone: "",
      requestedSlots: [],
      status: "pending",
      voicePart: "S1",
    },
  );
  if (response.status !== 201 || typeof body?.id !== "string") {
    throw new Error(`Audition creation failed with HTTP ${String(response.status)}.`);
  }
  return body.id;
}

async function scheduleAudition(cookie, auditionId) {
  const { response } = await jsonRequest(
    `${organizationHost}/api/organization/auditions/${auditionId}`,
    "PUT",
    cookie,
    {
      scheduledTimeSlot: new Date(Date.now() + 48 * 60 * 60 * 1_000).toISOString(),
      status: "scheduled",
    },
  );
  if (response.status !== 200) {
    throw new Error(`Audition scheduling failed with HTTP ${String(response.status)}.`);
  }
}

async function deleteAudition(cookie, auditionId) {
  const { response } = await jsonRequest(
    `${organizationHost}/api/organization/auditions/${auditionId}`,
    "DELETE",
    cookie,
  );
  if (response.status !== 200) {
    throw new Error(`Audition cleanup failed with HTTP ${String(response.status)}.`);
  }
}

async function readDetails(host, token) {
  return jsonRequest(`${host}/api/public/audition-details`, "POST", "", { token });
}

async function submitUpdate(host, token) {
  return jsonRequest(`${host}/api/public/audition-submit`, "POST", "", {
    availabilityNotes: "Updated through the controlled signed-link qualification.",
    token,
    voicePart: "S1",
  });
}

async function main() {
  if (planOnly) {
    for (const step of signedAuditionQualificationPlan()) console.log(`- ${step}`);
    return;
  }

  const readline = createInterface({ input, output });
  let cookie = "";
  let auditionId = null;
  let deleted = false;
  const summary = {
    crossOrganizationRejected: false,
    deleted: false,
    detailsValid: false,
    auditionId: null,
    updateAllowed: false,
    revoked: false,
  };
  try {
    cookie = await signIn(readline);
    auditionId = await createAudition(cookie, fixtureName());
    summary.auditionId = auditionId;
    console.log(`PASS temporary audition created (${auditionId})`);
    await scheduleAudition(cookie, auditionId);
    console.log("PASS temporary audition scheduled");

    const enteredUrl = await prompt(
      readline,
      "Paste the audition URL from the controlled qualification email (local terminal only): ",
    );
    const token = parseSignedAuditionUrl(enteredUrl, organizationHost);
    const details = await readDetails(organizationHost, token);
    summary.detailsValid =
      details.response.status === 200 &&
      details.body?.id === auditionId &&
      details.body?.status === "scheduled";
    console.log(`${summary.detailsValid ? "PASS" : "FAIL"} signed audition LCC details`);
    if (!summary.detailsValid) throw new Error("Valid LCC audition details were not returned.");

    const update = await submitUpdate(organizationHost, token);
    summary.updateAllowed = update.response.status === 200;
    console.log(`${summary.updateAllowed ? "PASS" : "FAIL"} signed audition public update`);
    if (!summary.updateAllowed) throw new Error("Signed audition public update failed.");

    const crossOrganization = await readDetails(wrongOrganizationHost, token);
    summary.crossOrganizationRejected = crossOrganization.response.status === 404;
    console.log(
      `${summary.crossOrganizationRejected ? "PASS" : "FAIL"} signed audition cross-Organization boundary`,
    );
    if (!summary.crossOrganizationRejected) {
      throw new Error("Signed audition was accepted on the wrong Organization host.");
    }

    await deleteAudition(cookie, auditionId);
    deleted = true;
    summary.deleted = true;
    const revoked = await readDetails(organizationHost, token);
    summary.revoked = revoked.response.status === 404;
    console.log(`${summary.revoked ? "PASS" : "FAIL"} signed audition revocation after delete`);
    if (!summary.revoked) throw new Error("Deleted audition still accepted its signed link.");

    console.log(JSON.stringify(safeAuditionQualificationSummary(summary)));
  } finally {
    if (cookie && auditionId && !deleted) {
      await deleteAudition(cookie, auditionId).catch(() => undefined);
    }
    readline.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
