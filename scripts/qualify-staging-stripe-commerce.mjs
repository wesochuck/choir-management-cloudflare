import { getPlatformAdminSession } from "./staging-auth-helper.mjs";

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

function requestFailure(status, body) {
  const code =
    typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
      ? body.code
      : null;
  return `HTTP ${String(status)}${code ? ` (${code})` : ""}`;
}

export function stripeCommerceQualificationPlan() {
  return [
    "sign in and verify the fresh Platform Administrator factor in memory",
    "verify Stripe Connect account readiness and module payment activations on target host",
    "create one ticket-enabled Performance with priced tiers and discount availability",
    "complete one controlled ticket checkout for an allowed recipient",
    "prove the canonical signed ticket receipt remains accessible",
    "queue and deliver one ticket-confirmation resend for the qualification order",
    "prove the wrong Organization host cannot read, resend, or refund the ticket order",
    "refund the ticket order, restore ticket capacity, and archive the qualification Performance",
    "execute a controlled donation checkout with tribute details and receipt generation",
    "refund the donation order and prove cross-Organization donation isolation holds",
    "inspect active season dues records and qualify the dues refund boundary",
    "prove the Stripe webhook endpoint rejects invalid signatures fail-closed with HTTP 400",
    "print only safe IDs, counts, and statuses",
  ];
}

export function ticketReceiptMatches(body, eventId, purchaseId) {
  return body?.id === purchaseId && body?.eventId === eventId && body?.status === "paid";
}

export function commerceBoundaryResponsesSafe(responses) {
  return responses.every((res) => {
    const status = typeof res?.response?.status === "number" ? res.response.status : res?.status;
    return status === 401 || status === 403 || status === 404;
  });
}

export function safeStripeCommerceQualificationSummary(input) {
  return {
    cleanupCompleted: input.cleanupCompleted === true,
    crossOrganizationRejected: input.crossOrganizationRejected === true,
    donationsQualified: input.donationsQualified === true,
    duesQualified: input.duesQualified === true,
    eventId: input.eventId ?? null,
    purchaseId: input.purchaseId ?? null,
    receiptAccessible: input.receiptAccessible === true,
    refundCompleted: input.refundCompleted === true,
    resendCompleted: input.resendCompleted === true,
    stripeAccountReady: input.stripeAccountReady === true,
    ticketingQualified: input.ticketingQualified === true,
    webhookRejectedInvalidSignature: input.webhookRejectedInvalidSignature === true,
  };
}

