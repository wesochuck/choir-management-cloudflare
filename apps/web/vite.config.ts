import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function serviceWorkerPrecachePlugin(): Plugin {
  let resolvedOutDir = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "dist");

  return {
    name: "service-worker-precache",
    apply: "build",
    configResolved(config) {
      resolvedOutDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const assetsDir = path.join(resolvedOutDir, "assets");
      const swPath = path.join(resolvedOutDir, "sw.js");

      const assetFiles = await fs.readdir(assetsDir);
      const precacheAssets = [
        "/",
        "/index.html",
        ...assetFiles
          .filter((file) => !file.endsWith(".map") && file !== "sw.js")
          .map((file) => `/assets/${file}`),
      ];

      // Top-level public files that might be in outDir
      try {
        const rootFiles = await fs.readdir(resolvedOutDir);
        for (const file of rootFiles) {
          if (
            file !== "sw.js" &&
            file !== "index.html" &&
            !file.endsWith(".map") &&
            !file.startsWith(".") &&
            (file.endsWith(".ico") || file.endsWith(".svg") || file.endsWith(".png"))
          ) {
            precacheAssets.push(`/${file}`);
          }
        }
      } catch {
        // Assets directory is primary
      }

      // Generate a cache name hash based on the sorted asset paths
      const hashInput = precacheAssets.slice().sort().join(";");
      const buildHash = crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 10);
      const cacheName = `choir-shell-${buildHash}`;

      let swContent = await fs.readFile(swPath, "utf-8");

      if (!swContent.includes('/* __SHELL_CACHE_NAME__ */ "choir-shell-v1"')) {
        throw new Error(
          "Failed to find SHELL_CACHE_NAME placeholder in apps/web/public/sw.js. Ensure '/* __SHELL_CACHE_NAME__ */ \"choir-shell-v1\"' is present.",
        );
      }
      if (!swContent.includes("/* __PRECACHE_MANIFEST__ */ []")) {
        throw new Error(
          "Failed to find PRECACHE_MANIFEST placeholder in apps/web/public/sw.js. Ensure '/* __PRECACHE_MANIFEST__ */ []' is present.",
        );
      }

      swContent = swContent
        .replace('/* __SHELL_CACHE_NAME__ */ "choir-shell-v1"', JSON.stringify(cacheName))
        .replace("/* __PRECACHE_MANIFEST__ */ []", JSON.stringify(precacheAssets));

      await fs.writeFile(swPath, swContent, "utf-8");
    },
  };
}

export default defineConfig({
  build: {
    sourcemap: true,
    target: "es2022",
  },
  plugins: [tailwindcss(), react(), serviceWorkerPrecachePlugin()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
