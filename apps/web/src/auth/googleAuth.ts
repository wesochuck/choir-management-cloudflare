import { authClient } from "./authClient";

export interface SignInWithGoogleOptions {
  readonly currentUrl?: string | undefined;
  readonly returnTo?: string | null | undefined;
}

export interface SignInWithGoogleResult {
  readonly error?: string | undefined;
  readonly success: boolean;
}

function isSafeRelativeTarget(url: string): boolean {
  if (!url.startsWith("/") || url.startsWith("//") || url.includes("\\")) {
    return false;
  }
  if (url.toLowerCase().includes("%5c")) {
    return false;
  }
  // Reject control characters (0x00 - 0x1f and 0x7f)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(url)) {
    return false;
  }
  return true;
}

export function buildOAuthDestinations(
  currentHref: string,
  explicitReturnTo?: string | null,
): {
  readonly callbackURL: string;
  readonly errorCallbackURL: string;
} {
  const current = new URL(currentHref);
  let destination: string | null = null;

  if (explicitReturnTo && isSafeRelativeTarget(explicitReturnTo)) {
    destination = explicitReturnTo;
  } else {
    const rawReturnTo = current.searchParams.get("returnTo");
    if (rawReturnTo && isSafeRelativeTarget(rawReturnTo)) {
      destination = rawReturnTo;
    } else if (current.pathname !== "/login" && isSafeRelativeTarget(current.pathname)) {
      destination = `${current.pathname}${current.search}${current.hash}`;
    }
  }

  const callback = new URL("/login", current.origin);
  callback.searchParams.set("oauth", "complete");
  if (destination && destination !== "/dashboard") {
    callback.searchParams.set("returnTo", destination);
  }

  const errorCallback = new URL("/login", current.origin);
  if (destination && destination !== "/dashboard") {
    errorCallback.searchParams.set("returnTo", destination);
  }

  return {
    callbackURL: callback.toString(),
    errorCallbackURL: errorCallback.toString(),
  };
}

export function hasOAuthCompletionMarker(search: string | null | undefined): boolean {
  if (!search) return false;
  return new URLSearchParams(search).get("oauth") === "complete";
}

export interface OAuthCompletionState {
  readonly isOAuthComplete: boolean;
  readonly search: string;
}

export function readOAuthCompletionState(search: string | null | undefined): OAuthCompletionState {
  const query = search ?? "";
  return {
    isOAuthComplete: hasOAuthCompletionMarker(query),
    search: query,
  };
}

export function mapOAuthErrorMessage(errorCode: string | null | undefined): string | null {
  if (!errorCode) return null;
  const normalized = errorCode.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "signup_disabled" || normalized === "signup_disabled_for_user") {
    return "This Google account cannot sign in. Use the email address that was invited, or ask an Organization Owner or Administrator for access.";
  }
  if (normalized === "account_not_linked" || normalized === "email_not_verified") {
    return "Google sign-in is not available for this account yet. Sign in with an email code once to verify your invited email, then you can use Google.";
  }
  if (normalized === "access_denied" || normalized === "cancelled" || normalized === "canceled") {
    return "Google sign-in was canceled.";
  }
  return "Unable to complete Google sign-in. Please try again or use another sign-in method.";
}

export async function signInWithGoogle(
  options: SignInWithGoogleOptions = {},
): Promise<SignInWithGoogleResult> {
  try {
    const currentHref =
      options.currentUrl ??
      (typeof window !== "undefined" ? window.location.href : "https://localhost/login");
    const { callbackURL, errorCallbackURL } = buildOAuthDestinations(currentHref, options.returnTo);

    const res = await authClient.signIn.social({
      callbackURL,
      errorCallbackURL,
      provider: "google",
    });

    if (res.error) {
      const message =
        "message" in res.error && typeof res.error.message === "string"
          ? res.error.message
          : "Unable to start Google sign-in.";
      return { error: message, success: false };
    }

    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to start Google sign-in.";
    return { error: message, success: false };
  }
}
