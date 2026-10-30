import { describe, expect, it } from "vitest";
import { communicationPlaceholderDefinitions } from "@choir/domain";
import type { OrganizationBranding } from "@choir/contracts";
import {
  SAMPLE_COMMUNICATION_RECIPIENT_NAME,
  communicationPreviewValues,
  renderCommunicationMarkdownPreview,
} from "./communicationMarkdown";

describe("renderCommunicationMarkdownPreview", () => {
  const branding: OrganizationBranding = {
    organizationId: "test-choir",
    organizationName: "Sample Choir",
    logoFileId: "11111111-1111-4111-8111-111111111111",
    physicalAddress: null,
  };

  it("renders every registered placeholder and alias with a sample value", () => {
    const values = communicationPreviewValues(null, "UTC", branding);
    for (const definition of communicationPlaceholderDefinitions) {
      for (const tag of [definition.tag, ...(definition.aliases ?? [])]) {
        const rendered = renderCommunicationMarkdownPreview(tag, values, { branding });
        expect(rendered, tag).not.toContain(tag);
        expect(rendered, tag).not.toBe("<p></p>");
      }
    }
    expect(
      renderCommunicationMarkdownPreview(
        "{{POLL_LINK:11111111-1111-4111-8111-111111111111}}",
        values,
      ),
    ).toContain("Respond Here (No login required)");
  });

  it("renders Organization branding in both brace styles without changing the source", () => {
    const source =
      "{organizationLogo} {{organizationLogo}} {organizationName} {{organizationName}}";
    const rendered = renderCommunicationMarkdownPreview(
      source,
      communicationPreviewValues(null, "UTC", branding),
      { branding },
    );
    expect(rendered.match(/<img /g)).toHaveLength(2);
    expect(rendered).toContain(
      'src="/api/organization/files/11111111-1111-4111-8111-111111111111"',
    );
    expect(rendered).toContain('alt="Sample Choir"');
    expect(rendered).not.toContain("{organization");
    expect(source).toContain("{organizationLogo}");
  });

  it("uses the styled Organization name without a logo and plain text for SMS", () => {
    const noLogo = { ...branding, logoFileId: null };
    const values = communicationPreviewValues(null, "UTC", noLogo);
    const email = renderCommunicationMarkdownPreview("{organizationLogo}", values, {
      branding: noLogo,
    });
    expect(email).toContain("<span style=");
    expect(email).toContain("Sample Choir");
    const sms = renderCommunicationMarkdownPreview("{organizationLogo}", values, {
      branding,
      channel: "SMS",
    });
    expect(sms).toBe("<p>Sample Choir</p>");
  });

  it("escapes Organization names and never renders authored HTML as markup", () => {
    const unsafeBranding = { ...branding, organizationName: '<img src=x onerror="alert(1)">' };
    const rendered = renderCommunicationMarkdownPreview(
      "{organizationLogo} {organizationName} <script>alert(1)</script>",
      communicationPreviewValues(null, "UTC", unsafeBranding),
      { branding: unsafeBranding },
    );
    expect(rendered).toContain('alt="&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"');
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain("<img src=x");
  });

  it("escapes attributes and markup in link previews", () => {
    const rendered = renderCommunicationMarkdownPreview(
      '[safe](https://example.test/?q=" onmouseover="alert(1)) <img src=x>',
    );

    expect(rendered).toContain(
      '<a href="https://example.test/?q=&quot; onmouseover=&quot;alert(1" target="_blank" rel="noopener noreferrer">safe</a>',
    );
    expect(rendered).toContain("&lt;img src=x&gt;");
    expect(rendered).not.toContain('onmouseover="alert(1)"');
  });

  it("does not turn non-HTTP links into anchors", () => {
    expect(renderCommunicationMarkdownPreview("[unsafe](javascript:alert(1))")).not.toContain(
      "<a ",
    );
  });

  it("populates preview placeholders without changing the source", () => {
    const source = "Hi {recipientName}, {eventTitle}. {{RSVP_LINKS}}";
    const rendered = renderCommunicationMarkdownPreview(
      source,
      communicationPreviewValues(null, "UTC"),
    );

    expect(rendered).toContain(SAMPLE_COMMUNICATION_RECIPIENT_NAME);
    expect(rendered).toContain("Example Performance");
    expect(rendered).toContain("View RSVP details");
    expect(rendered).not.toContain("{recipientName}");
    expect(source).toBe("Hi {recipientName}, {eventTitle}. {{RSVP_LINKS}}");
  });

  it("previews canonical recipient placeholders written with double braces", () => {
    const rendered = renderCommunicationMarkdownPreview(
      "Hi {{recipientName}}, {{eventTitle}}.",
      communicationPreviewValues(null, "UTC"),
    );

    expect(rendered).toContain(SAMPLE_COMMUNICATION_RECIPIENT_NAME);
    expect(rendered).toContain("Example Performance");
    expect(rendered).not.toContain("{{recipientName}}");
    expect(rendered).not.toContain("{{eventTitle}}");
  });

  it("continues to preview legacy recipient aliases in both brace styles", () => {
    const rendered = renderCommunicationMarkdownPreview(
      "Hi {singerName}, {{singerName}}, {buyerName}, and {{buyerName}}.",
      communicationPreviewValues(null, "UTC"),
    );

    expect(rendered.match(new RegExp(SAMPLE_COMMUNICATION_RECIPIENT_NAME, "g"))).toHaveLength(4);
    expect(rendered).not.toMatch(/\{\{?(?:singerName|buyerName)\}\}?/);
  });

  it("populates refund placeholders and the order details link", () => {
    const rendered = renderCommunicationMarkdownPreview(
      "Refunded {refundAmount} on {refundDate}. {{TICKET_ORDER_LINK}}",
      communicationPreviewValues(null, "UTC"),
    );

    expect(rendered).toContain("$25.00");
    expect(rendered).toContain("August 20, 2026 at 7:00 PM");
    expect(rendered).toContain("View order details");
    expect(rendered).not.toContain("{{TICKET_ORDER_LINK}}");
  });
});
