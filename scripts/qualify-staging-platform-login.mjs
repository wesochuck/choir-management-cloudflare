import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const organizationSlug = (process.env.STAGING_ORG_SLUG ?? "lcc").trim().toLowerCase();
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
const productOrigin = new URL(productUrl).origin;

if (!/^[a-z0-9-]+$/.test(organizationSlug)) {
  throw new Error("STAGING_ORG_SLUG must contain only lowercase letters, numbers, or hyphens.");
}

const organizationUrl = `https://${organizationSlug}.${new URL(productUrl).hostname}`;

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
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // The qualification reports the status without printing an unexpected response body.
  }
  return { body: parsed, status: response.status };
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
  if (otpRequest.status !== 200) {
    throw new Error(`Sign-in code request failed with HTTP ${String(otpRequest.status)}.`);
  }
  console.log(`A sign-in code was requested for ${email}.`);
  const signInCode = await prompt(readline, "Enter the six-digit sign-in code (not recorded): ");
  if (!/^\d{6}$/.test(signInCode)) {
    throw new Error("The sign-in code must contain exactly six digits.");
  }

  const signInResponse = await fetch(`${productUrl}/api/auth/sign-in/email-otp`, {
    body: JSON.stringify({ email, otp: signInCode }),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: productOrigin,
    },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  if (!signInResponse.ok) {
    throw new Error(`Sign-in request failed with HTTP ${String(signInResponse.status)}.`);
  }
  const cookie = sessionCookieFrom(signInResponse);
  if (!cookie.includes("choir-management.session_token=")) {
    throw new Error("The sign-in response did not return a staging session cookie.");
  }
  return cookie;
}

async function main() {
  const readline = createInterface({ input, output });
  try {
    const cookie = await signIn(readline);
    const mfaStatus = await request(
      `${productUrl}/api/platform/mfa/status`,
      "GET",
      undefined,
      cookie,
    );
    if (mfaStatus.status !== 200) {
      throw new Error(`Platform MFA status failed with HTTP ${String(mfaStatus.status)}.`);
    }

    const mfaCode = await prompt(
      readline,
      "Enter the six-digit Platform authenticator code (not recorded): ",
    );
    if (!/^\d{6}$/.test(mfaCode)) {
      throw new Error("The Platform authenticator code must contain exactly six digits.");
    }
    const verification = await request(
      `${productUrl}/api/platform/mfa/verify`,
      "POST",
      { code: mfaCode, method: "totp" },
      cookie,
    );
    if (verification.status !== 200) {
      throw new Error(`Platform MFA verification failed with HTTP ${String(verification.status)}.`);
    }

    const probes = [
      {
        label: "platform queue settings",
        method: "GET",
        url: `${productUrl}/api/platform/queue-settings`,
        valid: (body) =>
          typeof body?.queue === "string" &&
          typeof body?.deadLetterQueue === "string" &&
          typeof body?.mode === "string",
      },
      {
        label: "platform queue settings generation",
        method: "POST",
        body: {},
        url: `${productUrl}/api/platform/queue-settings/generate`,
        valid: (body) => body?.generated === true,
      },
      {
        label: `platform reconciliation report (${organizationSlug})`,
        method: "GET",
        url: `${organizationUrl}/api/platform/reconciliation-report`,
        valid: (body) => typeof body === "object" && body !== null,
      },
    ];

    let failures = 0;
    for (const probe of probes) {
      const result = await request(probe.url, probe.method, probe.body, cookie);
      const passed = result.status === 200 && probe.valid(result.body);
      console.log(`${passed ? "PASS" : "FAIL"} ${probe.label}`);
      if (!passed) failures += 1;
    }

    console.log(
      `\nPlatform staging evidence: ${String(probes.length - failures)} passed, ${String(failures)} failed; no maintenance, provisioning, queue retry, or provider action was invoked.`,
    );
    if (failures > 0) process.exitCode = 1;
  } finally {
    readline.close();
  }
}

await main();
