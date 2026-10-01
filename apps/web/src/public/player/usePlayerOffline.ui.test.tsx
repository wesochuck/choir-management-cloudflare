import { it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useOfflineAudioUrl } from "./usePlayerOffline";
it("track switch must not return the previous file URL", async () => {
  const ids = new Set<string>();
  let resolveNext: ((value: null) => void) | undefined;
  const release = vi.fn();
  const acquire = vi.fn(async (file: string) => {
    if (file === "A") return { fileId: "A", scope: "test", url: "blob:A", release };
    return new Promise<null>((resolve) => {
      resolveNext = resolve;
    });
  });
  const fallback = vi.fn(() => Promise.resolve(null));
  const { result, rerender } = renderHook(
    ({ file }) => useOfflineAudioUrl(fallback, file, ids, acquire),
    { initialProps: { file: "A" } },
  );
  await waitFor(() => {
    expect(result.current).toBe("blob:A");
  });
  rerender({ file: "B" });
  expect(release).toHaveBeenCalledOnce();
  expect(result.current).toBeNull();
  await act(async () => {
    resolveNext?.(null);
    await Promise.resolve();
  });
});
it("caching an unrelated file must not replace the playing track lease", async () => {
  const release = vi.fn();
  let acquisitions = 0;
  const acquire = vi.fn((file: string) =>
    Promise.resolve({
      fileId: file,
      scope: "test",
      url: `blob:A-${String(++acquisitions)}`,
      release,
    }),
  );
  const fallback = vi.fn(() => Promise.resolve(null));
  const { result, rerender } = renderHook(
    ({ ids }) => useOfflineAudioUrl(fallback, "A", ids, acquire),
    { initialProps: { ids: new Set(["A"]) } },
  );
  await waitFor(() => {
    expect(result.current).toBe("blob:A-1");
  });
  rerender({ ids: new Set(["A", "B"]) });
  await act(() => Promise.resolve());
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(release).not.toHaveBeenCalled();
});

it("retries when the current file becomes cached after an initial miss", async () => {
  const release = vi.fn();
  const acquire = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ fileId: "A", scope: "test", url: "blob:A", release });
  const fallback = vi.fn(() => Promise.resolve(null));
  const { result, rerender, unmount } = renderHook(
    ({ ids }) => useOfflineAudioUrl(fallback, "A", ids, acquire),
    { initialProps: { ids: new Set<string>() } },
  );
  await act(() => Promise.resolve());
  expect(result.current).toBeNull();
  rerender({ ids: new Set(["A"]) });
  await waitFor(() => {
    expect(result.current).toBe("blob:A");
  });
  unmount();
  expect(release).toHaveBeenCalledOnce();
});

it("releases a delayed lease after unmount", async () => {
  const release = vi.fn();
  let resolveLease:
    | ((lease: { fileId: string; scope: string; url: string; release: () => void }) => void)
    | undefined;
  const acquire = vi.fn(
    () =>
      new Promise<{ fileId: string; scope: string; url: string; release: () => void }>(
        (resolve) => {
          resolveLease = resolve;
        },
      ),
  );
  const fallback = vi.fn(() => Promise.resolve(null));
  const { unmount } = renderHook(() => useOfflineAudioUrl(fallback, "A", new Set(["A"]), acquire));
  unmount();
  await act(async () => {
    resolveLease?.({ fileId: "A", scope: "test", url: "blob:A", release });
    await Promise.resolve();
  });
  expect(release).toHaveBeenCalledOnce();
});
