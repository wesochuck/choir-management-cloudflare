import { describe, expect, it, vi } from "vitest";

import { handleInboundEmail } from "./bounceHandler";

const sampleDsn = `From: mailer-daemon@cf-bounce.notify.cloudflare.com
To: bounce-catcher@musicsite.org
Subject: Mail delivery failed: returning message to sender
Date: Wed, 05 Aug 2026 18:04:35 +0000
MIME-Version: 1.0
Content-Type: multipart/report; report-type=delivery-status

--boundary
Content-Type: text/plain

This is the mail system at host bg-h.cloudflare-smtp.com.

<no-such-recipient@example.test>: host example.test[192.0.2.1] said:
550 5.1.1 User unknown (in reply to RCPT TO command)

--boundary
Content-Type: message/delivery-status

Final-Recipient: rfc822; no-such-recipient@example.test
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 User unknown
--boundary--
`;

function fakeMessage(raw: string): ForwardableEmailMessage {
  return {
    from: "mailer-daemon@cf-bounce.notify.cloudflare.com",
    headers: new Headers(),
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(raw));
        controller.close();
      },
    }),
    to: "bounce-catcher@musicsite.org",
    // @ts-expect-error -- test double only needs the fields above
    cc: null,
  };
}

const ORIGINAL_RECIPIENT = "no-such-recipient@example.test";

type BounceHandlerEnv = Parameters<typeof handleInboundEmail>[1];

function fakeEnv(rows: readonly { organizationId: string; profileId: string }[]) {
  const boundEmails: string[] = [];
  const all = vi.fn().mockImplementation(() => ({
    // Rows only match when the handler looked up the DSN's original
    // recipient — guards against regressions in recipient extraction.
    results: boundEmails.at(-1) === ORIGINAL_RECIPIENT ? rows : [],
  }));
  const bind = vi.fn((value: unknown) => {
    boundEmails.push(String(value));
    return { all };
  });
  const prepare = vi.fn(() => ({ all, bind }));
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ bounced: true })));
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test double: D1Database is brand-typed.
    CONTROL_DB: { prepare } as unknown as BounceHandlerEnv["CONTROL_DB"],
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test double: DurableObjectNamespace is brand-typed.
    ORGANIZATION_STORE: {
      get: () => ({ fetch: fetchMock }),
      idFromName: () => "org-stub",
    } as unknown as BounceHandlerEnv["ORGANIZATION_STORE"],
    boundEmails,
    fetchMock,
  };
}

describe("bounce handler", () => {
  it("records a hard bounce for the DSN recipient across matching organizations", async () => {
    const env = fakeEnv([
      {
        organizationId: "11111111-1111-4111-8111-111111111111",
        profileId: "22222222-2222-4222-8222-222222222222",
      },
    ]);
    await handleInboundEmail(fakeMessage(sampleDsn), env);

    // The lookup must target the DSN's original recipient, not the bounce
    // message's own To: header.
    expect(env.boundEmails).toEqual([ORIGINAL_RECIPIENT]);
    expect(env.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = env.fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("/internal/profiles/bounce");
    const body: Record<string, unknown> = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      hard: true,
      organizationId: "11111111-1111-4111-8111-111111111111",
      profileId: "22222222-2222-4222-8222-222222222222",
    });
    expect(String(body.reason)).toContain("550");
  });

  it("drops messages that are not bounce notifications", async () => {
    const env = fakeEnv([
      {
        organizationId: "11111111-1111-4111-8111-111111111111",
        profileId: "22222222-2222-4222-8222-222222222222",
      },
    ]);
    const plain = sampleDsn
      .replace("Subject: Mail delivery failed: returning message to sender", "Subject: Hello there")
      .replace("From: mailer-daemon@cf-bounce.notify.cloudflare.com", "From: friend@example.test");
    await handleInboundEmail(fakeMessage(plain), env);
    expect(env.fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch the DO when the recipient is not a known profile email", async () => {
    const env = fakeEnv([]);
    await handleInboundEmail(fakeMessage(sampleDsn), env);
    expect(env.fetchMock).not.toHaveBeenCalled();
  });

  it("extracts the recipient from DSNs with CRLF line endings", async () => {
    const env = fakeEnv([
      {
        organizationId: "11111111-1111-4111-8111-111111111111",
        profileId: "22222222-2222-4222-8222-222222222222",
      },
    ]);
    const crlf = sampleDsn.replace(/\n/g, "\r\n");
    await handleInboundEmail(fakeMessage(crlf), env);
    expect(env.boundEmails).toEqual([ORIGINAL_RECIPIENT]);
    expect(env.fetchMock).toHaveBeenCalledTimes(1);
  });
});
