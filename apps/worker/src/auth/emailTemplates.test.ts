import { describe, expect, it } from "vitest";

import { buildOneTimeCodeEmail } from "./emailTemplates";

describe("one-time code email template", () => {
  it("renders a prominent sign-in code with a plain-text fallback", () => {
    const content = buildOneTimeCodeEmail("123456", "sign-in");

    expect(content.subject).toBe("Your Choir Management sign-in code");
    expect(content.text).toContain("Use 123456 to sign in.");
    expect(content.html).toContain("Your sign-in code");
    expect(content.html).toContain(">123456</div>");
    expect(content.html).toContain("This code expires in 10 minutes.");
  });

  it("escapes the code before inserting it into HTML", () => {
    const content = buildOneTimeCodeEmail("<123456>", "verify-email");

    expect(content.html).toContain("&lt;123456&gt;");
    expect(content.html).not.toContain(">&lt;123456></div>");
  });
});
