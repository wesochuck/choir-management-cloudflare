import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getStagingSession } from "./staging-auth-helper.mjs";
import { pathToFileURL } from "node:url";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const organizationSlug = (process.env.STAGING_ORG_SLUG ?? "lcc").trim().toLowerCase();
const wrongOrganizationSlug = (process.env.STAGING_SECOND_ORG_SLUG ?? "lmc").trim().toLowerCase();
const oldEmail = (
  process.env.STAGING_EMAIL_CHANGE_OLD ??
  "qual-email-old-20260812-luna@qa-mail.staging.musicsite.org"
)
  .trim()
  .toLowerCase();
const newEmail = (
  process.env.STAGING_EMAIL_CHANGE_NEW ??
  "qual-email-new-20260812-luna@qa-mail.staging.musicsite.org"
)
  .trim()
  .toLowerCase();
const organizationHost = `https://${organizationSlug}.${new URL(productUrl).hostname}`;
const wrongOrganizationHost = `https://${wrongOrganizationSlug}.${new URL(productUrl).hostname}`;
const planOnly = process.argv.includes("--plan-only");
const resumeSecondCycle = process.argv.includes("--resume-second-cycle");

if (!/^[a-z0-9-]+$/.test(organizationSlug) || !/^[a-z0-9-]+$/.test(wrongOrganizationSlug)) {
  throw new Error("Organization slugs must contain only lowercase letters, numbers, or hyphens.");
}
if (organizationSlug === wrongOrganizationSlug) {
  throw new Error("The wrong-Organization host must be different from the target host.");
}
if (oldEmail === newEmail) throw new Error("Email-change aliases must be different.");

export function signedEmailChangeQualificationPlan() {
  return [
    "request a disposable-account email change from alias A to alias B",
    "confirm the B-address link through the supported browser API route",
    "verify replay and wrong-Organization rejection without printing the token",
    "sign in as B and perform a second controlled cycle back to A",
    "verify both cycles return the confirmed identity and leave no token in output",
  ];
}

export function parseSignedEmailChangeUrl(value, expectedHost) {
  const url = new URL(value);
  if (url.origin !== expectedHost || url.pathname !== "/confirm-email-change") {
    throw new Error(
      "The entered URL must be the LCC email-change URL from the qualification email.",
    );
  }
  const token = url.searchParams.get("token") ?? "";
  if (token.length < 16 || token.length > 4_096 || !/^[A-Za-z0-9._-]+$/.test(token)) {
    throw new Error("The entered email-change URL did not contain a valid token parameter.");
  }
  return token;
}

export function safeEmailChangeQualificationSummary(input) {
  return {
    crossOrganizationRejected: input.crossOrganizationRejected === true,
    firstConfirmed: input.firstConfirmed === true,
    firstReplayRejected: input.firstReplayRejected === true,
    secondConfirmed: input.secondConfirmed === true,
    secondReplayRejected: input.secondReplayRejected === true,
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

async function signIn(loginEmail) {
  return getStagingSession({
    email: loginEmail,
    productUrl,
  });
}

async function requestChange(cookie, requestedEmail) {
  const { body, response } = await jsonRequest(
    `${organizationHost}/api/singer/profile/email-change`,
    "POST",
    cookie,
    { email: requestedEmail },
  );
  if (response.status !== 200 || body?.status !== "pending") {
    throw new Error(`Email-change request failed with HTTP ${String(response.status)}.`);
  }
}

async function confirmChange(host, token) {
  return jsonRequest(`${host}/api/account/email-change/confirm`, "POST", "", { token });
}

async function runCycle(readline, cookie, fromEmail, toEmail) {
  await requestChange(cookie, toEmail);
  console.log(`PASS email-change request from ${fromEmail} to ${toEmail}`);
  const enteredUrl = await prompt(
    readline,
    `Paste the confirmation URL from ${toEmail} (local terminal only): `,
  );
  const token = parseSignedEmailChangeUrl(enteredUrl, organizationHost);
  const confirmation = await confirmChange(organizationHost, token);
  if (confirmation.response.status !== 200 || confirmation.body?.status !== "confirmed") {
    throw new Error(
      `Email-change confirmation failed with HTTP ${String(confirmation.response.status)}.`,
    );
  }
  const confirmedEmail = String(confirmation.body?.email ?? "").toLowerCase();
  if (confirmedEmail !== toEmail)
    throw new Error("Email-change confirmation returned the wrong identity.");
  const replay = await confirmChange(organizationHost, token);
  const replayRejected = replay.response.status === 400;
  console.log(`${replayRejected ? "PASS" : "FAIL"} email-change consumed-link replay rejection`);
  if (!replayRejected) throw new Error("Consumed email-change link was accepted again.");
  return { confirmed: true, replayRejected, token };
}

async function main() {
  if (planOnly) {
    for (const step of signedEmailChangeQualificationPlan()) console.log(`- ${step}`);
    return;
  }

  const readline = createInterface({ input, output });
  const summary = {
    crossOrganizationRejected: false,
    firstConfirmed: false,
    firstReplayRejected: false,
    secondConfirmed: false,
    secondReplayRejected: false,
  };
  try {
    if (resumeSecondCycle) {
      const newCookie = await signIn(newEmail);
      const second = await runCycle(readline, newCookie, newEmail, oldEmail);
      const wrongHost = await confirmChange(wrongOrganizationHost, second.token);
      const crossOrganizationRejected = wrongHost.response.status === 400;
      console.log(
        `${crossOrganizationRejected ? "PASS" : "FAIL"} email-change cross-Organization boundary`,
      );
      if (!crossOrganizationRejected) {
        throw new Error("Email-change token was accepted on the wrong Organization host.");
      }
      console.log(
        JSON.stringify({
          crossOrganizationRejected: true,
          resumedSecondCycle: true,
          secondConfirmed: second.confirmed,
          secondReplayRejected: second.replayRejected,
        }),
      );
      return;
    }
    const oldCookie = await signIn(oldEmail);
    const first = await runCycle(readline, oldCookie, oldEmail, newEmail);
    summary.firstConfirmed = first.confirmed;
    summary.firstReplayRejected = first.replayRejected;

    const wrongHost = await confirmChange(wrongOrganizationHost, first.token);
    summary.crossOrganizationRejected = wrongHost.response.status === 400;
    console.log(
      `${summary.crossOrganizationRejected ? "PASS" : "FAIL"} email-change cross-Organization boundary`,
    );
    if (!summary.crossOrganizationRejected) {
      throw new Error("Email-change token was accepted on the wrong Organization host.");
    }

    const newCookie = await signIn(newEmail);
    const second = await runCycle(readline, newCookie, newEmail, oldEmail);
    summary.secondConfirmed = second.confirmed;
    summary.secondReplayRejected = second.replayRejected;
    console.log(JSON.stringify(safeEmailChangeQualificationSummary(summary)));
  } finally {
    readline.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
