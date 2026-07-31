import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { configuredBrevoEmailSender, deliverOrganizationCommunication } from "./provider";

const delivery = {
  channel: "email" as const,
  contentMarkdown: "Hello <Singer>",
  deliveryId: "00000000-0000-4000-8000-000000000001",
  destination: "singer@example.test",
  messageId: "00000000-0000-4000-8000-000000000002",
  recipientName: "Singer Name",
  subject: "Rehearsal",
  unsubscribeUrl: "https://alpha.staging.example.com/unsubscribe?token=signed-value",
};

describe("Organization communication provider", () => {
  it("reports the effective configured email sender without exposing provider credentials", () => {
    expect(
      configuredBrevoEmailSender({
        BREVO_EMAIL_FROM: " communications@mail.staging.example.com ",
        BREVO_EMAIL_FROM_NAME: " Example Choir ",
      }),
    ).toEqual({
      fromEmail: "communications@mail.staging.example.com",
      fromName: "Example Choir",
    });
    expect(configuredBrevoEmailSender({})).toEqual({ fromEmail: null, fromName: null });
  });

  it("uses Brevo email sandbox-drop mode and includes the signed unsubscribe link", async () => {
    const fetcher = vi.fn((input: string, request: RequestInit) => {
      void input;
      void request;
      return Promise.resolve(Response.json({ messageId: "brevo-email-id" }, { status: 201 }));
    });
    const result = await deliverOrganizationCommunication(
      {
        BREVO_API_KEY: "sandbox-key",
        BREVO_EMAIL_FROM: "communications@mail.staging.example.com",
        BREVO_EMAIL_FROM_NAME: "Example Choir",
        EXTERNAL_EFFECTS_MODE: "sandbox",
      },
      delivery,
      fetcher,
    );

    expect(result).toEqual({
      failureDetail: "",
      providerMessageId: "brevo-email-id",
      status: "sent",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(request?.headers).toMatchObject({ "api-key": "sandbox-key" });
    const requestBody = request?.body;
    if (typeof requestBody !== "string") throw new Error("Expected a JSON request body.");
    const parsedBody: unknown = JSON.parse(requestBody);
    const body = z
      .object({
        headers: z.object({ "X-Sib-Sandbox": z.string() }),
        htmlContent: z.string(),
        subject: z.string(),
        textContent: z.string(),
      })
      .parse(parsedBody);
    expect(body).toMatchObject({
      headers: { "X-Sib-Sandbox": "drop" },
      subject: "Rehearsal",
      textContent: expect.stringContaining(delivery.unsubscribeUrl),
    });
    expect(body.htmlContent).toContain("Hello &lt;Singer&gt;");
  });

  it("suppresses a sandbox SMS recipient that is not explicitly allowlisted", async () => {
    const fetcher = vi.fn((input: string, request: RequestInit) => {
      void input;
      void request;
      return Promise.resolve(Response.json({ messageId: 123 }, { status: 201 }));
    });
    const result = await deliverOrganizationCommunication(
      {
        BREVO_API_KEY: "sandbox-key",
        BREVO_SMS_ALLOWED_RECIPIENTS: "+15550000002",
        BREVO_SMS_SENDER: "MusicSite",
        EXTERNAL_EFFECTS_MODE: "sandbox",
      },
      {
        ...delivery,
        channel: "sms",
        destination: "+15550000001",
        unsubscribeUrl: null,
      },
      fetcher,
    );

    expect(result.status).toBe("suppressed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses the transactional SMS endpoint only for an allowlisted sandbox recipient", async () => {
    const fetcher = vi.fn((input: string, request: RequestInit) => {
      void input;
      void request;
      return Promise.resolve(Response.json({ messageId: 123 }, { status: 201 }));
    });
    const result = await deliverOrganizationCommunication(
      {
        BREVO_API_KEY: "sandbox-key",
        BREVO_SMS_ALLOWED_RECIPIENTS: "+15550000001",
        BREVO_SMS_SENDER: "MusicSite",
        EXTERNAL_EFFECTS_MODE: "sandbox",
      },
      {
        ...delivery,
        channel: "sms",
        destination: "+15550000001",
        unsubscribeUrl: null,
      },
      fetcher,
    );

    expect(result.providerMessageId).toBe("123");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.brevo.com/v3/transactionalSMS/send");
  });

  it("fails closed without exposing rejected provider response bodies", async () => {
    const fetcher = vi.fn((input: string, request: RequestInit) => {
      void input;
      void request;
      return Promise.resolve(new Response("credential details", { status: 401 }));
    });
    await expect(
      deliverOrganizationCommunication(
        {
          BREVO_API_KEY: "sandbox-key",
          BREVO_EMAIL_FROM: "communications@mail.staging.example.com",
          EXTERNAL_EFFECTS_MODE: "sandbox",
        },
        delivery,
        fetcher,
      ),
    ).rejects.toThrow("provider rejected its credentials");
    await expect(
      deliverOrganizationCommunication(
        {
          BREVO_API_KEY: "sandbox-key",
          BREVO_EMAIL_FROM: "communications@mail.staging.example.com",
          EXTERNAL_EFFECTS_MODE: "sandbox",
        },
        delivery,
        fetcher,
      ),
    ).rejects.not.toThrow("credential details");
  });
});
