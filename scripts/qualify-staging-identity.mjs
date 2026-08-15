import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getStagingSession } from "./staging-auth-helper.mjs";
import { pathToFileURL } from "node:url";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const productOrigin = new URL(productUrl).origin;
const organizationSlug = (process.env.STAGING_ORG_SLUG ?? "lcc").trim().toLowerCase();
const wrongOrganizationSlug = (process.env.STAGING_SECOND_ORG_SLUG ?? "lmc").trim().toLowerCase();
const ownerEmail = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
const identityEmail = (
  process.env.STAGING_IDENTITY_EMAIL ?? "qual-identity-20260813-luna@qa-mail.staging.musicsite.org"
)
  .trim()
  .toLowerCase();
const fixtureDisplayName =
  process.env.STAGING_IDENTITY_PROFILE_NAME ?? "Qualification Identity Temp 2026-08-13";
const organizationHost = `https://${organizationSlug}.${new URL(productUrl).hostname}`;
const wrongOrganizationHost = `https://${wrongOrganizationSlug}.${new URL(productUrl).hostname}`;
const planOnly = process.argv.includes("--plan-only");
const resumeExisting = process.env.STAGING_IDENTITY_RESUME_EXISTING === "1";

if (!/^[a-z0-9-]+$/.test(organizationSlug) || !/^[a-z0-9-]+$/.test(wrongOrganizationSlug)) {
  throw new Error("Organization slugs must contain only lowercase letters, numbers, or hyphens.");
}
if (organizationSlug === wrongOrganizationSlug) {
  throw new Error("The wrong-Organization host must be different from the target host.");
}
if (!/^qual-identity-[a-z0-9-]+@qa-mail\.staging\.musicsite\.org$/.test(identityEmail)) {
  throw new Error("STAGING_IDENTITY_EMAIL must be an approved qual-identity staging alias.");
}
if (
  !fixtureDisplayName.startsWith("Qualification Identity Temp ") ||
  fixtureDisplayName.length > 200
) {
  throw new Error(
    "STAGING_IDENTITY_PROFILE_NAME must be a bounded Qualification Identity Temp fixture name.",
  );
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

function requestFailure(status, body) {
  const code =
    typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
      ? body.code
      : null;
  return `HTTP ${String(status)}${code ? ` (${code})` : ""}`;
}

export function identityQualificationPlan() {
  return [
    "sign in as the Organization administrator and create or reuse one approved identity Profile",
    "create one pending Organization invitation and sign in as its recipient",
    "verify invitation details are Organization-bound, then accept the invitation",
    "link the invited Membership to the qualification Profile and set its first password",
    "request password recovery, confirm the controlled reset URL, and reject token replay",
    "sign in with the recovered password and verify the wrong Organization cannot read the fixture",
    "retain the named qualification Membership/Profile because no supported user-deletion route exists",
  ];
}

export function parsePasswordResetUrl(value, expectedOrigin) {
  const url = new URL(value);
  if (url.origin !== expectedOrigin || url.pathname !== "/reset-password") {
    throw new Error(
      "The entered URL must be the staging password-reset URL from the qualification email.",
    );
  }
  const token = new URLSearchParams(url.hash.replace(/^#/, "")).get("token") ?? "";
  if (token.length < 16 || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("The entered password-reset URL did not contain a valid token parameter.");
  }
  return token;
}

export function safeIdentityQualificationSummary(input) {
  return {
    crossOrganizationRejected: input.crossOrganizationRejected === true,
    firstPasswordSet: input.firstPasswordSet === true,
    invitationAccepted: input.invitationAccepted === true,
    passwordReset: input.passwordReset === true,
    resetReplayRejected: input.resetReplayRejected === true,
    recoveredPasswordSignIn: input.recoveredPasswordSignIn === true,
    qualificationEmail: input.qualificationEmail ?? null,
    qualificationProfileId: input.qualificationProfileId ?? null,
  };
}

export function selectQualificationProfileId(profiles, membership, displayName) {
  if (membership?.profileId) {
    const linkedProfile = profiles.find((profile) => profile?.id === membership.profileId);
    if (!linkedProfile) {
      throw new Error("The qualification Membership links to a missing Organization Profile.");
    }
    return linkedProfile.id;
  }
  return profiles.find((profile) => profile?.displayName === displayName)?.id ?? null;
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
  const responseText = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    // Do not retain or print unexpected response bodies.
  }
  return { body: parsed, response };
}

async function prompt(readline, message) {
  return (await readline.question(message)).trim();
}

async function signIn(readline, loginEmail) {
  if (loginEmail === ownerEmail) {
    return getStagingSession({
      email: ownerEmail,
      productUrl,
    });
  }
  const otpRequest = await request(
    `${productUrl}/api/auth/email-otp/send-verification-otp`,
    "POST",
    "",
    { email: loginEmail, type: "sign-in" },
  );
  if (otpRequest.response.status !== 200) {
    throw new Error(`Sign-in code request failed with HTTP ${String(otpRequest.response.status)}.`);
  }
  console.log(`A sign-in code was requested for ${loginEmail}.`);
  const code = await prompt(readline, "Enter the six-digit sign-in code (not recorded): ");
  if (!/^\d{6}$/.test(code)) throw new Error("The sign-in code must contain exactly six digits.");
  const signInResponse = await request(`${productUrl}/api/auth/sign-in/email-otp`, "POST", "", {
    email: loginEmail,
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

async function passwordSignIn(loginEmail, password) {
  const result = await request(`${productUrl}/api/auth/sign-in/email`, "POST", "", {
    email: loginEmail,
    password,
  });
  if (result.response.status !== 200) {
    throw new Error(
      `Password sign-in failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  const cookie = sessionCookieFrom(result.response);
  if (!cookie.includes("choir-management.session_token=")) {
    throw new Error("The password sign-in response did not return a staging session cookie.");
  }
  return cookie;
}

async function listProfiles(cookie, host = organizationHost) {
  const result = await request(`${host}/api/organization/profiles`, "GET", cookie);
  if (result.response.status !== 200 || !Array.isArray(result.body?.profiles)) {
    throw new Error(
      `Profile list failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.profiles;
}

async function ensureProfile(cookie, membership) {
  const profiles = await listProfiles(cookie);
  const existingId = selectQualificationProfileId(profiles, membership, fixtureDisplayName);
  if (existingId) {
    return uuid(existingId, "Qualification Profile");
  }
  const result = await request(`${organizationHost}/api/organization/profiles`, "POST", cookie, {
    displayName: fixtureDisplayName,
    globalStatus: "Active",
    voicePart: "S1",
  });
  if (result.response.status !== 201 || typeof result.body?.id !== "string") {
    throw new Error(
      `Profile creation failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return uuid(result.body.id, "Qualification Profile");
}

async function listMemberships(cookie) {
  const result = await request(`${organizationHost}/api/organization/members`, "GET", cookie);
  if (result.response.status !== 200 || !Array.isArray(result.body?.memberships)) {
    throw new Error(
      `Membership list failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.memberships;
}

async function listInvitations(cookie) {
  const result = await request(`${organizationHost}/api/organization/invitations`, "GET", cookie);
  if (result.response.status !== 200 || !Array.isArray(result.body?.invitations)) {
    throw new Error(
      `Invitation list failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.invitations;
}

async function createInvitation(cookie) {
  const existing = (await listInvitations(cookie)).find(
    (invitation) => invitation?.email?.toLowerCase() === identityEmail,
  );
  if (existing) return uuid(existing.id, "Qualification invitation");
  const result = await request(`${organizationHost}/api/organization/invitations`, "POST", cookie, {
    email: identityEmail,
    role: "member",
  });
  if (result.response.status !== 201 || typeof result.body?.id !== "string") {
    throw new Error(
      `Invitation creation failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return uuid(result.body.id, "Qualification invitation");
}

async function invitationDetails(cookie, host, invitationId) {
  return request(
    `${host}/api/organization/invitations/${encodeURIComponent(invitationId)}`,
    "GET",
    cookie,
  );
}

async function acceptInvitation(cookie, invitationId) {
  const result = await request(
    `${organizationHost}/api/organization/invitations/${encodeURIComponent(invitationId)}/accept`,
    "POST",
    cookie,
  );
  if (result.response.status !== 200) {
    throw new Error(
      `Invitation acceptance failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
}

async function linkProfile(cookie, membershipId, profileId) {
  const result = await request(
    `${organizationHost}/api/organization/members/${encodeURIComponent(membershipId)}/profile`,
    "PUT",
    cookie,
    { profileId },
  );
  if (result.response.status !== 200) {
    throw new Error(
      `Profile link failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
}

async function setPassword(cookie, password) {
  const result = await request(`${productUrl}/api/account/password`, "PUT", cookie, {
    mode: "set",
    newPassword: password,
  });
  if (result.response.status !== 200) {
    throw new Error(
      `Password setup failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
}

async function passwordIsSet(cookie) {
  const result = await request(`${productUrl}/api/account/security`, "GET", cookie);
  if (result.response.status !== 200 || typeof result.body?.passwordSet !== "boolean") {
    throw new Error(
      `Account security lookup failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.passwordSet;
}

async function requestPasswordReset() {
  const result = await request(`${productUrl}/api/auth/request-password-reset`, "POST", "", {
    email: identityEmail,
  });
  if (result.response.status !== 200) {
    throw new Error(
      `Password-reset request failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
}

async function resetPassword(token, password) {
  return request(`${productUrl}/api/auth/reset-password`, "POST", "", {
    newPassword: password,
    token,
  });
}

async function getSession(cookie) {
  return request(`${productUrl}/api/auth/get-session`, "GET", cookie);
}

async function main() {
  if (planOnly) {
    for (const [index, step] of identityQualificationPlan().entries()) {
      console.log(`${String(index + 1)}. ${step}`);
    }
    return;
  }

  const readline = createInterface({ input, output });
  let ownerCookie = "";
  let invitationId = "";
  let invitationAccepted = false;
  let identityCookie;
  let qualificationProfileId = null;
  const summary = {
    crossOrganizationRejected: false,
    firstPasswordSet: false,
    invitationAccepted: false,
    passwordReset: false,
    resetReplayRejected: false,
    recoveredPasswordSignIn: false,
    qualificationEmail: identityEmail,
    qualificationProfileId: null,
  };

  try {
    ownerCookie = await signIn(readline, ownerEmail);
    const membershipsBefore = await listMemberships(ownerCookie);
    const existingMembership = membershipsBefore.find(
      (membership) => membership?.email?.toLowerCase() === identityEmail,
    );
    if (existingMembership && !resumeExisting) {
      throw new Error(
        "The qualification identity is already a member; set STAGING_IDENTITY_RESUME_EXISTING=1 to resume it, or use a fresh approved alias for an invitation-activation run.",
      );
    }
    qualificationProfileId = await ensureProfile(ownerCookie, existingMembership);
    summary.qualificationProfileId = qualificationProfileId;

    if (existingMembership) {
      invitationAccepted = true;
      summary.invitationAccepted = true;
      console.log("PASS reused existing qualification Membership");
      identityCookie = await signIn(readline, identityEmail);
    } else {
      invitationId = await createInvitation(ownerCookie);
      identityCookie = await signIn(readline, identityEmail);
      const details = await invitationDetails(identityCookie, organizationHost, invitationId);
      if (
        details.response.status !== 200 ||
        details.body?.id !== invitationId ||
        details.body?.email?.toLowerCase() !== identityEmail
      ) {
        throw new Error(
          `Invitation details failed with ${requestFailure(details.response.status, details.body)}.`,
        );
      }
      const wrongDetails = await invitationDetails(
        identityCookie,
        wrongOrganizationHost,
        invitationId,
      );
      summary.crossOrganizationRejected = wrongDetails.response.status === 404;
      console.log(
        `${summary.crossOrganizationRejected ? "PASS" : "FAIL"} invitation cross-Organization boundary`,
      );
      if (!summary.crossOrganizationRejected) {
        throw new Error("The invitation was readable on the wrong Organization host.");
      }

      await acceptInvitation(identityCookie, invitationId);
      invitationAccepted = true;
      summary.invitationAccepted = true;
      console.log("PASS invitation acceptance");
    }

    const membership = (await listMemberships(ownerCookie)).find(
      (candidate) => candidate?.email?.toLowerCase() === identityEmail,
    );
    if (!membership?.id) throw new Error("The accepted qualification Membership was not created.");
    if (membership.profileId !== qualificationProfileId) {
      await linkProfile(ownerCookie, membership.id, qualificationProfileId);
    }
    if (await passwordIsSet(identityCookie)) {
      summary.firstPasswordSet = true;
      console.log("PASS qualification identity password already set (resumed)");
    } else {
      const password = `Qualify-${crypto.randomUUID()}-S1!`;
      await setPassword(identityCookie, password);
      summary.firstPasswordSet = true;
      console.log("PASS invited identity password setup");
    }

    await requestPasswordReset();
    const resetUrl = await prompt(
      readline,
      "Paste the password-reset URL from the controlled qualification email (local terminal only): ",
    );
    const resetToken = parsePasswordResetUrl(resetUrl, productOrigin);
    const recoveredPassword = `Recover-${crypto.randomUUID()}-S1!`;
    const reset = await resetPassword(resetToken, recoveredPassword);
    if (reset.response.status !== 200) {
      throw new Error(
        `Password reset failed with ${requestFailure(reset.response.status, reset.body)}.`,
      );
    }
    summary.passwordReset = true;
    console.log("PASS password reset");
    const replay = await resetPassword(resetToken, `Replay-${crypto.randomUUID()}-S1!`);
    summary.resetReplayRejected = replay.response.status === 400;
    console.log(`${summary.resetReplayRejected ? "PASS" : "FAIL"} password-reset replay rejection`);
    if (!summary.resetReplayRejected)
      throw new Error("The consumed password-reset token was accepted again.");

    const recoveredCookie = await passwordSignIn(identityEmail, recoveredPassword);
    const recoveredSession = await getSession(recoveredCookie);
    summary.recoveredPasswordSignIn =
      recoveredSession.response.status === 200 &&
      recoveredSession.body?.user?.email?.toLowerCase() === identityEmail;
    console.log(`${summary.recoveredPasswordSignIn ? "PASS" : "FAIL"} recovered password sign-in`);
    if (!summary.recoveredPasswordSignIn) {
      throw new Error("The recovered password did not establish the expected identity session.");
    }

    const wrongProfiles = await request(
      `${wrongOrganizationHost}/api/organization/profiles`,
      "GET",
      recoveredCookie,
    );
    const targetAbsent =
      wrongProfiles.response.status === 401 ||
      wrongProfiles.response.status === 403 ||
      wrongProfiles.response.status === 404 ||
      (wrongProfiles.response.status === 200 &&
        Array.isArray(wrongProfiles.body?.profiles) &&
        !wrongProfiles.body.profiles.some((profile) => profile?.id === qualificationProfileId));
    summary.crossOrganizationRejected = targetAbsent;
    console.log(
      `${targetAbsent ? "PASS" : "FAIL"} qualification Profile wrong-Organization boundary`,
    );
    if (!targetAbsent)
      throw new Error("The qualification Profile appeared on the wrong Organization host.");

    console.log(JSON.stringify(safeIdentityQualificationSummary(summary)));
    const checks = [
      summary.crossOrganizationRejected,
      summary.firstPasswordSet,
      summary.invitationAccepted,
      summary.passwordReset,
      summary.resetReplayRejected,
      summary.recoveredPasswordSignIn,
    ];
    if (!checks.every(Boolean))
      throw new Error("Identity qualification did not satisfy all checks.");
  } finally {
    if (ownerCookie && invitationId && !invitationAccepted) {
      try {
        await request(
          `${organizationHost}/api/organization/invitations/${encodeURIComponent(invitationId)}`,
          "DELETE",
          ownerCookie,
        );
      } catch {
        console.error("Pending qualification invitation cleanup did not complete.");
      }
    }
    readline.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
