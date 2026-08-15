import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(repositoryRoot, ".cache");
const CACHE_FILE = join(CACHE_DIR, "staging-session.json");

export function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.trim().toUpperCase().replace(/=+$/u, "");
  const bytes = [];
  let bitBuffer = 0;
  let bitCount = 0;

  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) {
      throw new Error("The TOTP secret is not valid base32.");
    }
    bitBuffer = (bitBuffer << 5) | index;
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((bitBuffer >>> bitCount) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

export async function generateTotp(secretOrUri, now = Date.now()) {
  let secret = secretOrUri.trim();
  if (secret.startsWith("otpauth://")) {
    const parsed = new URL(secret);
    const secretParam = parsed.searchParams.get("secret");
    if (!secretParam) {
      throw new Error("The TOTP URI does not contain a secret parameter.");
    }
    secret = secretParam;
  }
  const counter = BigInt(Math.floor(now / 30_000));
  const counterBytes = new ArrayBuffer(8);
  new DataView(counterBytes).setBigUint64(0, counter);
  const key = await crypto.subtle.importKey(
    "raw",
    decodeBase32(secret),
    { hash: "SHA-1", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
  const lastByte = signature.at(-1);
  if (lastByte === undefined) {
    throw new Error("The TOTP signature is empty.");
  }
  const offset = lastByte & 0x0f;
  const byte0 = signature[offset];
  const byte1 = signature[offset + 1];
  const byte2 = signature[offset + 2];
  const byte3 = signature[offset + 3];
  if (byte0 === undefined || byte1 === undefined || byte2 === undefined || byte3 === undefined) {
    throw new Error("The TOTP signature has an invalid dynamic offset.");
  }
  const binary =
    ((byte0 & 0x7f) << 24) | ((byte1 & 0xff) << 16) | ((byte2 & 0xff) << 8) | (byte3 & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function cookieValue(cookieHeader, cookieKind) {
  const names = new Set([
    `choir-management.${cookieKind}`,
    `__Secure-choir-management.${cookieKind}`,
    `__Host-choir-management.${cookieKind}`,
    `choir-management-${cookieKind}`,
    `__Secure-choir-management-${cookieKind}`,
    `__Host-choir-management-${cookieKind}`,
  ]);

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (names.has(name)) return part.slice(separator + 1).trim();
  }
  return null;
}

export function hasUsableSessionCookie(cookieHeader) {
  return Boolean(cookieValue(cookieHeader, "session_token"));
}

function hasCookie(cookieHeader, cookieKind) {
  return Boolean(cookieValue(cookieHeader, cookieKind));
}

export function sessionCookieFromResponse(response) {
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""];
  return setCookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

export function readCachedSession(productUrl, email) {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    const content = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
    if (
      typeof content?.sessionCookie === "string" &&
      hasUsableSessionCookie(content.sessionCookie) &&
      (!productUrl || content.productUrl === productUrl) &&
      (!email || content.email === email.trim().toLowerCase()) &&
      typeof content.savedAt === "number" &&
      Date.now() - content.savedAt < 6 * 24 * 60 * 60 * 1000
    ) {
      return content.sessionCookie;
    }
  } catch {
    // Ignore corrupt cache
  }
  return null;
}

export function saveCachedSession(productUrl, email, sessionCookie) {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true });
    }
    const data = {
      email: email.trim().toLowerCase(),
      productUrl,
      savedAt: Date.now(),
      sessionCookie,
    };
    writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
  } catch {
    // Non-fatal if cache cannot be written
  }
}

export function clearCachedSession() {
  if (existsSync(CACHE_FILE)) {
    rmSync(CACHE_FILE, { force: true });
    console.log("Cached staging session was cleared.");
  }
}

