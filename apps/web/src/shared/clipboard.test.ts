import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copyRichLink, escapeHtml } from "./clipboard";

describe("escapeHtml", () => {
  it("escapes special HTML characters", () => {
    expect(escapeHtml("Fall & Winter Concert <\"2026\"> 'Special'")).toBe(
      "Fall &amp; Winter Concert &lt;&quot;2026&quot;&gt; &#39;Special&#39;",
    );
  });
});

describe("copyRichLink", () => {
  const originalClipboard = navigator.clipboard;
  const originalClipboardItem = globalThis.ClipboardItem;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
      writable: true,
    });
    globalThis.ClipboardItem = originalClipboardItem;
  });

  it("copies rich text and plain text via ClipboardItem", async () => {
    const writtenItems: unknown[] = [];
    const writeMock = vi.fn().mockImplementation((items: unknown[]) => {
      writtenItems.push(...items);
      return Promise.resolve();
    });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);

    class MockClipboardItem {
      readonly items: Record<string, Blob>;
      constructor(items: Record<string, Blob>) {
        this.items = items;
      }
    }

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: writeMock,
        writeText: writeTextMock,
      },
      writable: true,
    });
    // @ts-expect-error Mocking ClipboardItem constructor for browser testing environment
    globalThis.ClipboardItem = MockClipboardItem;

    const label = "Practice Player – Fall & Winter Concert <2026>";
    const url = "https://example.com/player?token=abc&mode=set-list";

    await copyRichLink({ label, url });

    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).not.toHaveBeenCalled();

    const item = writtenItems[0];
    expect(item).toBeInstanceOf(MockClipboardItem);
    if (!(item instanceof MockClipboardItem)) {
      throw new Error("Expected item to be instance of MockClipboardItem");
    }

    const htmlBlob = item.items["text/html"];
    const plainBlob = item.items["text/plain"];

    expect(htmlBlob).toBeDefined();
    expect(plainBlob).toBeDefined();
    if (!htmlBlob || !plainBlob) {
      throw new Error("Blobs were not created");
    }

    const htmlText = await htmlBlob.text();
    const plainText = await plainBlob.text();

    expect(htmlText).toBe(
      '<a href="https://example.com/player?token=abc&amp;mode=set-list">Practice Player – Fall &amp; Winter Concert &lt;2026&gt;</a>',
    );
    // Anchor text does not expose signed URL
    expect(htmlText.includes(">https://")).toBe(false);
    expect(plainText).toBe(
      "Practice Player – Fall & Winter Concert <2026>: https://example.com/player?token=abc&mode=set-list",
    );
  });

  it("falls back to writeText when write() fails", async () => {
    const writeMock = vi.fn().mockRejectedValue(new Error("Rich clipboard unsupported"));
    const writeTextMock = vi.fn().mockResolvedValue(undefined);

    class MockClipboardItem {
      readonly items: Record<string, Blob>;
      constructor(items: Record<string, Blob>) {
        this.items = items;
      }
    }

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: writeMock,
        writeText: writeTextMock,
      },
      writable: true,
    });
    // @ts-expect-error Mocking ClipboardItem constructor for browser testing environment
    globalThis.ClipboardItem = MockClipboardItem;

    const label = "Practice Player – Fall Concert";
    const url = "https://example.com/player?token=123";

    await copyRichLink({ label, url });

    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(
      "Practice Player – Fall Concert: https://example.com/player?token=123",
    );
  });

  it("falls back to writeText when ClipboardItem is undefined", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
      writable: true,
    });
    // @ts-expect-error Deleting ClipboardItem to simulate unsupported browser environment
    delete globalThis.ClipboardItem;

    const label = "Practice Player – Fall Concert";
    const url = "https://example.com/player?token=123";

    await copyRichLink({ label, url });

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(
      "Practice Player – Fall Concert: https://example.com/player?token=123",
    );
  });
});
