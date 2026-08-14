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
const buyerEmail = (process.env.STAGING_TICKET_BUYER_EMAIL ?? email).trim().toLowerCase();
const organizationHost = `https://${organizationSlug}.${productHostname}`;
const wrongOrganizationHost = `https://${wrongOrganizationSlug}.${productHostname}`;
const pollingAttempts = 24;
const pollingDelayMs = 2_500;
const planOnly = process.argv.includes("--plan-only");

if (!/^[a-z0-9-]+$/.test(organizationSlug) || !/^[a-z0-9-]+$/.test(wrongOrganizationSlug)) {
  throw new Error("Organization slugs must contain only lowercase letters, numbers, or hyphens.");
}
if (organizationSlug === wrongOrganizationSlug) {
  throw new Error("The wrong-Organization host must be different from the target host.");
}

function uuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID.`);
  }
  return value;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

export function ticketReminderQualificationPlan() {
  return [
    "sign in and verify the fresh Platform Administrator factor in memory",
    "create one zero-dollar, ticket-enabled Performance inside the 24-hour reminder horizon",
    "complete one controlled ticket checkout for an allowed recipient without creating a charge",
    "run canonical-LCC maintenance and prove exactly one ticket_reminder reaches Sent with one recipient",
    "run maintenance again and prove the ticket reminder snapshot is idempotently unchanged",
    "prove the canonical signed receipt remains readable before cleanup",
    "queue and deliver one ticket-confirmation resend for the paid qualification order",
    "prove the wrong Organization host cannot read, resend, or refund the qualification order, receipt, or reminder row",
    "refund the free simulated order, archive the qualification Performance, and print only safe IDs, counts, and statuses",
  ];
}

export function ticketReminderSnapshot(messages, eventId) {
  const rows = Array.isArray(messages)
    ? messages
        .filter(
          (message) =>
            message?.eventId === eventId &&
            (message?.kind === "ticket_confirmation" || message?.kind === "ticket_reminder"),
        )
        .map((message) => ({
          eventId,
          id: typeof message.id === "string" ? message.id : "",
          kind: typeof message.kind === "string" ? message.kind : "",
          recipientCount: typeof message.recipientCount === "number" ? message.recipientCount : 0,
          status: typeof message.status === "string" ? message.status : "",
        }))
        .filter((message) => message.id.length > 0 && message.kind.length > 0)
        .sort((left, right) => left.id.localeCompare(right.id))
    : [];
  return { rows };
}

export function ticketReminderReady(snapshot) {
  const reminders = snapshot?.rows?.filter((row) => row.kind === "ticket_reminder") ?? [];
  return (
    reminders.length === 1 && reminders[0].status === "Sent" && reminders[0].recipientCount === 1
  );
}

export function ticketReminderSnapshotsMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function ticketConfirmationResendReady(before, after) {
  const beforeRows = before?.rows?.filter((row) => row.kind === "ticket_confirmation") ?? [];
  const afterRows = after?.rows?.filter((row) => row.kind === "ticket_confirmation") ?? [];
  if (afterRows.length !== beforeRows.length + 1) return false;
  const beforeIds = new Set(beforeRows.map((row) => row.id));
  const newRows = afterRows.filter((row) => !beforeIds.has(row.id));
  return newRows.length === 1 && newRows[0].status === "Sent" && newRows[0].recipientCount === 1;
}

export function ticketReceiptMatches(body, eventId, purchaseId) {
  return body?.id === purchaseId && body?.eventId === eventId && body?.status === "paid";
}

function responseHasTargetOrder(body, purchaseId, eventId) {
  if (!Array.isArray(body?.orders)) return true;
  return body.orders.some((order) => order?.id === purchaseId || order?.eventId === eventId);
}

function responseHasTargetReminder(body, eventId) {
  if (!Array.isArray(body?.messages)) return true;
  return body.messages.some((message) => message?.eventId === eventId);
}

export function ticketReminderBoundaryResponsesSafe(responses, purchaseId, eventId) {
  const [scheduled, orders, receipt, refund, resend] = responses;
  const collectionSafe = (result, containsTarget) =>
    result.status === 401 ||
    result.status === 403 ||
    result.status === 404 ||
    (result.status === 200 && !containsTarget(result.body));
  const receiptSafe = receipt.status === 401 || receipt.status === 403 || receipt.status === 404;
  const refundSafe = refund?.status === 401 || refund?.status === 403 || refund?.status === 404;
  const resendSafe = resend
    ? resend.status === 401 || resend.status === 403 || resend.status === 404
    : true;
  return (
    collectionSafe(scheduled, (body) => responseHasTargetReminder(body, eventId)) &&
    collectionSafe(orders, (body) => responseHasTargetOrder(body, purchaseId, eventId)) &&
    receiptSafe &&
    refundSafe &&
    resendSafe
  );
}

export function safeTicketReminderQualificationSummary(input) {
  return {
    cleanupCompleted: input.cleanupCompleted === true,
    crossOrganizationRejected: input.crossOrganizationRejected === true,
    eventId: input.eventId ?? null,
    purchaseId: input.purchaseId ?? null,
    receiptAccessible: input.receiptAccessible === true,
    refundBoundaryRejected: input.refundBoundaryRejected === true,
    refundCompleted: input.refundCompleted === true,
    resendBoundaryRejected: input.resendBoundaryRejected === true,
    resendConfirmation: {
      deliveryState: input.resendConfirmation?.deliveryState ?? "unknown",
      recipientCount: input.resendConfirmation?.recipientCount ?? 0,
      status: input.resendConfirmation?.status ?? "unknown",
    },
    reminder: {
      deliveryState: input.reminder?.deliveryState ?? "unknown",
      jobCount: input.reminder?.jobCount ?? 0,
      recipientCount: input.reminder?.recipientCount ?? 0,
      replayStable: input.reminder?.replayStable === true,
      status: input.reminder?.status ?? "unknown",
    },
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

async function signIn(readline) {
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

async function verifyPlatformFactor(readline, cookie) {
  const status = await request(`${productUrl}/api/platform/mfa/status`, "GET", cookie);
  if (status.response.status !== 200) {
    throw new Error(`Platform MFA status failed with HTTP ${String(status.response.status)}.`);
  }
  const code = await prompt(
    readline,
    "Enter the six-digit Platform authenticator code (not recorded): ",
  );
  if (!/^\d{6}$/.test(code)) {
    throw new Error("The Platform authenticator code must contain exactly six digits.");
  }
  const verification = await request(`${productUrl}/api/platform/mfa/verify`, "POST", cookie, {
    code,
    method: "totp",
  });
  if (verification.response.status !== 200) {
    throw new Error(
      `Platform MFA verification failed with HTTP ${String(verification.response.status)}.`,
    );
  }
}

function eventRequest(title, startsAt) {
  return {
    advancePriceCents: 0,
    callTime: "",
    dayOfPriceCents: 0,
    details: "Controlled ticket-reminder qualification fixture.",
    doorsOpenTime: "",
    durationMinutes: 60,
    isTicketingEnabled: true,
    location: "Qualification only",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: false,
    rsvpFollowUpLeadHours: null,
    rsvpFollowUpMode: "inherit",
    setList: [],
    setListApproved: false,
    startsAt,
    ticketCapacity: 10,
    title,
    type: "Performance",
    venueId: null,
  };
}

function fixtureTitle() {
  return `QUAL-${new Date().toISOString().slice(0, 10)} Ticket Reminder ${crypto.randomUUID().slice(0, 8)}`;
}

async function createEvent(cookie, title, startsAt) {
  const result = await request(
    `${organizationHost}/api/organization/events`,
    "POST",
    cookie,
    eventRequest(title, startsAt),
  );
  if (result.response.status !== 201 || typeof result.body?.id !== "string") {
    throw new Error(
      `Performance creation failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return uuid(result.body.id, "Performance ID");
}