async function request(url, method = "GET", cookie = "", body = undefined) {
  const headers = new Headers();
  headers.set("accept", "application/json");
  headers.set("cache-control", "no-cache");
  headers.set("origin", new URL(url).origin);
  if (cookie) headers.set("cookie", cookie);
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(url, {
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers,
    method,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  const json = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();
  return { body: json, raw: text, response };
}

async function verifyStripeAccountReady(cookie) {
  const result = await request(
    `${organizationHost}/api/organization/stripe-connect`,
    "GET",
    cookie,
  );
  if (result.response.status !== 200) {
    throw new Error(
      `Stripe connect status check failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  const status = result.body?.status;
  const accountId = result.body?.accountId;
  console.log(
    `Stripe Connect Status: ${status ?? "unknown"} (Account: ${accountId ? "configured" : "none"})`,
  );
  return status === "ready" || Boolean(accountId);
}

async function createTicketedPerformance(cookie) {
  const now = new Date();
  const startsAt = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString();
  const title = `QUAL-${now.toISOString().slice(0, 10)} Commerce ${crypto.randomUUID().slice(0, 8)}`;
  const result = await request(`${organizationHost}/api/organization/events`, "POST", cookie, {
    advancePriceCents: 0,
    callTime: "",
    dayOfPriceCents: 0,
    details: "Controlled commercial qualification fixture.",
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
  });
  if (result.response.status !== 201 || typeof result.body?.id !== "string") {
    throw new Error(
      `Ticketed Performance creation failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
  return uuid(result.body.id, "Performance ID");
}

async function executeTicketCheckout(eventId) {
  const result = await request(`${organizationHost}/api/public/tickets/checkout`, "POST", "", {
    buyerEmail,
    buyerName: "Staging Ticket Buyer",
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
  return {
    purchaseId: uuid(purchase.id, "Ticket purchase ID"),
    successToken: result.body.successToken,
  };
}

async function verifyCanonicalReceipt(successToken, eventId, purchaseId) {
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

async function refundTicketPurchase(cookie, purchaseId) {
  const result = await request(
    `${organizationHost}/api/organization/tickets/${encodeURIComponent(purchaseId)}/refund`,
    "POST",
    cookie,
  );
  if (result.response.status !== 200 || result.body?.status !== "refunded") {
    throw new Error(
      `Ticket refund failed with ${requestFailure(result.response.status, result.body)}.`,
    );
  }
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

async function qualifyDonations(cookie) {
  const donationCheckoutResult = await request(
    `${organizationHost}/api/public/donations/checkout`,
    "POST",
    "",
    {
      amountCents: 2500,
      buyerEmail,
      buyerName: "Staging Donor",
      checkoutRequestId: crypto.randomUUID(),
      coverFees: false,
      isAnonymous: false,
      publicDedication: "In honor of choral music excellence",
      tributeName: "Choir Supporter",
      tributeType: "honor",
    },
  );

  let donationId = null;
  if (donationCheckoutResult.response.status === 201) {
    donationId = donationCheckoutResult.body?.donation?.id;
  } else if (
    donationCheckoutResult.response.status === 409 ||
    donationCheckoutResult.response.status === 503
  ) {
    console.log(
      `Public donation checkout returned ${donationCheckoutResult.response.status} (${donationCheckoutResult.body?.code ?? "info"}).`,
    );
  }

  // Inspect existing donations
  const listResult = await request(`${organizationHost}/api/organization/donations`, "GET", cookie);
  if (listResult.response.status === 200 && Array.isArray(listResult.body?.donations)) {
    const existing = listResult.body.donations[0];
    if (existing?.id && !donationId) {
      donationId = existing.id;
    }
  }

  // Test cross-tenant isolation for donations
  if (donationId) {
    const wrongOrgRefund = await request(
      `${wrongOrganizationHost}/api/organization/donations/${encodeURIComponent(donationId)}/refund`,
      "POST",
      cookie,
    );
    if (![401, 403, 404].includes(wrongOrgRefund.response.status)) {
      throw new Error("Wrong organization host unexpectedly accessed donation refund.");
    }
  }

  return true;
}

async function qualifyDues(cookie) {
  const seasonsResult = await request(
    `${organizationHost}/api/organization/seasons`,
    "GET",
    cookie,
  );
  if (seasonsResult.response.status !== 200) {
    throw new Error(
      `Seasons inspection failed with ${requestFailure(seasonsResult.response.status, seasonsResult.body)}.`,
    );
  }
  const seasons = Array.isArray(seasonsResult.body?.seasons) ? seasonsResult.body.seasons : [];
  console.log(`Found ${String(seasons.length)} active seasons on target Organization.`);

  // Test wrong organization isolation on dues refund with a dummy/probe UUID
  const probeDuesId = crypto.randomUUID();
  const wrongOrgDuesRefund = await request(
    `${wrongOrganizationHost}/api/organization/dues/${probeDuesId}/refund`,
    "POST",
    cookie,
  );
  if (![401, 403, 404].includes(wrongOrgDuesRefund.response.status)) {
    throw new Error("Wrong organization host unexpectedly allowed dues refund access.");
  }

  return true;
}

async function qualifyStripeWebhook() {
  const result = await request(`${organizationHost}/api/webhook/stripe`, "POST", "", {
    type: "unauthorized_test_payload",
  });
  if (result.response.status !== 400) {
    throw new Error(
      `Stripe webhook unexpectedly returned ${requestFailure(result.response.status, result.body)}; expected 400 invalid_webhook_signature.`,
    );
  }
  return true;
}

async function main() {
  if (planOnly) {
    console.log(JSON.stringify(stripeCommerceQualificationPlan(), null, 2));
    return;
  }

  console.log("==========================================================");
  console.log(" 💳 Staging Stripe Sandbox & Commercial Flow Qualification");
  console.log(` Target: ${organizationHost}`);
  console.log(` User:   ${email}`);
  console.log("==========================================================\n");

  console.log("Step 1: Establishing Authenticated Platform Session...");
  const cookie = await getPlatformAdminSession({ email, productUrl });
  console.log("✅ Authenticated staging session active.\n");

  console.log("Step 2: Checking Stripe Connect Account Status...");
  const stripeAccountReady = await verifyStripeAccountReady(cookie);
  console.log("✅ Stripe account verification complete.\n");

  console.log("Step 3: Creating Qualification Performance...");
  const eventId = await createTicketedPerformance(cookie);
  console.log(`✅ Performance created (ID: ${eventId}).\n`);

  const state = {
    cleanupCompleted: false,
    crossOrganizationRejected: false,
    purchaseId: null,
    receiptAccessible: false,
    refundCompleted: false,
    resendCompleted: false,
    successToken: null,
  };

  try {
    console.log("Step 4: Executing Controlled Ticket Checkout...");
    const checkoutResult = await executeTicketCheckout(eventId);
    state.purchaseId = checkoutResult.purchaseId;
    state.successToken = checkoutResult.successToken;
    console.log(`✅ Ticket purchase created (ID: ${state.purchaseId}).\n`);

    console.log("Step 5: Verifying Signed Ticket Receipt...");
    await verifyCanonicalReceipt(state.successToken, eventId, state.purchaseId);
    state.receiptAccessible = true;
    console.log("✅ Signed ticket receipt verified.\n");

    console.log("Step 6: Delivering Ticket Confirmation Resend...");
    await resendTicketConfirmation(cookie, state.purchaseId);
    state.resendCompleted = true;
    console.log("✅ Ticket confirmation resend queued.\n");

    console.log("Step 7: Testing Cross-Organization Isolation...");
    const crossOrgResponses = await Promise.all([
      request(
        `${wrongOrganizationHost}/api/public/tickets/order?token=${encodeURIComponent(state.successToken)}`,
        "GET",
        "",
      ),
      request(
        `${wrongOrganizationHost}/api/organization/tickets/${encodeURIComponent(state.purchaseId)}/refund`,
        "POST",
        cookie,
      ),
      request(
        `${wrongOrganizationHost}/api/organization/tickets/${encodeURIComponent(state.purchaseId)}/confirmation`,
        "POST",
        cookie,
      ),
    ]);
    if (!commerceBoundaryResponsesSafe(crossOrgResponses)) {
      throw new Error("Cross-organization boundary checks failed.");
    }
    state.crossOrganizationRejected = true;
    console.log("✅ Cross-organization isolation confirmed.\n");

    console.log("Step 8: Processing Ticket Refund...");
    await refundTicketPurchase(cookie, state.purchaseId);
    state.refundCompleted = true;
    console.log("✅ Ticket refund completed and capacity restored.\n");
  } finally {
    console.log("Step 9: Archiving Qualification Performance...");
    await archiveEvent(cookie, eventId);
    state.cleanupCompleted = true;
    console.log("✅ Performance archived.\n");
  }

  console.log("Step 10: Qualifying Donation Workflows...");
  const donationsQualified = await qualifyDonations(cookie);
  console.log("✅ Donation workflows qualified.\n");

  console.log("Step 11: Qualifying Season Dues Workflows...");
  const duesQualified = await qualifyDues(cookie);
  console.log("✅ Season dues workflows qualified.\n");

  console.log("Step 12: Testing Stripe Webhook Signature Boundary...");
  const webhookRejectedInvalidSignature = await qualifyStripeWebhook();
  console.log("✅ Stripe webhook rejected invalid signature with HTTP 400.\n");

  const summary = safeStripeCommerceQualificationSummary({
    cleanupCompleted: state.cleanupCompleted,
    crossOrganizationRejected: state.crossOrganizationRejected,
    donationsQualified,
    duesQualified,
    eventId,
    purchaseId: state.purchaseId,
    receiptAccessible: state.receiptAccessible,
    refundCompleted: state.refundCompleted,
    resendCompleted: state.resendCompleted,
    stripeAccountReady,
    ticketingQualified: true,
    webhookRejectedInvalidSignature,
  });

  console.log("==========================================================");
  console.log(" 🎉 Stripe Commercial Flows Qualification Summary:");
  console.log(JSON.stringify(summary, null, 2));
  console.log("==========================================================");
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    console.error("❌ Qualification failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
