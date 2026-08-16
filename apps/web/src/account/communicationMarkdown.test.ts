import { describe, expect, it } from "vitest";
import {
  communicationPreviewValues,
  renderCommunicationMarkdownPreview,
} from "./communicationMarkdown";

describe("renderCommunicationMarkdownPreview", () => {
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
    const source = "Hi {singerName}, {eventTitle}. {{RSVP_LINKS}}";
    const rendered = renderCommunicationMarkdownPreview(source, communicationPreviewValues(null));

    expect(rendered).toContain("Alex Morgan");
    expect(rendered).toContain("Example Performance");
    expect(rendered).toContain("View RSVP details");
    expect(rendered).not.toContain("{singerName}");
    expect(source).toBe("Hi {singerName}, {eventTitle}. {{RSVP_LINKS}}");
  });

  it("populates scalar placeholders written with double braces", () => {
    const rendered = renderCommunicationMarkdownPreview(
      "Hi {{singerName}}, {{eventTitle}}.",
      communicationPreviewValues(null),
    );

    expect(rendered).toContain("Alex Morgan");
    expect(rendered).toContain("Example Performance");
    expect(rendered).not.toContain("{{singerName}}");
    expect(rendered).not.toContain("{{eventTitle}}");
  });
});
