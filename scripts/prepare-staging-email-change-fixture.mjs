import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const organizationHost = `https://lcc.${new URL(productUrl).hostname}`;
const ownerEmail = (process.env.STAGING_FIXTURE_OWNER_EMAIL ?? "cwosborn@gmail.com")
  .trim()
  .toLowerCase();
const fixtureEmail = (
  process.env.STAGING_EMAIL_CHANGE_OLD ??
  "qual-email-old-20260812-luna@qa-mail.staging.musicsite.org"
)
  .trim()
  .toLowerCase();
const fixtureDisplayName =
  process.env.STAGING_EMAIL_CHANGE_PROFILE_NAME ?? "Qualification Email Change Temp 2026-08-13";

const allowedFixtureEmail = /^qual-email-old-20260812-luna@qa-mail\.staging\.musicsite\.org$/;
if (!allowedFixtureEmail.test(fixtureEmail)) {
  throw new Error("This helper only permits the pre-approved staging email-change alias.");
}
if (!/^\S+@\S+\.\S+$/.test(ownerEmail)) throw new Error("A valid owner email is required.");

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

async function request(url, method, cookie, body) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
      ...(cookie ? { cookie } : {}),
      origin: new URL(url).origin,
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
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

async function signIn(readline, email) {
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

function requireArray(body, key) {
  if (!body || typeof body !== "object" || !Array.isArray(body[key])) {
    throw new Error(`The staging ${key} response was invalid.`);
  }
  return body[key];
}

async function listProfiles(cookie) {
  const { body, response } = await request(
    `${organizationHost}/api/organization/profiles`,
    "GET",
    cookie,
  );
  if (response.status !== 200)
    throw new Error(`Profile list failed with HTTP ${String(response.status)}.`);
  return requireArray(body, "profiles");
}

async function createProfile(cookie) {
  const existing = (await listProfiles(cookie)).find(
    (profile) => profile.displayName === fixtureDisplayName,
  );
  if (existing) return existing.id;
  const { body, response } = await request(
    `${organizationHost}/api/organization/profiles`,
    "POST",
    cookie,
    {
      displayName: fixtureDisplayName,
      email: fixtureEmail,
      globalStatus: "Active",
      voicePart: "S1",
    },
  );
  if (response.status !== 201 || !body || typeof body !== "object" || typeof body.id !== "string") {
    throw new Error(`Profile creation failed with HTTP ${String(response.status)}.`);
  }
  return body.id;
}

async function listInvitations(cookie) {
  const { body, response } = await request(
    `${organizationHost}/api/organization/invitations`,
    "GET",
    cookie,
  );
  if (response.status !== 200) {
    throw new Error(`Invitation list failed with HTTP ${String(response.status)}.`);
  }
  return requireArray(body, "invitations");
}

async function listMemberships(cookie) {
  const { body, response } = await request(
    `${organizationHost}/api/organization/members`,
    "GET",
    cookie,
  );
  if (response.status !== 200) {
    throw new Error(`Membership list failed with HTTP ${String(response.status)}.`);
  }
  return requireArray(body, "memberships");
}

async function createInvitation(cookie) {
  const existing = (await listInvitations(cookie)).find(
    (invitation) => invitation.email.toLowerCase() === fixtureEmail,
  );
  if (existing) return existing.id;
  const { body, response } = await request(
    `${organizationHost}/api/organization/invitations`,
    "POST",
    cookie,
    { email: fixtureEmail, role: "member" },
  );
  if (response.status !== 201 || !body || typeof body !== "object" || typeof body.id !== "string") {
    throw new Error(`Invitation creation failed with HTTP ${String(response.status)}.`);
  }
  return body.id;
}

async function acceptInvitation(cookie, invitationId) {
  const { response } = await request(
    `${organizationHost}/api/organization/invitations/${encodeURIComponent(invitationId)}/accept`,
    "POST",
    cookie,
  );
  if (response.status !== 200 && response.status !== 409) {
    throw new Error(`Invitation acceptance failed with HTTP ${String(response.status)}.`);
  }
}

async function linkProfile(cookie, membershipId, profileId) {
  const { response } = await request(
    `${organizationHost}/api/organization/members/${encodeURIComponent(membershipId)}/profile`,
    "PUT",
    cookie,
    { profileId },
  );
  if (response.status !== 200) {
    throw new Error(`Membership Profile link failed with HTTP ${String(response.status)}.`);
  }
}

async function main() {
  const readline = createInterface({ input, output });
  try {
    const ownerCookie = await signIn(readline, ownerEmail);
    const profileId = await createProfile(ownerCookie);
    const membershipsBefore = await listMemberships(ownerCookie);
    const existingMembership = membershipsBefore.find(
      (membership) => membership.email.toLowerCase() === fixtureEmail,
    );
    const invitationId = existingMembership ? null : await createInvitation(ownerCookie);
    if (invitationId) {
      const fixtureCookie = await signIn(readline, fixtureEmail);
      await acceptInvitation(fixtureCookie, invitationId);
    }
    const membership = (await listMemberships(ownerCookie)).find(
      (candidate) => candidate.email.toLowerCase() === fixtureEmail,
    );
    if (!membership) throw new Error("The staging fixture Membership was not created.");
    if (membership.profileId !== profileId) {
      await linkProfile(ownerCookie, membership.id, profileId);
    }
    console.log(`PASS staging email-change fixture ready (${fixtureDisplayName})`);
    console.log("The disposable account is linked to its Profile and ready for qualification.");
  } finally {
    readline.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
