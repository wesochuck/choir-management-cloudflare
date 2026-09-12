import type { Page, Route } from "@playwright/test";
import type { AuthSession } from "@choir/contracts";
import {
  buildAccountSecurityResponse,
  buildHealthResponse,
  buildMemberEmailChangeResponse,
  buildSessionUser,
  createMutableState,
  defaultFixtureRequestId,
  type MutableState,
  type SessionUserOverrides,
} from "./builders";

export type { SessionUserOverrides };

export async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ body: JSON.stringify(body), contentType: "application/json", status });
}

export interface SessionShellOptions {
  /** Start signed in (default true). OTP/password handlers flip this to true on success. */
  readonly initiallySignedIn?: boolean | undefined;
  readonly user?: SessionUserOverrides | undefined;
}

export interface SessionShell {
  readonly accountRequestId: string;
  readonly accountSessions: MutableState<readonly AuthSession[]>;
  readonly userPasskeys: MutableState<
    {
      id: string;
      name?: string | null;
      createdAt: string | Date | number;
    }[]
  >;
  isSignedIn(): boolean;
  setSignedIn(value: boolean): void;
  readonly session: AuthSession;
  readonly user: ReturnType<typeof buildSessionUser>["user"];
}

/**
 * Identity/session/account-security surface: health, current session, OTP + password sign-in,
 * non-enumerating recovery, sign-out, and the /account/* security/session endpoints.
 * Organization membership (/account/organizations, auth-status, modules, setup) lives in
 * organization.ts; workspace collections live in apiMocks.ts.
 */
export async function installSessionShell(
  page: Page,
  options: SessionShellOptions = {},
): Promise<SessionShell> {
  const { session, user } = buildSessionUser(options.user);
  const accountRequestId = "44444444-4444-4444-8444-444444444444";
  let signedIn = options.initiallySignedIn ?? true;
  let passwordSet = false;
  const accountSessions = createMutableState<readonly AuthSession[]>([session]);
  const userPasskeys = createMutableState<
    {
      id: string;
      name?: string | null;
      createdAt: string | Date | number;
    }[]
  >([]);

  await page.route("**/api/health", async (route) => {
    await fulfillJson(route, buildHealthResponse());
  });
  await page.route("**/api/auth/get-session", async (route) => {
    await fulfillJson(route, signedIn ? { session, user } : null);
  });
  await page.route("**/api/public/projection", async (route) => {
    await route.fulfill({ status: 404 });
  });
  await page.route("**/api/auth/email-otp/send-verification-otp", async (route) => {
    await fulfillJson(route, { success: true });
  });
  await page.route("**/api/auth/sign-in/email-otp", async (route) => {
    signedIn = true;
    await fulfillJson(route, { token: "not-used-by-browser-ui", user });
  });
  await page.route("**/api/auth/sign-in/email", async (route) => {
    await fulfillJson(route, { twoFactorMethods: ["totp"], twoFactorRedirect: true });
  });
  await page.route("**/api/auth/request-password-reset", async (route) => {
    await fulfillJson(route, {
      message: "If this email exists in our system, check your email for the reset link",
      status: true,
    });
  });
  await page.route("**/api/auth/reset-password", async (route) => {
    await fulfillJson(route, { status: true });
  });
  await page.route("**/api/auth/sign-out", async (route) => {
    signedIn = false;
    await fulfillJson(route, { success: true });
  });
  await page.route("**/api/auth/passkey/list-user-passkeys", async (route) => {
    await fulfillJson(route, userPasskeys.get());
  });
  await page.route("**/api/auth/passkey/delete-passkey", async (route) => {
    const body: unknown = route.request().postDataJSON();
    const id =
      typeof body === "object" && body !== null && "id" in body && typeof body.id === "string"
        ? body.id
        : "";
    userPasskeys.set(userPasskeys.get().filter((p) => p.id !== id));
    await fulfillJson(route, { success: true });
  });
  await page.route("**/api/auth/passkey/update-passkey", async (route) => {
    const body: unknown = route.request().postDataJSON();
    const id =
      typeof body === "object" && body !== null && "id" in body && typeof body.id === "string"
        ? body.id
        : "";
    const name =
      typeof body === "object" && body !== null && "name" in body && typeof body.name === "string"
        ? body.name
        : "";
    userPasskeys.set(userPasskeys.get().map((p) => (p.id === id ? { ...p, name } : p)));
    await fulfillJson(route, { passkey: { id, name } });
  });
  await page.route("**/api/auth/passkey/generate-authenticate-options", async (route) => {
    await fulfillJson(route, {
      challenge: "mock-challenge-auth-12345",
      rpId: "localhost",
      userVerification: "preferred",
    });
  });
  await page.route("**/api/auth/passkey/verify-authentication", async (route) => {
    signedIn = true;
    await fulfillJson(route, { session, user });
  });
  await page.route("**/api/auth/passkey/generate-register-options", async (route) => {
    await fulfillJson(route, {
      challenge: "mock-challenge-reg-12345",
      rp: { id: "localhost", name: "Choir Management" },
      user: { id: user.id, name: user.email },
    });
  });
  await page.route("**/api/auth/passkey/verify-registration", async (route) => {
    const newPasskey = {
      createdAt: new Date().toISOString(),
      id: "passkey-new-" + Math.random().toString(36).slice(2, 8),
      name: "New Passkey",
    };
    userPasskeys.set([...userPasskeys.get(), newPasskey]);
    await fulfillJson(route, newPasskey);
  });
  await page.route("**/api/account/security", async (route) => {
    await fulfillJson(route, buildAccountSecurityResponse(passwordSet, accountRequestId));
  });
  await page.route("**/api/account/password", async (route) => {
    passwordSet = true;
    await fulfillJson(route, buildAccountSecurityResponse(true, accountRequestId));
  });
  await page.route("**/api/account/sessions", async (route) => {
    await fulfillJson(route, accountSessions.get());
  });
  await page.route("**/api/account/sessions/revoke", async (route) => {
    const body: unknown = route.request().postDataJSON();
    const record = typeof body === "object" && body !== null ? body : {};
    const requestedId =
      "sessionId" in record && typeof record.sessionId === "string"
        ? record.sessionId
        : "id" in record && typeof record.id === "string"
          ? record.id
          : null;
    accountSessions.set(
      accountSessions
        .get()
        .filter((entry) =>
          requestedId === null ? entry.id === session.id : entry.id !== requestedId,
        ),
    );
    await fulfillJson(route, { status: true });
  });
  await page.route("**/api/singer/profile/email-change", async (route) => {
    const body: unknown = route.request().postDataJSON();
    const email =
      typeof body === "object" && body !== null && "email" in body && typeof body.email === "string"
        ? body.email
        : user.email;
    await fulfillJson(route, buildMemberEmailChangeResponse(email, accountRequestId));
  });

  return {
    accountRequestId,
    accountSessions,
    isSignedIn: () => signedIn,
    session,
    setSignedIn: (value: boolean) => {
      signedIn = value;
    },
    user,
    userPasskeys,
  };
}

/** Signed-out variant for login/recovery/confirmation specs. */
export async function installAnonymousSessionShell(page: Page): Promise<SessionShell> {
  return installSessionShell(page, { initiallySignedIn: false });
}

export { defaultFixtureRequestId };
