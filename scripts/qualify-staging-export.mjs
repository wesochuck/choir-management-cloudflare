import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const productHostname = new URL(productUrl).hostname;
const organizationSlug = (process.env.STAGING_ORG_SLUG ?? "lcc").trim().toLowerCase();
const wrongOrganizationSlug = (process.env.STAGING_SECOND_ORG_SLUG ?? "lmc").trim().toLowerCase();
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
const suppliedSessionCookie = process.env.STAGING_SESSION_COOKIE?.trim() ?? "";
const suppliedExportId = process.env.STAGING_EXPORT_ID?.trim() ?? "";
const createExport = process.env.STAGING_EXPORT_CREATE === "1";
const organizationHost = `https://${organizationSlug}.${productHostname}`;
const wrongOrganizationHost = `https://${wrongOrganizationSlug}.${productHostname}`;
const maxPollAttempts = 80;
const pollDelayMs = 1_500;

if (!/^[a-z0-9-]+$/.test(organizationSlug) || !/^[a-z0-9-]+$/.test(wrongOrganizationSlug)) {
  throw new Error("Organization slugs must contain only lowercase letters, numbers, or hyphens.");
}
if (organizationSlug === wrongOrganizationSlug) {
  throw new Error("The wrong-Organization host must be different from the target host.");
}
if (
  suppliedExportId &&
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    suppliedExportId,
  )
) {
  throw new Error("STAGING_EXPORT_ID must be a UUID.");
}
function uuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
  return value;
}

