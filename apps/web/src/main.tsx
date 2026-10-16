import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { importWithRetry, installChunkErrorHandling } from "./offline/chunkRecovery";
import { registerServiceWorker } from "./offline/registerServiceWorker";

installChunkErrorHandling();

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Application root is missing");
}

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";

if (pathname === "/player") {
  const { PlayerApp } = await importWithRetry(() => import("./public/PlayerApp"));
  createRoot(root).render(
    <StrictMode>
      <PlayerApp />
    </StrictMode>,
  );
} else {
  const { App } = await importWithRetry(() => import("./App"));
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

registerServiceWorker();