async function verifySessionValidity(productUrl, cookie) {
  try {
    const response = await fetch(`${productUrl}/api/auth/get-session`, {
      headers: {
        accept: "application/json",
        cookie,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 200) {
      const data = await response.json().catch(() => null);
      if (data && typeof data === "object" && data.user) {
        return true;
      }
    }
  } catch {
    // Network or server error
  }
  return false;
}

export async function passwordSignIn(productUrl, email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  const response = await fetch(`${productUrl}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email: normalizedEmail, password }),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: new URL(productUrl).origin,
    },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });

  const responseBody = await response.json().catch(() => null);
  if (!response.ok) {
    const code = responseBody?.code ? ` (${responseBody.code})` : "";
    throw new Error(`Password sign-in failed with HTTP ${String(response.status)}${code}.`);
  }

  const sessionCookie = sessionCookieFromResponse(response);
  if (responseBody?.twoFactorRedirect === true) {
    if (!hasCookie(sessionCookie, "two_factor")) {
      throw new Error("Password sign-in returned a second-factor challenge without its cookie.");
    }
    return { sessionCookie, twoFactorRequired: true };
  }
  if (!hasUsableSessionCookie(sessionCookie)) {
    throw new Error("The password sign-in response did not return a session cookie.");
  }
  return { sessionCookie, twoFactorRequired: false };
}

async function verifyPasswordSignInSecondFactor(productUrl, challengeCookie) {
  const readline = createInterface({ input, output });
  let lastError = null;

  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const code = (
        await readline.question(
          attempt === 1
            ? "Password sign-in requires account MFA. Enter a 6-digit authenticator code or recovery code: "
            : "Account MFA verification failed. Enter the current code or recovery code: ",
        )
      ).trim();

      if (!code || code.toLowerCase() === "skip") {
        throw new Error("Account MFA verification was skipped.");
      }

      const method = /^\d{6}$/u.test(code) ? "totp" : "recovery_code";
      const path =
        method === "totp"
          ? "/api/auth/two-factor/verify-totp"
          : "/api/auth/two-factor/verify-backup-code";
      const response = await fetch(`${productUrl}${path}`, {
        body: JSON.stringify({ code, trustDevice: false }),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          cookie: challengeCookie,
          origin: new URL(productUrl).origin,
        },
        method: "POST",
        signal: AbortSignal.timeout(15_000),
      });

      const responseBody = await response.json().catch(() => null);
      const sessionCookie = sessionCookieFromResponse(response);
      if (response.ok && hasUsableSessionCookie(sessionCookie)) {
        if (await verifySessionValidity(productUrl, sessionCookie)) {
          console.log("✅ Account password sign-in MFA verified successfully.");
          return sessionCookie;
        }
        lastError = "the second-factor response did not create a valid session";
      } else {
        lastError =
          responseBody?.message ??
          `Account MFA verification failed with HTTP ${String(response.status)}.`;
      }
      console.log(`Account MFA verification rejected: ${lastError}`);
    }
  } finally {
    readline.close();
  }

  throw new Error(
    `Account MFA verification failed after 3 attempts: ${lastError ?? "invalid code"}`,
  );
}

export async function otpSignIn(productUrl, email) {
  const normalizedEmail = email.trim().toLowerCase();
  const otpRequest = await fetch(`${productUrl}/api/auth/email-otp/send-verification-otp`, {
    body: JSON.stringify({ email: normalizedEmail, type: "sign-in" }),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: new URL(productUrl).origin,
    },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  if (!otpRequest.ok) {
    throw new Error(`Sign-in code request failed with HTTP ${String(otpRequest.status)}.`);
  }
  console.log(`A sign-in code was requested for ${normalizedEmail}.`);

  const readline = createInterface({ input, output });
  let sessionCookie = null;
  let lastError = null;

  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const code = (
        await readline.question(
          attempt === 1
            ? "Enter the six-digit sign-in code sent to your email: "
            : "Invalid code. Enter the current six-digit sign-in code: ",
        )
      ).trim();

      if (!/^\d{6}$/u.test(code)) {
        console.log("The sign-in code must contain exactly six digits.");
        continue;
      }

      const signInResponse = await fetch(`${productUrl}/api/auth/sign-in/email-otp`, {
        body: JSON.stringify({ email: normalizedEmail, otp: code }),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          origin: new URL(productUrl).origin,
        },
        method: "POST",
        signal: AbortSignal.timeout(15_000),
      });

      if (signInResponse.ok) {
        sessionCookie = sessionCookieFromResponse(signInResponse);
        if (hasUsableSessionCookie(sessionCookie)) {
          break;
        }
      }

      const errorBody = await signInResponse.json().catch(() => null);
      lastError =
        errorBody?.message ?? `Sign-in request failed with HTTP ${String(signInResponse.status)}.`;
      console.log(`Sign-in failed: ${lastError}`);
    }
  } finally {
    readline.close();
  }

  if (!sessionCookie || !hasUsableSessionCookie(sessionCookie)) {
    throw new Error(`Sign-in failed after 3 attempts: ${lastError ?? "invalid code"}`);
  }

  return sessionCookie;
}

export async function getStagingSession(options = {}) {
  const productUrl = (
    options.productUrl ??
    process.env.STAGING_PRODUCT_URL ??
    "https://staging.musicsite.org"
  ).replace(/\/$/u, "");
  let email = (options.email ?? process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com")
    .trim()
    .toLowerCase();
  const explicitCookie = options.sessionCookie ?? process.env.STAGING_SESSION_COOKIE?.trim();
  const password = options.password ?? process.env.STAGING_AUTH_PASSWORD?.trim();
  const noCache = options.noCache === true;

  if (explicitCookie && hasUsableSessionCookie(explicitCookie)) {
    return explicitCookie;
  }

  if (!noCache) {
    const cached = readCachedSession(productUrl, email);
    if (cached) {
      const isValid = await verifySessionValidity(productUrl, cached);
      if (isValid) {
        return cached;
      }
      clearCachedSession();
    }
  }

  let cookie = null;

  // 1. Try password if provided in options or env
  if (password) {
    try {
      const passwordResult = await passwordSignIn(productUrl, email, password);
      cookie = passwordResult.twoFactorRequired
        ? await verifyPasswordSignInSecondFactor(productUrl, passwordResult.sessionCookie)
        : passwordResult.sessionCookie;
    } catch (err) {
      cookie = null;
      console.log(
        `Password authentication for ${email} failed (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
  }

  // 2. If no password or failed, prompt interactively
  if (!cookie) {
    const readline = createInterface({ input, output });
    try {
      const enteredEmail = (await readline.question(`Email / Username [${email}]: `)).trim();
      if (enteredEmail) email = enteredEmail.toLowerCase();

      const selectedMethod = (
        await readline.question("Sign in method: [1] Password, [2] Email OTP [1]: ")
      ).trim();

      if (selectedMethod === "2") {
        readline.close();
        cookie = await otpSignIn(productUrl, email);
      } else {
        const enteredPassword = (await readline.question("Password: ")).trim();
        readline.close();
        if (enteredPassword) {
          try {
            const passwordResult = await passwordSignIn(productUrl, email, enteredPassword);
            cookie = passwordResult.twoFactorRequired
              ? await verifyPasswordSignInSecondFactor(productUrl, passwordResult.sessionCookie)
              : passwordResult.sessionCookie;
          } catch (err) {
            console.log(
              `Password sign-in failed (${err instanceof Error ? err.message : String(err)}). Sending Email OTP instead...`,
            );
            cookie = await otpSignIn(productUrl, email);
          }
        } else {
          console.log("No password entered. Requesting Email OTP...");
          cookie = await otpSignIn(productUrl, email);
        }
      }
    } catch (err) {
      readline.close();
      throw err;
    }
  }

  if (cookie && !(await verifySessionValidity(productUrl, cookie))) {
    throw new Error("Staging sign-in did not create a valid authenticated session.");
  }

  if (!noCache && cookie) {
    saveCachedSession(productUrl, email, cookie);
  }

  return cookie;
}

export async function getPlatformAdminSession(options = {}) {
  const productUrl = (
    options.productUrl ??
    process.env.STAGING_PRODUCT_URL ??
    "https://staging.musicsite.org"
  ).replace(/\/$/u, "");
  const cookie = await getStagingSession(options);
  const totpSecret =
    options.totpSecret ??
    process.env.STAGING_PLATFORM_TOTP_SECRET ??
    process.env.STAGING_PLATFORM_TOTP_URI;

  // 1. Check if the session already has an active, unexpired Platform Admin MFA assertion.
  const contextResponse = await fetch(`${productUrl}/api/platform/context`, {
    headers: {
      accept: "application/json",
      cookie,
      origin: new URL(productUrl).origin,
    },
    method: "GET",
    signal: AbortSignal.timeout(15_000),
  });

  if (contextResponse.status === 200) {
    return cookie;
  }

  // 2. Check Platform Administrator MFA status
  const mfaStatusResponse = await fetch(`${productUrl}/api/platform/mfa/status`, {
    headers: {
      accept: "application/json",
      cookie,
      origin: new URL(productUrl).origin,
    },
    method: "GET",
    signal: AbortSignal.timeout(15_000),
  });

  if (mfaStatusResponse.status === 200) {
    const statusData = await mfaStatusResponse.json().catch(() => null);
    if (statusData && !statusData.activePlatformAdministrator) {
      console.log(
        "⚠️  The authenticated account is not an active Platform Administrator; continuing with Organization session.",
      );
      return cookie;
    }
  }

  // 3. Try automatic TOTP if secret is provided
  if (totpSecret) {
    try {
      const mfaCode = await generateTotp(totpSecret);
      const verifyResponse = await fetch(`${productUrl}/api/platform/mfa/verify`, {
        body: JSON.stringify({ code: mfaCode, method: "totp" }),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          cookie,
          origin: new URL(productUrl).origin,
        },
        method: "POST",
        signal: AbortSignal.timeout(15_000),
      });

      if (verifyResponse.status === 200) {
        return cookie;
      }
    } catch {
      // Fall through to interactive prompt
    }
  }

  // 4. Prompt for MFA / Recovery code
  const readline = createInterface({ input, output });
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const code = (
        await readline.question(
          attempt === 1
            ? "Enter Platform Authenticator 6-digit code or Backup recovery code (or 'skip'): "
            : "Verification failed. Enter current 6-digit code or recovery code (or 'skip'): ",
        )
      ).trim();

      if (!code || code.toLowerCase() === "skip") {
        console.log("Skipping Platform Administrator MFA elevation for this run.");
        return cookie;
      }

      const method = /^\d{6}$/u.test(code) ? "totp" : "recovery_code";
      const verifyResponse = await fetch(`${productUrl}/api/platform/mfa/verify`, {
        body: JSON.stringify({ code, method }),
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          cookie,
          origin: new URL(productUrl).origin,
        },
        method: "POST",
        signal: AbortSignal.timeout(15_000),
      });

      if (verifyResponse.status === 200) {
        console.log("✅ Platform Administrator MFA verified successfully.");
        return cookie;
      }

      const errorBody = await verifyResponse.json().catch(() => null);
      const msg = errorBody?.message ?? `HTTP ${String(verifyResponse.status)}`;
      console.log(`MFA verification rejected: ${msg}`);
    }
  } finally {
    readline.close();
  }

  console.log("⚠️  Continuing with standard Organization Administrator session.");
  return cookie;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.includes("--clear-cache")) {
    clearCachedSession();
  } else if (process.argv.includes("--status")) {
    const cached = readCachedSession();
    console.log(
      cached
        ? "A cached staging session token is present in .cache/staging-session.json"
        : "No cached staging session found.",
    );
  }
}
