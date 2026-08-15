import { createHash } from "node:crypto";
import { getStagingSession } from "./staging-auth-helper.mjs";
import { pathToFileURL } from "node:url";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const organizationSlug = (process.env.STAGING_ORG_SLUG ?? "lcc").trim().toLowerCase();
const wrongOrganizationSlug = (process.env.STAGING_SECOND_ORG_SLUG ?? "lmc").trim().toLowerCase();
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
const memberEmail = (process.env.STAGING_PHOTO_MEMBER_EMAIL ?? "").trim().toLowerCase();
const targetProfileId = process.env.STAGING_PHOTO_PROFILE_ID?.trim() ?? "";
const targetProfilePrefix = (
  process.env.STAGING_PHOTO_PROFILE_PREFIX ??
  process.env.STAGING_QUALIFICATION_TITLE_PREFIX ??
  "QUAL-"
).trim();
const organizationHost = `https://${organizationSlug}.${new URL(productUrl).hostname}`;
const wrongOrganizationHost = `https://${wrongOrganizationSlug}.${new URL(productUrl).hostname}`;
const planOnly = process.argv.includes("--plan-only");

if (!/^[a-z0-9-]+$/.test(organizationSlug) || !/^[a-z0-9-]+$/.test(wrongOrganizationSlug)) {
  throw new Error("Organization slugs must contain only lowercase letters, numbers, or hyphens.");
}

function uuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
  return value;
}

function fixtureBytes() {
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function summarizePhotoDownload(response, bytes, expectedChecksum) {
  const checksum = sha256(bytes);
  return {
    cacheControl: response.headers.get("cache-control"),
    checksum,
    contentDisposition: response.headers.get("content-disposition"),
    contentType: response.headers.get("content-type"),
    expectedChecksum,
    length: bytes.byteLength,
    ok:
      response.status === 200 &&
      response.headers.get("cache-control") === "no-store" &&
      response.headers.get("content-type") === "image/png" &&
      checksum === expectedChecksum,
    status: response.status,
  };
}

export function photoQualificationPlan(profileId, includeMemberAuthorization = false) {
  return [
    ...(includeMemberAuthorization
      ? [
          "sign in as the linked member, attach a photo to its own Profile, and verify another Profile returns 403",
        ]
      : []),
    `upload two generated PNG fixtures for Profile ${profileId}`,
    "attach the first fixture and verify private download headers and checksum",
    "verify wrong-Organization file access returns 404",
    "replace with the second fixture and verify the first object is reclaimed",
    "remove the photo and verify the replacement object is reclaimed",
  ];
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

async function signIn(loginEmail = email) {
  return getStagingSession({
    email: loginEmail,
    productUrl,
  });
}

async function resolveTargetProfile(cookie) {
  if (targetProfileId) return uuid(targetProfileId, "STAGING_PHOTO_PROFILE_ID");

  const memberProfile = await jsonRequest(`${organizationHost}/api/singer/profile`, "GET", cookie);
  if (memberProfile.response.status === 200 && typeof memberProfile.body?.id === "string") {
    if (
      !targetProfilePrefix ||
      (typeof memberProfile.body.displayName === "string" &&
        memberProfile.body.displayName.startsWith(targetProfilePrefix))
    ) {
      return uuid(memberProfile.body.id, "linked member Profile");
    }
  }

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
      `Expected exactly one qualification Profile matching ${targetProfilePrefix}; found ${String(matches.length)}. Set STAGING_PHOTO_PROFILE_ID explicitly.`,
    );
  }
  return uuid(matches[0].id, "qualification Profile");
}

async function resolveOtherProfile(cookie, ownProfileId) {
  const { body, response } = await jsonRequest(
    `${organizationHost}/api/singer/directory`,
    "GET",
    cookie,
  );
  if (response.status !== 200 || !Array.isArray(body?.profiles)) {
    throw new Error(`Member directory failed with HTTP ${String(response.status)}.`);
  }
  const other = body.profiles.find(
    (profile) => typeof profile?.id === "string" && profile.id !== ownProfileId,
  );
  if (!other) throw new Error("The member directory did not contain another Profile.");
  return uuid(other.id, "other Organization Profile");
}

async function upload(cookie, fileId, bytes, fileName) {
  const response = await request(
    `${organizationHost}/api/organization/files/${fileId}`,
    "PUT",
    cookie,
    bytes,
    {
      "content-length": String(bytes.byteLength),
      "content-type": "image/png",
      "x-file-name": encodeURIComponent(fileName),
    },
  );
  await response.arrayBuffer();
  if (response.status !== 201) {
    throw new Error(`Photo upload failed with HTTP ${String(response.status)}.`);
  }
}

async function attach(cookie, profileId, fileId) {
  const { response } = await jsonRequest(
    `${organizationHost}/api/organization/profiles/${profileId}/photo/${fileId}`,
    "PUT",
    cookie,
  );
  if (response.status !== 200) {
    throw new Error(`Photo attach failed with HTTP ${String(response.status)}.`);
  }
}

async function removePhoto(cookie, profileId) {
  const { response } = await jsonRequest(
    `${organizationHost}/api/organization/profiles/${profileId}/photo`,
    "DELETE",
    cookie,
  );
  if (response.status !== 200) {
    throw new Error(`Photo removal failed with HTTP ${String(response.status)}.`);
  }
}

