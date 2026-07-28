import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();

async function post(path, body) {
  const response = await fetch(`${productUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Authentication request failed with HTTP ${String(response.status)}.`);
  }
  return response;
}

await post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
console.log(`A sign-in code was requested for ${email}.`);

const readline = createInterface({ input, output });
let code;
try {
  code = (await readline.question("Enter the six-digit code (it is not recorded): ")).trim();
} finally {
  readline.close();
}

if (!/^\d{6}$/.test(code)) {
  throw new Error("The sign-in code must contain exactly six digits.");
}

const signInResponse = await post("/api/auth/sign-in/email-otp", { email, otp: code });
const setCookies =
  typeof signInResponse.headers.getSetCookie === "function"
    ? signInResponse.headers.getSetCookie()
    : [signInResponse.headers.get("set-cookie") ?? ""];
const sessionCookie = setCookies
  .map((cookie) => cookie.split(";", 1)[0])
  .filter(Boolean)
  .join("; ");

if (!sessionCookie.includes("choir-management.session_token=")) {
  throw new Error("The sign-in response did not return a staging session cookie.");
}

const result = spawnSync("node", ["scripts/qualify-staging-auth.mjs"], {
  env: {
    ...process.env,
    STAGING_AUTH_EMAIL: email,
    STAGING_SESSION_COOKIE: sessionCookie,
  },
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
