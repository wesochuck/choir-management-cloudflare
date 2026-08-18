import { describe, expect, it } from "vitest";

import {
  buildEmailChangeConfirmationEmail,
  buildEmailChangeNoticeEmail,
  buildOneTimeCodeEmail,
  buildOrganizationInvitationEmail,
  buildPasswordResetEmail,
} from "./emailTemplates";

function expectCompatibleEmail(html: string): void {
  expect(html).toContain("<!doctype html>");
  expect(html).toContain('role="presentation"');
  expect(html).toContain('width="600"');
  expect(html).toContain("<!--[if mso]>");
  expect(html).toContain("mso-hide:all");
  expect(html).toContain("@media only screen and (max-width: 620px)");
  expect(html).not.toMatch(/display:\s*(flex|grid)/);
  expect(html).not.toContain("<svg");
}

describe("one-time code email template", () => {
  it("renders a prominent sign-in code with a plain-text fallback", () => {
    const content = buildOneTimeCodeEmail("123456", "sign-in");

    expect(content.subject).toBe("Your Choir Management sign-in code");
    expect(content.text).toContain("Use 123456 to sign in.");
    expect(content.html).toContain("Your sign-in code");
    expect(content.html).toContain(">123456</p>");
    expect(content.html).toContain("This code expires in 10 minutes.");
    expectCompatibleEmail(content.html);
  });

  it("escapes the code before inserting it into HTML", () => {
    const content = buildOneTimeCodeEmail("<123456>", "verify-email");

    expect(content.html).toContain("&lt;123456&gt;");
    expect(content.html).not.toContain(">&lt;123456></div>");
  });

  it("renders every platform email with HTML and a useful plain-text fallback", () => {
    const templates = [
      buildPasswordResetEmail("https://example.test/reset#token=secret"),
      buildOrganizationInvitationEmail("https://example.test/invite?id=123", "Example Choir"),
      buildEmailChangeConfirmationEmail(
        "https://example.test/confirm?token=secret",
        "new@example.test",
      ),
      buildEmailChangeNoticeEmail("new@example.test", "requested"),
      buildEmailChangeNoticeEmail("new@example.test", "confirmed"),
    ];

    for (const template of templates) {
      expectCompatibleEmail(template.html);
      expect(template.text.length).toBeGreaterThan(80);
      expect(template.html).toContain("Choir Management");
    }
    expect(templates[0]?.html).toContain(">Reset password</a>");
    expect(templates[0]?.text).toContain("Reset password: https://example.test/reset#token=secret");
    expect(templates[1]?.html).toContain(">Review invitation</a>");
    expect(templates[1]?.text).toContain("This invitation expires in 8 days.");
    expect(templates[2]?.html).toContain(">Confirm email address</a>");
  });

  it("escapes platform-controlled headings and action URLs", () => {
    const invitation = buildOrganizationInvitationEmail(
      "https://example.test/invite?id=1&member=2",
      "<Example & Choir>",
    );

    expect(invitation.html).toContain("Join &lt;Example &amp; Choir&gt;");
    expect(invitation.html).toContain('href="https://example.test/invite?id=1&amp;member=2"');
    expect(invitation.html).not.toContain("<Example & Choir>");
  });
});
