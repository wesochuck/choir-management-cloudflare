import { afterEach, describe, expect, it, vi } from "vitest";

import { extractAudioDurationFromUrl } from "./audioDuration";

class MetadataAudio extends EventTarget {
  duration = 245.4;
  preload = "";
  src = "";

  load(): void {
    queueMicrotask(() => {
      this.dispatchEvent(new Event("loadedmetadata"));
    });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("audio duration metadata extraction", () => {
  it("rounds the browser metadata duration and cleans up the media source", async () => {
    vi.stubGlobal("Audio", MetadataAudio);
    const duration = await extractAudioDurationFromUrl("blob:practice-track");

    expect(duration).toBe(245);
  });
});
