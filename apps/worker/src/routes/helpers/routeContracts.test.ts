import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { stripeSignatureForTest, verifyStripeWebhookSignature } from "../../payments/stripeWebhook";
import {
  createJsonBodyGuardMiddleware,
  isNonJsonBodyRoute,
  jsonContentType,
  type WorkerHonoEnvironment,
} from "./routeContracts";

function createTrackedChunkedStream(chunks: readonly string[]): {
  readonly cancelled: () => boolean;
  readonly pulledChunks: () => number;
  readonly stream: ReadableStream<Uint8Array>;
} {
  let index = 0;
  let pulled = 0;
  let wasCancelled = false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>(
    {
      cancel() {
        wasCancelled = true;
      },
      pull(controller) {
        pulled += 1;
        const next = chunks[index];
        if (next === undefined) {
          controller.close();
          return;
        }
        index += 1;
        controller.enqueue(encoder.encode(next));
      },
    },
    { highWaterMark: 0 },
  );

  return {
    cancelled: () => wasCancelled,
    pulledChunks: () => pulled,
    stream,
  };
}

function createGuardTestApp(maxBytes: number) {
  const app = new Hono<WorkerHonoEnvironment>();
  const handlerSpy = vi.fn();

  app.use("*", async (context, next) => {
    context.set("requestId", "00000000-0000-4000-8000-000000000001");
    await next();
  });
  app.use("*", createJsonBodyGuardMiddleware(maxBytes));

  app.post("/api/public/donations/checkout", async (context) => {
    const parsed: unknown = await context.req.json();
    handlerSpy(parsed);
    return context.json({ ok: true, parsed }, 200);
  });

  app.post("/api/public/rsvp", async (context) => {
    const parsed: unknown = await context.req.json();
    handlerSpy(parsed);
    return context.json({ ok: true, parsed }, 200);
  });

  app.post("/api/public/donations/artwork/upload", async (context) => {
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    handlerSpy(bytes.byteLength);
    return context.json({ bytes: bytes.byteLength }, 201);
  });

  app.put("/api/organization/files/:fileId", async (context) => {
    const bytes = new Uint8Array(await context.req.arrayBuffer());
    handlerSpy(bytes.byteLength);
    return context.json({ bytes: bytes.byteLength }, 201);
  });

  app.post("/api/webhook/stripe", async (context) => {
    const rawBody = await context.req.text();
    const signature = context.req.header("stripe-signature") ?? null;
    const valid = await verifyStripeWebhookSignature(
      "whsec_test_secret",
      signature,
      rawBody,
      1_700_000_000_000,
    );
    handlerSpy({ rawLength: rawBody.length, valid });
    return context.json({ valid }, valid ? 200 : 400);
  });

  return { app, handlerSpy };
}

