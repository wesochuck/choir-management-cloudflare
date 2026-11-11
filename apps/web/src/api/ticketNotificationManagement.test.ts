import { afterEach, describe, expect, it, vi } from "vitest";
import { ticketNotificationCancelSchema, ticketNotificationDetailsSchema } from "@choir/contracts";
import { cancelTicketNotification, getTicketNotificationDetails } from "./communications";
import { AuthApiError } from "./client";

const id = "11111111-1111-4111-8111-111111111111";
const details = {
  id,
  purchaseId: id,
  buyerName: "Buyer",
  recipientEmail: "buyer@example.test",
  purchaseStatus: "refunded",
  refundedAt: null,
  status: "suppressed",
  kind: "confirmation",
  scheduledAt: "2026-09-22T05:18:00.000Z",
  updatedAt: "2026-09-22T05:45:00.000Z",
  failureDetail: "Canceled",
  providerStatus: null,
  providerMessageId: null,
  jobStatus: null,
  jobAttempts: null,
  canCancel: false,
};
afterEach(() => vi.unstubAllGlobals());
describe("ticket notification transport contracts", () => {
  it("parses details with nullable provider/job history and validates each required field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(details)));
    expect(await getTicketNotificationDetails(id)).toEqual(details);
    for (const key of [
      "refundedAt",
      "providerStatus",
      "providerMessageId",
      "jobStatus",
      "jobAttempts",
    ] as const) {
      expect(
        ticketNotificationDetailsSchema.safeParse({ ...details, [key]: undefined }).success,
      ).toBe(false);
    }
    expect(
      ticketNotificationDetailsSchema.safeParse({
        ...details,
        refundedAt: "2026-09-22T05:20:00.000Z",
        providerStatus: "accepted",
        providerMessageId: "message-1",
        jobStatus: "failed",
        jobAttempts: 6,
      }).success,
    ).toBe(true);
    expect(
      ticketNotificationDetailsSchema.safeParse({ ...details, status: "unknown" }).success,
    ).toBe(false);
  });
  it("validates and trims cancellation reasons before issuing the request", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ canceled: true }));
    vi.stubGlobal("fetch", fetch);
    await expect(cancelTicketNotification(id, " ")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(ticketNotificationCancelSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(
      false,
    );
    await cancelTicketNotification(id, " Refunded test ");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/ticket-notifications/${id}/cancel`),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "Refunded test" }),
      }),
    );
  });
  it.each([403, 409])("preserves typed authorization/concurrency failures (%s)", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "notification_not_cancelable", message: "Refresh its details.", requestId: id },
            { status },
          ),
        ),
    );
    await expect(cancelTicketNotification(id, "Test")).rejects.toMatchObject({
      status,
      code: "notification_not_cancelable",
      message: "Refresh its details.",
    });
    await expect(getTicketNotificationDetails(id)).rejects.toBeInstanceOf(AuthApiError);
  });
  it("rejects a successful HTTP response that does not confirm cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ canceled: false })));
    await expect(cancelTicketNotification(id, "Refunded test")).rejects.toThrow();
  });
});