async function completeFreeCheckout(eventId) {
  const result = await request(`${organizationHost}/api/public/tickets/checkout`, "POST", "", {
    buyerEmail,
    buyerName: "Controlled Ticket Reminder Buyer",
    checkoutRequestId: crypto.randomUUID(),
    eventId,
    marketingOptIn: false,
    quantity: 1,
  });
  if (
    result.response.status !== 201 ||
    typeof result.body?.purchase?.id !== "string" ||
    typeof result.body?.successToken !== "string"
  ) {
    throw new Error(
      `Ticket checkout failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  const purchase = result.body.purchase;
  if (
    purchase.eventId !== eventId ||
    purchase.status !== "paid" ||
    purchase.amountPaidCents !== 0 ||
    !["free", "fake"].includes(result.body.checkoutMode)
  ) {
    throw new Error("The qualification ticket checkout did not produce a paid zero-dollar order.");
  }
  return {
    purchaseId: uuid(purchase.id, "Ticket purchase ID"),
    successToken: result.body.successToken,
  };
}

async function runMaintenance(cookie) {
  const result = await request(`${organizationHost}/api/platform/maintenance/run`, "GET", cookie);
  if (
    result.response.status !== 200 ||
    result.body?.success !== true ||
    !Number.isInteger(result.body?.enqueuedJobCount)
  ) {
    throw new Error(
      `Staging maintenance failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return result.body.enqueuedJobCount;
}

async function inspect(cookie, eventId, purchaseId) {
  const [scheduled, orders] = await Promise.all([
    request(`${organizationHost}/api/organization/communications/scheduled`, "GET", cookie),
    request(`${organizationHost}/api/organization/tickets/orders`, "GET", cookie),
  ]);
  if (scheduled.response.status !== 200 || !Array.isArray(scheduled.body?.messages)) {
    throw new Error(
      `Scheduled communication inspection failed with ${requestFailure(scheduled.response.status, scheduled.body)}.`,
    );
  }
  if (orders.response.status !== 200 || !Array.isArray(orders.body?.orders)) {
    throw new Error(
      `Ticket order inspection failed with ${requestFailure(orders.response.status, orders.body)}.`,
    );
  }
  const order = orders.body.orders.find((candidate) => candidate?.id === purchaseId);
  const snapshot = ticketReminderSnapshot(scheduled.body.messages, eventId);
  return {
    order,
    snapshot,
  };
}

async function waitForReminder(cookie, eventId, purchaseId) {
  for (let attempt = 0; attempt < pollingAttempts; attempt += 1) {
    if (attempt === 0 || (attempt + 1) % 3 === 0) {
      console.log(`WAIT ticket_reminder (${String(attempt + 1)}/${String(pollingAttempts)})`);
    }
    const state = await inspect(cookie, eventId, purchaseId);
    if (state.order?.status === "paid" && ticketReminderReady(state.snapshot)) return state;
    if (attempt < pollingAttempts - 1) await sleep(pollingDelayMs);
  }
  throw new Error("ticket_reminder did not reach exactly-one sent state in time.");
}

async function waitForConfirmationResend(cookie, eventId, purchaseId, before) {
  for (let attempt = 0; attempt < pollingAttempts; attempt += 1) {
    if (attempt === 0 || (attempt + 1) % 3 === 0) {
      console.log(
        `WAIT ticket_confirmation_resend (${String(attempt + 1)}/${String(pollingAttempts)})`,
      );
    }
    const state = await inspect(cookie, eventId, purchaseId);
    if (state.order?.status === "paid" && ticketConfirmationResendReady(before, state.snapshot)) {
      return state;
    }
    if (attempt < pollingAttempts - 1) await sleep(pollingDelayMs);
  }
  throw new Error("ticket confirmation resend did not reach a sent state in time.");
}

async function archiveEvent(cookie, eventId) {
  const result = await request(
    `${organizationHost}/api/organization/events/${encodeURIComponent(eventId)}`,
    "DELETE",
    cookie,
  );
  if (result.response.status !== 200) {
    throw new Error(
      `Performance archive failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
}

async function readCanonicalReceipt(successToken, eventId, purchaseId) {
  const result = await request(
    `${organizationHost}/api/public/tickets/order?token=${encodeURIComponent(successToken)}`,
    "GET",
    "",
  );
  if (result.response.status !== 200) {
    throw new Error(
      `Canonical ticket receipt failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  if (!ticketReceiptMatches(result.body, eventId, purchaseId)) {
    throw new Error("The canonical ticket receipt did not match the paid qualification order.");
  }
}

async function resendTicketConfirmation(cookie, purchaseId) {
  const result = await request(
    `${organizationHost}/api/organization/tickets/${encodeURIComponent(purchaseId)}/confirmation`,
    "POST",
    cookie,
  );
  if (result.response.status !== 200 || result.body?.queued !== true) {
    throw new Error(
      `Ticket confirmation resend failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
}

async function refundPurchase(cookie, purchaseId) {
  const result = await request(
    `${organizationHost}/api/organization/tickets/${encodeURIComponent(purchaseId)}/refund`,
    "POST",
    cookie,
  );
  if (result.response.status !== 200 || result.body?.status !== "refunded") {
    throw new Error(
      `Free ticket refund failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
}

async function wrongOrganizationBoundary(cookie, purchaseId, eventId, successToken) {
  return Promise.all([
    request(`${wrongOrganizationHost}/api/organization/communications/scheduled`, "GET", cookie),
    request(`${wrongOrganizationHost}/api/organization/tickets/orders`, "GET", cookie),
    request(
      `${wrongOrganizationHost}/api/public/tickets/order?token=${encodeURIComponent(successToken)}`,
      "GET",
      "",
    ),
    request(
      `${wrongOrganizationHost}/api/organization/tickets/${encodeURIComponent(purchaseId)}/refund`,
      "POST",
      cookie,
    ),
    request(
      `${wrongOrganizationHost}/api/organization/tickets/${encodeURIComponent(purchaseId)}/confirmation`,
      "POST",
      cookie,
    ),
  ]);
}

async function main() {
  if (planOnly) {
    for (const step of ticketReminderQualificationPlan()) console.log(`- ${step}`);
    return;
  }

  const readline = createInterface({ input, output });
  let cookie = null;
  let eventId = null;
  let purchaseId;
  let successToken;
  let cleanupCompleted = true;
  let receiptAccessible;
  let refundCompleted = false;
  let resendConfirmation;
  let summary;

  try {
    cookie = await signIn(readline);
    await verifyPlatformFactor(readline, cookie);
    eventId = await createEvent(
      cookie,
      fixtureTitle(),
      new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    );
    console.log(`PASS ticket-reminder Performance created (${eventId})`);

    const checkout = await completeFreeCheckout(eventId);
    purchaseId = checkout.purchaseId;
    successToken = checkout.successToken;
    console.log(`PASS zero-dollar ticket checkout completed (${purchaseId})`);

    const firstMaintenance = await runMaintenance(cookie);
    console.log(`PASS ticket-reminder maintenance — ${String(firstMaintenance)} job(s) enqueued`);
    const first = await waitForReminder(cookie, eventId, purchaseId);
    console.log("PASS ticket reminder scheduled job and sent delivery");

    const replayMaintenance = await runMaintenance(cookie);
    const replay = await inspect(cookie, eventId, purchaseId);
    const replayStable = ticketReminderSnapshotsMatch(first.snapshot, replay.snapshot);
    console.log(
      `${replayStable ? "PASS" : "FAIL"} ticket-reminder idempotency — ${String(replayMaintenance)} job(s) enqueued on replay`,
    );
    if (!replayStable)
      throw new Error("Ticket reminder replay changed the scheduled notification snapshot.");

    await readCanonicalReceipt(successToken, eventId, purchaseId);
    receiptAccessible = true;
    console.log("PASS canonical ticket receipt remained accessible");

    await resendTicketConfirmation(cookie, purchaseId);
    console.log("PASS ticket confirmation resend queued");
    const resendMaintenance = await runMaintenance(cookie);
    console.log(
      `PASS ticket-confirmation resend maintenance — ${String(resendMaintenance)} job(s) enqueued`,
    );
    const resent = await waitForConfirmationResend(cookie, eventId, purchaseId, first.snapshot);
    const firstConfirmationIds = new Set(
      first.snapshot.rows.filter((row) => row.kind === "ticket_confirmation").map((row) => row.id),
    );
    const resentRow = resent.snapshot.rows.find(
      (row) => row.kind === "ticket_confirmation" && !firstConfirmationIds.has(row.id),
    );
    resendConfirmation = {
      deliveryState: resentRow?.status ?? "unknown",
      recipientCount: resentRow?.recipientCount ?? 0,
      status: resentRow?.status ?? "unknown",
    };
    console.log("PASS ticket confirmation resend delivery");

    const boundary = await wrongOrganizationBoundary(cookie, purchaseId, eventId, successToken);
    const crossOrganizationRejected = ticketReminderBoundaryResponsesSafe(
      boundary.map(({ body, response }) => ({ body, status: response.status })),
      purchaseId,
      eventId,
    );
    console.log(
      `${crossOrganizationRejected ? "PASS" : "FAIL"} ticket-reminder cross-Organization boundary (HTTP ${boundary.map(({ response }) => response.status).join("/")}; target data absent)`,
    );
    if (!crossOrganizationRejected) {
      throw new Error(
        "Ticket order, receipt, reminder, resend, or refund behavior was accessible on the wrong Organization host.",
      );
    }

    await refundPurchase(cookie, purchaseId);
    refundCompleted = true;
    console.log("PASS free simulated ticket refund completed");

    const reminder = first.snapshot.rows.find((row) => row.kind === "ticket_reminder");
    summary = safeTicketReminderQualificationSummary({
      cleanupCompleted: false,
      crossOrganizationRejected,
      eventId,
      purchaseId,
      receiptAccessible,
      refundBoundaryRejected: true,
      refundCompleted,
      resendBoundaryRejected: true,
      resendConfirmation,
      reminder: {
        deliveryState: reminder?.status ?? "unknown",
        jobCount: first.snapshot.rows.filter((row) => row.kind === "ticket_reminder").length,
        recipientCount: reminder?.recipientCount ?? 0,
        replayStable,
        status: reminder?.status ?? "unknown",
      },
    });
  } finally {
    if (cookie && purchaseId && !refundCompleted) {
      try {
        await refundPurchase(cookie, purchaseId);
        refundCompleted = true;
      } catch {
        cleanupCompleted = false;
        console.error("Ticket-reminder qualification order cleanup did not complete.");
      }
    }
    if (cookie && eventId) {
      try {
        await archiveEvent(cookie, eventId);
      } catch {
        cleanupCompleted = false;
        console.error("Ticket-reminder qualification event cleanup did not complete.");
      }
    } else if (eventId) {
      cleanupCompleted = false;
    }
    readline.close();
  }

  if (!summary) throw new Error("Ticket-reminder qualification did not produce a result.");
  summary.cleanupCompleted = cleanupCompleted;
  summary.receiptAccessible = receiptAccessible;
  summary.refundCompleted = refundCompleted;
  if (!cleanupCompleted)
    throw new Error("Ticket-reminder qualification fixture cleanup did not complete.");
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  await main();
}
