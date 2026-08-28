import { describe, expect, it } from "vitest";

import {
  organizationRequest,
  readEmailOneTimeCode,
  signInWithOtp,
  type TestWorkerFetcher,
} from "./workerd";

describe("Workerd integration harness", () => {
  it("builds same-origin requests with origin and optional cookie headers", () => {
    const request = organizationRequest("alpha.localhost", "/api/health", "session=abc", {
      method: "POST",
    });
    expect(request.url).toBe("http://alpha.localhost/api/health");
    expect(request.method).toBe("POST");
    expect(request.headers.get("origin")).toBe("http://alpha.localhost");
    expect(request.headers.get("cookie")).toBe("session=abc");
    const anonymous = organizationRequest("alpha.localhost", "/api/health");
    expect(anonymous.headers.get("cookie")).toBeNull();
  });

  it("extracts the sign-in one-time code only for the matching recipient", () => {
    const emails = [
      {
        kind: "email-one-time-code",
        recipient: "other@example.test",
        text: "Use 111111 to sign in",
      },
      {
        kind: "email-one-time-code",
        recipient: "user@example.test",
        text: "Use 222222 to sign in",
      },
    ];
    expect(readEmailOneTimeCode(emails, "user@example.test")).toBe("222222");
    expect(readEmailOneTimeCode(emails, "missing@example.test")).toBeUndefined();
  });

  it("sends the OTP challenge and returns the session cookie", async () => {
    const requests: Request[] = [];
    const fetcher: TestWorkerFetcher = {
      fetch: (request) => {
        requests.push(request);
        if (request.url.includes("/send-verification-otp")) {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        return Promise.resolve(
          new Response(null, {
            headers: { "set-cookie": "choir-management.session_token=token-value; Path=/" },
            status: 200,
          }),
        );
      },
    };
    const cookie = await signInWithOtp(
      fetcher,
      "alpha.localhost",
      "user@example.test",
      () => "123456",
    );
    expect(cookie).toBe("choir-management.session_token=token-value");
    expect(requests).toHaveLength(2);
    const [send, confirm] = requests;
    expect(send?.url).toBe("http://alpha.localhost/api/auth/email-otp/send-verification-otp");
    expect(send?.headers.get("content-type")).toBe("application/json");
    expect(await send?.json()).toEqual({ email: "user@example.test", type: "sign-in" });
    expect(confirm?.url).toBe("http://alpha.localhost/api/auth/sign-in/email-otp");
    expect(await confirm?.json()).toEqual({ email: "user@example.test", otp: "123456" });
  });

  it("fails clearly when no one-time code was captured", async () => {
    const fetcher: TestWorkerFetcher = {
      fetch: () => Promise.resolve(new Response(null, { status: 200 })),
    };
    await expect(
      signInWithOtp(fetcher, "alpha.localhost", "user@example.test", () => undefined),
    ).rejects.toThrow("No one-time code was captured for user@example.test.");
  });
});
