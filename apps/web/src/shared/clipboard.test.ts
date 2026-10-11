import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copyPlainTextUrl } from "./clipboard";

describe("copyPlainTextUrl", () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
      writable: true,
    });
  });

  it("writes exactly the URL as plain text", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
      writable: true,
    });

    const url = "https://example.com/player?token=abc&mode=set-list";
    await copyPlainTextUrl(url);

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(url);
  });

  it("propagates clipboard failures to the caller", async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
      writable: true,
    });

    await expect(copyPlainTextUrl("https://example.com/player?token=abc")).rejects.toThrow(
      "Clipboard denied",
    );
  });

  it("throws a clear error when the async clipboard is missing", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {},
      writable: true,
    });

    await expect(copyPlainTextUrl("https://example.com/player?token=abc")).rejects.toThrow(
      "Clipboard is unavailable.",
    );
  });
});
