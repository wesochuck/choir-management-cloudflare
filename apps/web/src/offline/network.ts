declare global {
  interface NetworkInformationTarget extends EventTarget {
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  }
  interface Navigator {
    readonly connection?: NetworkInformationTarget;
  }
}

/**
 * Subscribes to online, offline, and network connection change events.
 * Returns an unsubscribe cleanup function.
 */
export function subscribeNetworkStatus(onStatusChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  window.addEventListener("online", onStatusChange);
  window.addEventListener("offline", onStatusChange);

  const connection = typeof navigator !== "undefined" ? navigator.connection : undefined;
  connection?.addEventListener("change", onStatusChange);

  return () => {
    window.removeEventListener("online", onStatusChange);
    window.removeEventListener("offline", onStatusChange);
    connection?.removeEventListener("change", onStatusChange);
  };
}