describe("JSON body guard middleware (SEC-04)", () => {
  it("recognizes JSON and omitted content types while rejecting explicit non-JSON types", () => {
    expect(jsonContentType(undefined)).toBe(true);
    expect(jsonContentType("application/json")).toBe(true);
    expect(jsonContentType("application/json; charset=utf-8")).toBe(true);
    expect(jsonContentType("application/problem+json")).toBe(true);
    expect(jsonContentType("text/plain")).toBe(false);
    expect(jsonContentType("text/plain; charset=utf-8")).toBe(false);
    expect(jsonContentType("application/octet-stream")).toBe(false);
    expect(jsonContentType("multipart/form-data; boundary=abc")).toBe(false);
  });

  it("returns 415 without consuming the stream when a wrong media type hits a public JSON route", async () => {
    const { app, handlerSpy } = createGuardTestApp(32);
    const tracked = createTrackedChunkedStream(['{"token":"abc"}', '{"extra":"oversized"}']);

    const request = new Request("https://alpha.localhost/api/public/donations/checkout", {
      body: tracked.stream,
      duplex: "half",
      headers: { "content-type": "text/plain" },
      method: "POST",
    } as RequestInit);

    const response = await app.request(request);
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({
      code: "unsupported_media_type",
    });
    expect(handlerSpy).not.toHaveBeenCalled();
    // Stream was never read or consumed by the middleware.
    expect(tracked.pulledChunks()).toBe(0);
    expect(request.bodyUsed).toBe(false);
  });

  it("returns 413 before handler/schema validation for an oversized chunked JSON body without Content-Length", async () => {
    const { app, handlerSpy } = createGuardTestApp(24);
    const tracked = createTrackedChunkedStream(['{"a":"1234567890",', '"b":"1234567890"}']);

    const request = new Request("https://alpha.localhost/api/public/rsvp", {
      body: tracked.stream,
      duplex: "half",
      headers: { "content-type": "application/json" },
      method: "POST",
    } as RequestInit);

    const response = await app.request(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      code: "request_body_too_large",
    });
    expect(handlerSpy).not.toHaveBeenCalled();
    expect(tracked.cancelled()).toBe(true);
  });

  it("bounds omitted Content-Type JSON bodies and allows exact-limit payloads", async () => {
    const { app, handlerSpy } = createGuardTestApp(15);
    const exactPayload = '{"ok":"123456"}';
    expect(exactPayload.length).toBe(15);

    const exactRequest = new Request("https://alpha.localhost/api/public/rsvp", {
      body: new TextEncoder().encode(exactPayload),
      method: "POST",
    });
    expect(exactRequest.headers.get("content-type")).toBeNull();
    const exactResponse = await app.request(exactRequest);
    expect(exactResponse.status).toBe(200);
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    handlerSpy.mockClear();
    const overPayload = '{"ok":"1234567"}';
    expect(overPayload.length).toBe(16);
    const tracked = createTrackedChunkedStream([overPayload]);
    const overResponse = await app.request(
      new Request("https://alpha.localhost/api/public/rsvp", {
        body: tracked.stream,
        duplex: "half",
        method: "POST",
      } as RequestInit),
    );
    expect(overResponse.status).toBe(413);
    expect(handlerSpy).not.toHaveBeenCalled();
    expect(tracked.cancelled()).toBe(true);
  });

  it("preserves separate byte and media-type policies for binary uploads and signed webhooks", async () => {
    const { app, handlerSpy } = createGuardTestApp(16);

    // Binary upload larger than the 16-byte JSON cap with image/png media type passes.
    const pngBytes = new Uint8Array(64).fill(0x42);
    const artworkResponse = await app.request(
      new Request("https://alpha.localhost/api/public/donations/artwork/upload", {
        body: pngBytes,
        headers: { "content-type": "image/png" },
        method: "POST",
      }),
    );
    expect(artworkResponse.status).toBe(201);
    expect(await artworkResponse.json()).toEqual({ bytes: 64 });

    const privateFileResponse = await app.request(
      new Request(
        "https://alpha.localhost/api/organization/files/11111111-1111-4111-8111-111111111111",
        {
          body: pngBytes,
          headers: { "content-type": "application/pdf" },
          method: "PUT",
        },
      ),
    );
    expect(privateFileResponse.status).toBe(201);
    expect(await privateFileResponse.json()).toEqual({ bytes: 64 });

    // Signed Stripe webhook larger than the 16-byte JSON cap preserves exact raw bytes & signature.
    const webhookPayload = JSON.stringify({
      id: "evt_test_123",
      type: "checkout.session.completed",
    });
    expect(webhookPayload.length).toBeGreaterThan(16);
    const signature = await stripeSignatureForTest(
      "whsec_test_secret",
      webhookPayload,
      1_700_000_000,
    );
    const webhookResponse = await app.request(
      new Request("https://alpha.localhost/api/webhook/stripe", {
        body: webhookPayload,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "stripe-signature": signature,
        },
        method: "POST",
      }),
    );
    expect(webhookResponse.status).toBe(200);
    expect(await webhookResponse.json()).toEqual({ valid: true });
    expect(handlerSpy).toHaveBeenCalledTimes(3);

    expect(isNonJsonBodyRoute("POST", "/api/public/donations/checkout")).toBe(false);
    expect(isNonJsonBodyRoute("POST", "/api/public/donations/artwork/upload")).toBe(true);
    expect(isNonJsonBodyRoute("POST", "/api/public/donations/sponsor-artwork")).toBe(true);
    expect(isNonJsonBodyRoute("POST", "/api/webhook/stripe")).toBe(true);
    expect(isNonJsonBodyRoute("POST", "/api/webhook/stripe/v2")).toBe(true);
  });
});
