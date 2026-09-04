import { describe, expect, it } from "vitest";

import { createTokenTrackSource } from "./source";

describe("token track source", () => {
  it("builds encoded media and artwork URLs for the live token", () => {
    const source = createTokenTrackSource("token-123");
    expect(source.kind).toBe("token");
    expect(source.mediaUrl("file one")).toBe("/api/public/player/media/file%20one?token=token-123");
    expect(source.artworkUrl("artwork")).toBe("/api/public/player/media/artwork?token=token-123");
  });
});
