import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { registerServiceWorker } from "./offline/registerServiceWorker";

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Application root is missing");
}

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";

if (pathname === "/player") {
  const { PlayerApp } = await import("./public/PlayerApp");
  createRoot(root).render(
    <StrictMode>
      <PlayerApp />
    </StrictMode>,
  );
} else {
  const { App } = await import("./App");
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

registerServiceWorker();