function requestFailure(status, body) {
  const code =
    typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
      ? body.code
      : null;
  return `HTTP ${String(status)}${code ? ` (${code})` : ""}`;
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

function safeJsonBody(value) {
  return typeof value === "object" && value !== null ? value : null;
}

export function exportQualificationPlan() {
  return [
    "sign in without recording the session or one-time code",
    "use an explicitly supplied existing export, or create one only with STAGING_EXPORT_CREATE=1",
    "wait for the export to complete and verify its replay-stable status",
    "download the archive and verify tenant binding, payload checksum, byte count, and private headers",
    "prove the export status and download are not accessible on the wrong Organization host",
    "leave an explicitly created export as the Organization's durable export artifact",
  ];
}

export function exportStatusSnapshot(body) {
  const parsed = safeJsonBody(body);
  if (!parsed) return null;
  return {
    byteCount: typeof parsed.byteCount === "number" ? parsed.byteCount : null,
    checksumSha256: typeof parsed.checksumSha256 === "string" ? parsed.checksumSha256 : null,
    downloadUrl: typeof parsed.downloadUrl === "string" ? parsed.downloadUrl : null,
    errorCode: typeof parsed.errorCode === "string" ? parsed.errorCode : null,
    exportId: typeof parsed.exportId === "string" ? parsed.exportId : null,
    status: typeof parsed.status === "string" ? parsed.status : null,
  };
}

export function exportStatusSnapshotsMatch(first, second) {
  return (
    JSON.stringify(exportStatusSnapshot(first)) === JSON.stringify(exportStatusSnapshot(second))
  );
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function exportArchiveMatches(archive, expected) {
  const parsed = safeJsonBody(archive);
  const manifest = safeJsonBody(parsed?.manifest);
  const payload = safeJsonBody(parsed?.payload);
  if (!manifest || !payload) return false;
  if (
    manifest.exportVersion !== 1 ||
    manifest.organizationId !== expected.organizationId ||
    manifest.byteCount !== expected.byteCount ||
    manifest.checksumSha256 !== expected.checksumSha256 ||
    payload.exportVersion !== 1 ||
    payload.organizationId !== expected.organizationId ||
    !safeJsonBody(payload.records)
  ) {
    return false;
  }
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  return (
    payloadBytes.byteLength === expected.byteCount &&
    sha256Hex(payloadBytes) === expected.checksumSha256
  );
}

export function exportDownloadHeadersMatch(headers, exportId, checksumSha256, byteLength) {
  const contentDisposition = headers.get("content-disposition") ?? "";
  const contentType = headers.get("content-type") ?? "";
  const cacheControl = headers.get("cache-control") ?? "";
  const contentLength = headers.get("content-length");
  return (
    contentType.startsWith("application/json") &&
    cacheControl.includes("private") &&
    cacheControl.includes("no-store") &&
    contentDisposition.includes(`organization-export-${exportId}.json`) &&
    headers.get("x-export-checksum-sha256") === checksumSha256 &&
    (contentLength === null || contentLength === String(byteLength))
  );
}

export function exportBoundaryResponseSafe(result, exportId) {
  if ([401, 403, 404].includes(result.status)) return true;
  if (result.status !== 200) return false;
  const snapshot = exportStatusSnapshot(result.body);
  return snapshot?.exportId !== exportId;
}

export function safeExportQualificationSummary(input) {
  return {
    archiveVerified: input.archiveVerified === true,
    checksumSha256: typeof input.checksumSha256 === "string" ? input.checksumSha256 : null,
    created: input.created === true,
    crossOrganizationRejected: input.crossOrganizationRejected === true,
    downloadHeadersVerified: input.downloadHeadersVerified === true,
    exportId: input.exportId ?? null,
    replayStable: input.replayStable === true,
  };
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
    signal: AbortSignal.timeout(20_000),
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

async function signIn(readline) {
  if (suppliedSessionCookie) {
    if (!suppliedSessionCookie.includes("choir-management.session_token=")) {
      throw new Error("STAGING_SESSION_COOKIE is not a staging session cookie.");
    }
    return suppliedSessionCookie;
  }
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
  const signedIn = await request(`${productUrl}/api/auth/sign-in/email-otp`, "POST", "", {
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

async function resolveOrganizationId(cookie) {
  const result = await request(`${organizationHost}/api/organization/context`, "GET", cookie);
  if (result.response.status !== 200 || typeof result.body?.organizationId !== "string") {
    throw new Error(
      `Organization context failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return uuid(result.body.organizationId, "Organization ID");
}

async function startExport(cookie) {
  const result = await request(`${organizationHost}/api/organization/export`, "POST", cookie, {
    format: "json",
  });
  if (result.response.status !== 202 || typeof result.body?.exportId !== "string") {
    throw new Error(
      `Organization export start failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return uuid(result.body.exportId, "Organization export ID");
}

async function readExportStatus(cookie, host, exportId) {
  const result = await request(
    `${host}/api/organization/export/${encodeURIComponent(exportId)}`,
    "GET",
    cookie,
  );
  return { body: result.body, response: result.response };
}

async function waitForCompletedExport(cookie, exportId) {
  for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
    const result = await readExportStatus(cookie, organizationHost, exportId);
    if (result.response.status !== 200) {
      throw new Error(
        `Organization export status failed with ${requestFailure(result.response.status, result.body)}.`,
      );
    }
    const snapshot = exportStatusSnapshot(result.body);
    if (snapshot?.exportId !== exportId)
      throw new Error("Export status returned the wrong export.");
    if (snapshot.status === "completed") return result.body;
    if (snapshot.status === "failed") {
      throw new Error(
        `Organization export failed${snapshot.errorCode ? ` (${snapshot.errorCode})` : ""}.`,
      );
    }
    if (snapshot.status !== "queued" && snapshot.status !== "processing") {
      throw new Error("Organization export returned an unsupported status.");
    }
    console.log(`WAIT organization export (${String(attempt)}/${String(maxPollAttempts)})`);
    await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
  }
  throw new Error("Organization export did not complete within the bounded qualification window.");
}

async function downloadExport(cookie, exportId, statusBody) {
  const status = exportStatusSnapshot(statusBody);
  if (!status?.downloadUrl || !status.checksumSha256 || status.byteCount === null) {
    throw new Error("Completed Organization export did not include download metadata.");
  }
  const downloadUrl = new URL(status.downloadUrl, organizationHost);
  const expectedPath = `/api/organization/export/${encodeURIComponent(exportId)}/download`;
  if (
    downloadUrl.hostname !== new URL(organizationHost).hostname ||
    downloadUrl.pathname !== expectedPath
  ) {
    throw new Error("Organization export download escaped the canonical host.");
  }
  const response = await fetch(downloadUrl, {
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
      cookie,
      origin: organizationHost,
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  let archive = null;
  try {
    archive = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // The archive remains untrusted until JSON and manifest checks pass.
  }
  return {
    archive,
    bytes,
    headersVerified:
      response.status === 200 &&
      exportDownloadHeadersMatch(
        response.headers,
        exportId,
        status.checksumSha256,
        bytes.byteLength,
      ),
    response,
    status,
  };
}

async function main() {
  if (!suppliedExportId && !createExport) {
    throw new Error(
      "Set STAGING_EXPORT_ID for read-only verification, or set STAGING_EXPORT_CREATE=1 to explicitly create one export.",
    );
  }
  const readline = createInterface({ input, output });
  const summary = {
    archiveVerified: false,
    checksumSha256: null,
    created: false,
    crossOrganizationRejected: false,
    downloadHeadersVerified: false,
    exportId: null,
    replayStable: false,
  };
  try {
    const cookie = await signIn(readline);
    const organizationId = await resolveOrganizationId(cookie);
    const exportId = suppliedExportId || (await startExport(cookie));
    summary.created = !suppliedExportId;
    summary.exportId = exportId;
    console.log(
      `${summary.created ? "PASS" : "PASS"} ${summary.created ? "Organization export queued" : "reusing existing Organization export"} (${exportId})`,
    );

    const completed = await waitForCompletedExport(cookie, exportId);
    const replay = await readExportStatus(cookie, organizationHost, exportId);
    summary.replayStable =
      replay.response.status === 200 && exportStatusSnapshotsMatch(completed, replay.body);
    console.log(`${summary.replayStable ? "PASS" : "FAIL"} export status replay stability`);
    if (!summary.replayStable) throw new Error("Organization export status changed on replay.");

    const download = await downloadExport(cookie, exportId, completed);
    summary.downloadHeadersVerified = download.headersVerified;
    console.log(
      `${summary.downloadHeadersVerified ? "PASS" : "FAIL"} export private download headers`,
    );
    if (!summary.downloadHeadersVerified)
      throw new Error("Organization export download headers were invalid.");
    const status = exportStatusSnapshot(completed);
    if (!status?.checksumSha256 || status.byteCount === null) {
      throw new Error("Completed Organization export status is missing checksum metadata.");
    }
    summary.archiveVerified = exportArchiveMatches(download.archive, {
      byteCount: status.byteCount,
      checksumSha256: status.checksumSha256,
      exportId,
      organizationId,
    });
    summary.checksumSha256 = status.checksumSha256;
    console.log(`${summary.archiveVerified ? "PASS" : "FAIL"} export manifest and checksum`);
    if (!summary.archiveVerified)
      throw new Error("Organization export archive verification failed.");

    const wrongStatus = await readExportStatus(cookie, wrongOrganizationHost, exportId);
    const wrongDownload = await fetch(
      `${wrongOrganizationHost}/api/organization/export/${encodeURIComponent(exportId)}/download`,
      {
        headers: {
          accept: "application/json",
          "cache-control": "no-cache",
          cookie,
          origin: wrongOrganizationHost,
          "user-agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
    summary.crossOrganizationRejected =
      exportBoundaryResponseSafe(
        { body: wrongStatus.body, status: wrongStatus.response.status },
        exportId,
      ) && [401, 403, 404].includes(wrongDownload.status);
    console.log(
      `${summary.crossOrganizationRejected ? "PASS" : "FAIL"} export cross-Organization boundary (status ${String(wrongStatus.response.status)}/${String(wrongDownload.status)})`,
    );
    if (!summary.crossOrganizationRejected) {
      throw new Error("Organization export data was accessible on the wrong Organization host.");
    }
  } finally {
    readline.close();
  }
  const result = safeExportQualificationSummary(summary);
  console.log(JSON.stringify(result));
  if (
    !result.archiveVerified ||
    !result.crossOrganizationRejected ||
    !result.downloadHeadersVerified ||
    !result.replayStable
  ) {
    throw new Error("Organization export qualification did not satisfy all checks.");
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