async function readFile(cookie, host, fileId) {
  const response = await request(`${host}/api/organization/files/${fileId}`, "GET", cookie);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes, response };
}

async function deleteFile(cookie, fileId) {
  const { response } = await jsonRequest(
    `${organizationHost}/api/organization/files/${fileId}`,
    "DELETE",
    cookie,
  );
  return response.status === 200 || response.status === 404;
}

async function qualifyMemberAuthorization(adminCookie, profileId) {
  if (!memberEmail) {
    console.log(
      "DEFER ordinary-member Profile-photo authorization: set STAGING_PHOTO_MEMBER_EMAIL to run the linked-member check.",
    );
    return;
  }
  const memberCookie = await signIn(memberEmail);
  const memberProfile = await jsonRequest(
    `${organizationHost}/api/singer/profile`,
    "GET",
    memberCookie,
  );
  if (memberProfile.response.status !== 200 || memberProfile.body?.id !== profileId) {
    throw new Error("The photo member email is not linked to the qualification Profile.");
  }
  const otherProfileId = await resolveOtherProfile(memberCookie, profileId);
  const memberFileId = crypto.randomUUID();
  let attached = false;
  try {
    await upload(
      memberCookie,
      memberFileId,
      fixtureBytes(),
      "qualification-profile-photo-member.png",
    );
    const ownAttachment = await jsonRequest(
      `${organizationHost}/api/organization/profiles/${profileId}/photo/${memberFileId}`,
      "PUT",
      memberCookie,
    );
    if (ownAttachment.response.status !== 200) {
      throw new Error(
        `Member own-Profile photo attach failed with HTTP ${String(ownAttachment.response.status)}.`,
      );
    }
    attached = true;
    const otherAttachment = await jsonRequest(
      `${organizationHost}/api/organization/profiles/${otherProfileId}/photo/${memberFileId}`,
      "PUT",
      memberCookie,
    );
    const forbidden = otherAttachment.response.status === 403;
    console.log(`${forbidden ? "PASS" : "FAIL"} ordinary-member cross-Profile photo authorization`);
    if (!forbidden) throw new Error("A member attached a photo to another Profile.");
    console.log("PASS ordinary-member own-Profile photo attach");
  } finally {
    if (attached) await removePhoto(memberCookie, profileId).catch(() => undefined);
    await deleteFile(adminCookie, memberFileId).catch(() => false);
  }
}

async function main() {
  if (planOnly) {
    const displayId = targetProfileId || "<STAGING_PHOTO_PROFILE_ID>";
    console.log("Profile-photo qualification plan (no network calls made):");
    for (const step of photoQualificationPlan(displayId, Boolean(memberEmail))) {
      console.log(`- ${step}`);
    }
    return;
  }

  const uploaded = [];
  let cookie = "";
  let attachedProfileId = null;
  try {
    cookie = await signIn();
    const profileId = await resolveTargetProfile(cookie);
    await qualifyMemberAuthorization(cookie, profileId);
    const bytes = fixtureBytes();
    const expectedChecksum = sha256(bytes);
    const firstFileId = crypto.randomUUID();
    const secondFileId = crypto.randomUUID();
    uploaded.push(firstFileId, secondFileId);

    await upload(cookie, firstFileId, bytes, "qualification-profile-photo-first.png");
    console.log(`PASS profile photo upload (${String(bytes.byteLength)} bytes)`);
    await attach(cookie, profileId, firstFileId);
    attachedProfileId = profileId;
    console.log("PASS profile photo attach");

    const firstRead = await readFile(cookie, organizationHost, firstFileId);
    const firstSummary = summarizePhotoDownload(
      firstRead.response,
      firstRead.bytes,
      expectedChecksum,
    );
    console.log(
      `${firstSummary.ok ? "PASS" : "FAIL"} profile photo private download — ${String(firstSummary.length)} bytes; checksum ${firstSummary.checksum}`,
    );
    if (!firstSummary.ok) throw new Error("The private profile-photo download contract failed.");

    const crossHost = await readFile(cookie, wrongOrganizationHost, firstFileId);
    const crossHostPassed = crossHost.response.status === 404;
    console.log(`${crossHostPassed ? "PASS" : "FAIL"} profile photo wrong-Organization boundary`);
    if (!crossHostPassed) throw new Error("The profile-photo cross-Organization boundary failed.");

    await upload(cookie, secondFileId, bytes, "qualification-profile-photo-second.png");
    await attach(cookie, profileId, secondFileId);
    const oldAfterReplacement = await readFile(cookie, organizationHost, firstFileId);
    const replacementPassed = oldAfterReplacement.response.status === 404;
    console.log(`${replacementPassed ? "PASS" : "FAIL"} profile photo replacement cleanup`);
    if (!replacementPassed)
      throw new Error("The replaced profile-photo object remained accessible.");

    await removePhoto(cookie, profileId);
    attachedProfileId = null;
    const removed = await readFile(cookie, organizationHost, secondFileId);
    const removalPassed = removed.response.status === 404;
    console.log(`${removalPassed ? "PASS" : "FAIL"} profile photo removal cleanup`);
    if (!removalPassed) throw new Error("The removed profile-photo object remained accessible.");
  } finally {
    if (cookie && attachedProfileId) {
      await removePhoto(cookie, attachedProfileId).catch(() => undefined);
    }
    for (const fileId of uploaded) {
      if (cookie) await deleteFile(cookie, fileId).catch(() => false);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
