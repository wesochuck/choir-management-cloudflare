import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

import { attemptChunkRecoveryReload, importWithRetry, isChunkLoadError } from "./chunkRecovery";

function createMemoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const store = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
  };
}

describe("chunkRecovery", () => {
  it("recognizes browser dynamic import and Vite preload failures as chunk load errors", () => {
    expect(
      isChunkLoadError(
        new TypeError(
          "Failed to fetch dynamically imported module: https://lcc.musicsite.org/assets/controller-lCDszwm7.js",
        ),
      ),
    ).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/style-123.css"))).toBe(
      true,
    );

    const namedError = new Error("Loading chunk 4 failed");
    namedError.name = "ChunkLoadError";
    expect(isChunkLoadError(namedError)).toBe(true);

    expect(isChunkLoadError(new Error("Regular application error"))).toBe(false);
    expect(isChunkLoadError("not an Error instance")).toBe(false);
  });

  it("reloads at most once within the cooldown window per pathname and skips reload when offline", () => {
    const storage = createMemoryStorage();
    const reload = vi.fn();

    expect(
      attemptChunkRecoveryReload({
        now: 100_000,
        online: false,
        pathname: "/admin/library",
        reload,
        storage,
      }),
    ).toBe(false);
    expect(reload).not.toHaveBeenCalled();

    expect(
      attemptChunkRecoveryReload({
        now: 100_000,
        online: true,
        pathname: "/admin/library",
        reload,
        storage,
      }),
    ).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    // Second failure 2 seconds later on the same pathname must not loop
    expect(
      attemptChunkRecoveryReload({
        now: 102_000,
        online: true,
        pathname: "/admin/library",
        reload,
        storage,
      }),
    ).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    // After the 15s cooldown window, a subsequent deployment can reload again
    expect(
      attemptChunkRecoveryReload({
        now: 120_000,
        online: true,
        pathname: "/admin/library",
        reload,
        storage,
      }),
    ).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("suspends the caller while reloading on a chunk load failure and rethrows if reload is suppressed", async () => {
    const storage = createMemoryStorage();
    const reload = vi.fn();
    const chunkError = new TypeError(
      "Failed to fetch dynamically imported module: https://lcc.musicsite.org/assets/controller-lCDszwm7.js",
    );

    let resolvedOrRejected = false;
    void importWithRetry(() => Promise.reject(chunkError), {
      now: 200_000,
      online: true,
      pathname: "/admin/library",
      reload,
      storage,
    }).then(
      () => {
        resolvedOrRejected = true;
      },
      () => {
        resolvedOrRejected = true;
      },
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(resolvedOrRejected).toBe(false);

    // Within the cooldown window, the error should be rethrown instead of looping
    await expect(
      importWithRetry(() => Promise.reject(chunkError), {
        now: 201_000,
        online: true,
        pathname: "/admin/library",
        reload,
        storage,
      }),
    ).rejects.toThrow("Failed to fetch dynamically imported module");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("prevents Service Worker from caching HTML SPA fallbacks under static asset URLs", async () => {
    const swPath = resolve(import.meta.dirname, "../../public/sw.js");
    const swSource = readFileSync(swPath, "utf8");

    const cacheEntries = new Map<string, Response>();
    const mockCache = {
      match: vi.fn((key: Request | string) => {
        const urlKey = typeof key === "string" ? key : new URL(key.url).pathname;
        return Promise.resolve(cacheEntries.get(urlKey));
      }),
      put: vi.fn((key: Request | string, response: Response) => {
        const urlKey = typeof key === "string" ? key : new URL(key.url).pathname;
        cacheEntries.set(urlKey, response);
        return Promise.resolve();
      }),
    };

    const listeners = new Map<string, (event: unknown) => void>();
    const fetchMock = vi.fn((input: Request | string) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("missing-chunk")) {
        // Simulate Cloudflare SPA fallback returning 200 OK text/html for a missing old JS chunk
        return Promise.resolve(
          new Response("<!doctype html><html></html>", {
            headers: { "Content-Type": "text/html; charset=utf-8" },
            status: 200,
          }),
        );
      }
      return Promise.resolve(
        new Response("export default 42;", {
          headers: { "Content-Type": "application/javascript" },
          status: 200,
        }),
      );
    });

    const sandbox = {
      Request,
      Response,
      URL,
      caches: {
        delete: vi.fn(() => Promise.resolve(true)),
        keys: vi.fn(() => Promise.resolve([])),
        open: vi.fn(() => Promise.resolve(mockCache)),
      },
      console,
      fetch: fetchMock,
      self: {
        addEventListener: (type: string, handler: (event: unknown) => void) => {
          listeners.set(type, handler);
        },
        clients: { claim: vi.fn(() => Promise.resolve()) },
        location: { origin: "https://lcc.musicsite.org" },
        skipWaiting: vi.fn(() => Promise.resolve()),
      },
    };

    vm.runInNewContext(swSource, sandbox);

    const fetchListener = listeners.get("fetch");
    expect(fetchListener).toBeDefined();

    // 1. Missing JS chunk returning text/html from SPA fallback must return 404 and not be cached
    let respondedPromise: Promise<Response> | undefined;
    fetchListener?.({
      request: new Request("https://lcc.musicsite.org/assets/missing-chunk.js"),
      respondWith: (promise: Promise<Response>) => {
        respondedPromise = promise;
      },
    });
    const missingResponse = await respondedPromise;
    expect(missingResponse?.status).toBe(404);
    expect(cacheEntries.has("/assets/missing-chunk.js")).toBe(false);

    // 2. If a cache entry was previously poisoned with text/html, ignore it and fetch valid JS from network
    cacheEntries.set(
      "/assets/valid-chunk.js",
      new Response("<!doctype html><html></html>", {
        headers: { "Content-Type": "text/html" },
        status: 200,
      }),
    );

    fetchListener?.({
      request: new Request("https://lcc.musicsite.org/assets/valid-chunk.js"),
      respondWith: (promise: Promise<Response>) => {
        respondedPromise = promise;
      },
    });
    const validResponse = await respondedPromise;
    expect(validResponse?.status).toBe(200);
    expect(validResponse?.headers.get("content-type")).toBe("application/javascript");
    expect(await validResponse?.text()).toBe("export default 42;");
  });

  it("enforces split Cache-Control rules in _headers (no-cache HTML shell + immutable hashed assets)", () => {
    const headersPath = resolve(import.meta.dirname, "../../public/_headers");
    const headersSource = readFileSync(headersPath, "utf8");

    expect(headersSource).toMatch(/\/\*\s+[\s\S]*?Cache-Control:\s*no-cache/);
    expect(headersSource).toMatch(
      /\/assets\/\*\s+Cache-Control:\s*public,\s*max-age=31536000,\s*immutable/,
    );
    expect(headersSource).toMatch(/\/sw\.js\s+Cache-Control:\s*no-cache/);
  });

  it("requires all lazy-loaded components in apps/web/src to use lazyWithRetry instead of raw React.lazy", () => {
    const webSrcRoot = resolve(import.meta.dirname, "..");

    function collectSourceFiles(dir: string): string[] {
      const files: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...collectSourceFiles(fullPath));
        } else if (
          (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
          !entry.name.endsWith(".test.ts") &&
          !entry.name.endsWith(".test.tsx")
        ) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const violations: string[] = [];
    for (const filePath of collectSourceFiles(webSrcRoot)) {
      const relPath = relative(webSrcRoot, filePath).replaceAll("\\", "/");
      if (relPath === "offline/chunkRecovery.ts") {
        continue;
      }
      const source = readFileSync(filePath, "utf8");
      const importsRawReactLazy =
        /import\s*\{[^}]*\blazy\b(?!\s+as\b)[^}]*\}\s*from\s*["']react["']/.test(source) ||
        /\bReact\.lazy\s*\(/.test(source);
      if (importsRawReactLazy) {
        violations.push(relPath);
      }
    }

    expect(violations).toEqual([]);

    const mainSource = readFileSync(join(webSrcRoot, "main.tsx"), "utf8");
    expect(mainSource).toContain("installChunkErrorHandling()");
    expect(mainSource).toContain("importWithRetry(");
  });
});
