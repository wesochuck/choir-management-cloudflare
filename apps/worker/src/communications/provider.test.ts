import { describe, expect, it, vi } from "vitest";

import {
  configuredPlatformEmailSender,
  deliverOrganizationCommunication,
  renderCommunicationMarkdown,
  renderCommunicationText,
} from "./provider";

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

function platformEmailBinding() {
  return {
    send: vi.fn().mockResolvedValue({ messageId: "cloudflare-email-id" }),
  };
}

describe("Organization communication provider", () => {
  it("reports the effective configured email sender without exposing provider credentials", () => {
    expect(
      configuredPlatformEmailSender({
        PLATFORM_EMAIL_FROM: " communications@mail.staging.example.com ",
      }),
    ).toEqual({
      fromEmail: "communications@mail.staging.example.com",
      fromName: "Choir Management",
    });
    expect(configuredPlatformEmailSender({})).toEqual({ fromEmail: null, fromName: null });
  });

  it("sends Organization email through the Cloudflare binding with the signed unsubscribe link", async () => {
    const email = platformEmailBinding();
    const result = await deliverOrganizationCommunication(
      {
        EXTERNAL_EFFECTS_MODE: "sandbox",
        PLATFORM_EMAIL: email,
        PLATFORM_EMAIL_ALLOWED_RECIPIENTS: " singer@example.test ,other@example.test",
        PLATFORM_EMAIL_FROM: "communications@mail.staging.example.com",
        PLATFORM_EMAIL_MODE: "sandbox",
      },
      delivery,
    );

    expect(result).toEqual({
      failureDetail: "",
      providerMessageId: "cloudflare-email-id",
      status: "sent",
    });
    expect(email.send).toHaveBeenCalledOnce();
    const sent = email.send.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      from: { email: "communications@mail.staging.example.com", name: "Choir Management" },
      subject: "Rehearsal",
      text: expect.stringContaining(delivery.unsubscribeUrl),
      to: "singer@example.test",
    });
    expect(sent?.html).toContain("Hello &lt;Singer&gt;");
    expect(sent?.html).toContain(delivery.unsubscribeUrl);
    expect(sent?.html).toContain("<!doctype html>");
    expect(sent?.html).toContain('role="presentation"');
    expect(sent?.html).toContain("<!--[if mso]>");
    expect(sent?.html).toContain(">Rehearsal</h1>");
  });

  it("suppresses a sandbox email recipient that is not allowlisted without calling the binding", async () => {
    const email = platformEmailBinding();
    const result = await deliverOrganizationCommunication(
      {
        EXTERNAL_EFFECTS_MODE: "sandbox",
        PLATFORM_EMAIL: email,
        PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "other@example.test",
        PLATFORM_EMAIL_FROM: "communications@mail.staging.example.com",
        PLATFORM_EMAIL_MODE: "sandbox",
      },
      delivery,
    );

    expect(result.status).toBe("suppressed");
    expect(email.send).not.toHaveBeenCalled();
  });

  it("sends to any recipient when no allowlist is configured", async () => {
    const email = platformEmailBinding();
    const result = await deliverOrganizationCommunication(
      {
        EXTERNAL_EFFECTS_MODE: "sandbox",
        PLATFORM_EMAIL: email,
        PLATFORM_EMAIL_FROM: "communications@mail.staging.example.com",
        PLATFORM_EMAIL_MODE: "sandbox",
      },
      delivery,
    );

    expect(result.status).toBe("sent");
    expect(email.send).toHaveBeenCalledOnce();
    expect(email.send.mock.calls[0]?.[0]).toMatchObject({ to: "singer@example.test" });
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

  it("fails closed without exposing rejected SMS provider response bodies", async () => {
    const fetcher = vi.fn((input: string, request: RequestInit) => {
      void input;
      void request;
      return Promise.resolve(new Response("credential details", { status: 401 }));
    });
    const smsDelivery = {
      ...delivery,
      channel: "sms" as const,
      destination: "+15550000001",
      unsubscribeUrl: null,
    };
    await expect(
      deliverOrganizationCommunication(
        {
          BREVO_API_KEY: "sandbox-key",
          BREVO_SMS_ALLOWED_RECIPIENTS: "+15550000001",
          BREVO_SMS_SENDER: "MusicSite",
          EXTERNAL_EFFECTS_MODE: "sandbox",
        },
        smsDelivery,
        fetcher,
      ),
    ).rejects.toThrow("provider rejected its credentials");
    await expect(
      deliverOrganizationCommunication(
        {
          BREVO_API_KEY: "sandbox-key",
          BREVO_SMS_ALLOWED_RECIPIENTS: "+15550000001",
          BREVO_SMS_SENDER: "MusicSite",
          EXTERNAL_EFFECTS_MODE: "sandbox",
        },
        smsDelivery,
        fetcher,
      ),
    ).rejects.not.toThrow("credential details");
  });

  it("prevents markdown link URLs from injecting HTML attributes into emails", () => {
    // The whole markdown is HTML-escaped before the link regex runs, so a
    // quoted URL cannot break out of the href attribute: escaping makes the
    // URL fail parsing, and it degrades to plain escaped text.
    const rendered = renderCommunicationMarkdown('[click](https://example.com" onclick="x=1)');
    expect(rendered).not.toContain('onclick="');
    expect(rendered).toBe("<p>click</p>");
    // Normal links still render with the single-escaped href.
    const normal = renderCommunicationMarkdown("[docs](https://example.com?a=1&b=2)");
    expect(normal).toContain('href="https://example.com?a=1&amp;b=2"');
    expect(normal).toContain(">docs</a>");
    const underscored = renderCommunicationMarkdown(
      "Read [the event details](https://example.com/event_details?id=1_2).",
    );
    expect(underscored).toContain('href="https://example.com/event_details?id=1_2"');
    expect(underscored).toContain(">the event details</a>");
  });

  it("turns standalone links into prominent table-based actions", () => {
    const rendered = renderCommunicationMarkdown(
      "Please review the details.\n\n[Open your tickets](https://example.com/tickets?id=1&order=2)",
    );

    expect(rendered).toContain('role="presentation"');
    expect(rendered).toContain('bgcolor="#1b4d3e"');
    expect(rendered).toContain(">Open your tickets</a>");
    expect(rendered).toContain('href="https://example.com/tickets?id=1&amp;order=2"');
  });

  it("removes Markdown decoration while preserving destinations in plain text", () => {
    expect(
      renderCommunicationText(
        "## Order confirmed\n\n- **Total:** $20\n\n[Open tickets](https://example.com/tickets)",
      ),
    ).toBe("Order confirmed\n\n- Total: $20\n\nOpen tickets: https://example.com/tickets");
  });

  it("preserves base64url underscores in sent HTML and plain-text link and code spans", async () => {
    const email = platformEmailBinding();
    const signedUrl = "https://example.com/tickets?token=header_part_middle_tail";
    const credential = "ticket_part_middle_tail";

    await deliverOrganizationCommunication(
      {
        EXTERNAL_EFFECTS_MODE: "sandbox",
        PLATFORM_EMAIL: email,
        PLATFORM_EMAIL_FROM: "communications@mail.staging.example.com",
        PLATFORM_EMAIL_MODE: "sandbox",
      },
      {
        ...delivery,
        contentMarkdown: `[Open tickets](${signedUrl})\n\n\`${credential}\``,
        unsubscribeUrl: "https://example.com/unsubscribe?token=unsubscribe_part_tail",
      },
    );

    const sent = email.send.mock.calls[0]?.[0];
    expect(sent?.text).toContain(`Open tickets: ${signedUrl}`);
    expect(sent?.text).toContain(credential);
    expect(sent?.text).toContain("token=unsubscribe_part_tail");
    expect(sent?.html).toContain(
      'href="https://example.com/tickets?token=header_part_middle_tail"',
    );
    expect(sent?.html).toContain(`>${credential}</code>`);
    expect(sent?.html).not.toContain("<em>part</em>");
  });
});
