const SESSION_HINT_KEY = "choir.session_hint";

let inMemorySessionHint: boolean | null = null;

export function hasSessionHint(): boolean {
  if (inMemorySessionHint !== null) {
    return inMemorySessionHint;
  }
  try {
    if (typeof window === "undefined") return false;
    if (window.localStorage.getItem(SESSION_HINT_KEY) === "1") return true;
    if (window.sessionStorage.getItem(SESSION_HINT_KEY) === "1") return true;
    if (
      /(?:^|;\s*)(?:__Secure-)?choir-management(?:-staging)?\.session_token=/.test(document.cookie)
    ) {
      return true;
    }
  } catch {
    // Storage access might be restricted in private browsing
  }
  return false;
}

export function setSessionHint(active: boolean): void {
  inMemorySessionHint = active;
  try {
    if (typeof window === "undefined") return;
    if (active) {
      window.localStorage.setItem(SESSION_HINT_KEY, "1");
      window.sessionStorage.setItem(SESSION_HINT_KEY, "1");
    } else {
      window.localStorage.removeItem(SESSION_HINT_KEY);
      window.sessionStorage.removeItem(SESSION_HINT_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}
