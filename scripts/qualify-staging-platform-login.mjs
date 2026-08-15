import {
  formatQualificationSummary,
  qualificationSnapshot,
  qualificationSnapshotsMatch,
  selectQualificationEvents,
  summarizeCommunicationMessages,
  summarizeDeliverySummary,
  summarizeScheduledMessages,
} from "./staging-qualification-inspection.mjs";
import { getPlatformAdminSession } from "./staging-auth-helper.mjs";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const organizationSlug = (process.env.STAGING_ORG_SLUG ?? "lcc").trim().toLowerCase();
const email = (process.env.STAGING_AUTH_EMAIL ?? "cwosborn@gmail.com").trim().toLowerCase();
const runMaintenance = process.env.STAGING_RUN_MAINTENANCE === "1";
const inspectQualification = process.env.STAGING_INSPECT_QUALIFICATION === "1";
const repeatMaintenance = process.env.STAGING_REPEAT_MAINTENANCE === "1";
const planOnly = process.argv.includes("--plan-only");
const qualificationTitlePrefix = (process.env.STAGING_QUALIFICATION_TITLE_PREFIX ?? "QUAL-").trim();
const inspectionAttempts = 10;
const inspectionDelayMs = 2_000;

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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function inspectQualificationState(cookie) {
  const events = await request(
    `${organizationUrl}/api/organization/events`,
    "GET",
    undefined,
    cookie,
  );
  if (events.status !== 200 || !Array.isArray(events.body?.events)) {
    throw new Error(`Qualification event inspection failed with HTTP ${String(events.status)}.`);
  }
  const qualificationEvents = selectQualificationEvents(
    events.body.events,
    qualificationTitlePrefix,
  );
  if (qualificationEvents.length === 0) {
    throw new Error(`No events matched qualification prefix ${qualificationTitlePrefix}.`);
  }
  const eventIds = qualificationEvents.map((event) => event.id);

  let latest = null;
  for (let attempt = 0; attempt < inspectionAttempts; attempt += 1) {
    const [scheduled, communications] = await Promise.all([
      request(
        `${organizationUrl}/api/organization/communications/scheduled`,
        "GET",
        undefined,
        cookie,
      ),
      request(`${organizationUrl}/api/organization/communications`, "GET", undefined, cookie),
    ]);
    if (
      scheduled.status !== 200 ||
      !Array.isArray(scheduled.body?.messages) ||
      communications.status !== 200 ||
      !Array.isArray(communications.body?.messages)
    ) {
      throw new Error(
        `Qualification communication inspection failed with HTTP ${String(scheduled.status)}/${String(communications.status)}.`,
      );
    }

    const scheduledSummary = summarizeScheduledMessages(scheduled.body.messages, eventIds);
    const communicationSummary = summarizeCommunicationMessages(
      communications.body.messages,
      eventIds,
    );
    const deliveries = [];
    for (const message of communicationSummary.rows) {
      const delivery = await request(
        `${organizationUrl}/api/organization/communications/${encodeURIComponent(message.id)}/delivery-summary`,
        "GET",
        undefined,
        cookie,
      );
      if (delivery.status !== 200) {
        throw new Error(
          `Qualification delivery inspection failed with HTTP ${String(delivery.status)}.`,
        );
      }
      deliveries.push({
        messageId: message.id,
        status: message.status,
        summary: summarizeDeliverySummary(delivery.body),
      });
    }
    latest = {
      communications: communicationSummary,
      deliveries,
      events: qualificationEvents,
      scheduled: scheduledSummary,
    };
    const terminal = scheduledSummary.rows.every((row) => ["Failed", "Sent"].includes(row.status));
    if (scheduledSummary.total > 0 && terminal) break;
    if (attempt < inspectionAttempts - 1) await sleep(inspectionDelayMs);
  }

  if (latest === null || latest.scheduled.total === 0) {
    throw new Error(
      "No qualification-owned scheduled messages were observed before the polling limit.",
    );
  }
  return latest;
}

function printQualificationInspection(label, state) {
  const snapshot = qualificationSnapshot(state.scheduled, state.communications, state.deliveries);
  console.log(`PASS ${label}: ${formatQualificationSummary({ ...snapshot, ...state })}`);
  return snapshot;
}

async function main() {
  if (planOnly) {
    console.log("Scheduler qualification inspection plan (no network calls made):");
    console.log("- authenticate interactively in memory");
    console.log("- read canonical Organization events and communication status");
    console.log("- redact message bodies, subjects, destinations, tokens, and cookies");
    console.log(
      "- optionally repeat the already-authorized maintenance route and compare stable row keys",
    );
    return;
  }
  const cookie = await getPlatformAdminSession({ email, productUrl });

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

  if (runMaintenance) {
    const maintenance = await request(
      `${organizationUrl}/api/platform/maintenance/run`,
      "GET",
      undefined,
      cookie,
    );
    const maintenancePassed =
      maintenance.status === 200 &&
      maintenance.body?.success === true &&
      typeof maintenance.body?.organizationId === "string" &&
      Number.isInteger(maintenance.body?.enqueuedJobCount);
    console.log(
      `${maintenancePassed ? "PASS" : "FAIL"} staging maintenance (${organizationSlug})` +
        (maintenancePassed
          ? ` — ${String(maintenance.body.enqueuedJobCount)} job(s) enqueued`
          : ""),
    );
    if (!maintenancePassed) failures += 1;

    if (inspectQualification && maintenancePassed) {
      try {
        const beforeRepeat = await inspectQualificationState(cookie);
        const firstSnapshot = printQualificationInspection(
          "qualification scheduler inspection",
          beforeRepeat,
        );

        if (repeatMaintenance) {
          const repeated = await request(
            `${organizationUrl}/api/platform/maintenance/run`,
            "GET",
            undefined,
            cookie,
          );
          const repeatPassed =
            repeated.status === 200 &&
            repeated.body?.success === true &&
            repeated.body?.enqueuedJobCount === 0;
          console.log(
            `${repeatPassed ? "PASS" : "FAIL"} qualification maintenance replay — ${repeatPassed ? "0 jobs enqueued" : `HTTP ${String(repeated.status)}`}`,
          );
          if (!repeatPassed) failures += 1;

          if (repeatPassed) {
            const afterRepeat = await inspectQualificationState(cookie);
            const secondSnapshot = printQualificationInspection(
              "qualification scheduler replay inspection",
              afterRepeat,
            );
            const idempotent = qualificationSnapshotsMatch(firstSnapshot, secondSnapshot);
            console.log(`${idempotent ? "PASS" : "FAIL"} qualification scheduler idempotency`);
            if (!idempotent) failures += 1;
          }
        }
      } catch (error) {
        console.log(
          `FAIL qualification scheduler inspection — ${error instanceof Error ? error.message : "unexpected inspection error"}`,
        );
        failures += 1;
      }
    }

    const productMaintenance = await request(
      `${productUrl}/api/platform/maintenance/run`,
      "GET",
      undefined,
      cookie,
    );
    const boundaryPassed = productMaintenance.status === 404;
    console.log(`${boundaryPassed ? "PASS" : "FAIL"} product-host maintenance boundary`);
    if (!boundaryPassed) failures += 1;
  }

  console.log(
    `\nPlatform staging evidence: ${String(probes.length + (runMaintenance ? 2 : 0) - failures)} passed, ${String(failures)} failed; no provisioning, queue retry, or provider action was invoked.`,
  );
  if (failures > 0) process.exitCode = 1;
}

await main();
