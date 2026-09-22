import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlinePracticeTrackPlayer } from "./InlinePracticeTrackPlayer";

describe("InlinePracticeTrackPlayer", () => {
  it("renders with default Play label when showLabelInButton is omitted/false", () => {
    const html = renderToString(
      <InlinePracticeTrackPlayer fileId="file-123" label="Tutti" pieceTitle="Carol of the Bells" />,
    );

    expect(html).toContain("<!-- -->Play</button>");
    expect(html).not.toContain("<!-- -->Play Tutti</button>");
    expect(html).toContain('<audio aria-label="Tutti learning track for Carol of the Bells"');
    expect(html).toContain('src="/api/organization/files/file-123"');
    expect(html).toContain('aria-label="Play Tutti recording for Carol of the Bells"');
    expect(html).toContain('title="Play Tutti"');
    expect(html).toContain("button--secondary");
    expect(html).toContain("button--small");
    expect(html).toContain('<track kind="captions"');
  });

  it("renders with track-specific Play label when showLabelInButton is true", () => {
    const html = renderToString(
      <InlinePracticeTrackPlayer
        fileId="file-soprano-456"
        label="Soprano"
        pieceTitle="Hallelujah Chorus"
        showLabelInButton
      />,
    );

    expect(html).toContain("Play Soprano");
    expect(html).toContain('<audio aria-label="Soprano learning track for Hallelujah Chorus"');
    expect(html).toContain('src="/api/organization/files/file-soprano-456"');
    expect(html).toContain('aria-label="Play Soprano recording for Hallelujah Chorus"');
    expect(html).toContain('title="Play Soprano"');
  });

  it("renders custom classes when provided", () => {
    const html = renderToString(
      <InlinePracticeTrackPlayer
        buttonClassName="custom-button-class"
        className="custom-player-class"
        fileId="file-789"
        label="Everyone"
        pieceTitle="Silent Night"
      />,
    );

    expect(html).toContain("custom-player-class");
    expect(html).toContain("custom-button-class");
  });
});
