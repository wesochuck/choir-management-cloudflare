import type { Page } from "@playwright/test";
import type {
  AccountOrganization,
  OrganizationAuthStatusResponse,
  OrganizationInvitationSummary,
} from "@choir/contracts";
import {
  buildAccountMembership,
  buildAuthStatus,
  buildInvitationActionResponse,
  buildInvitationCreateResponse,
  buildInvitationDetails,
  buildInvitationSummary,
  buildModuleStateResponse,
  buildOrganizationProviderStatusResponse,
  buildOrganizationStripeConnectStatusResponse,
  buildPlatformMfaStatusResponse,
  buildSetupStatusResponse,
  createMutableState,
  organizationAlphaId,
  type MutableState,
} from "./builders";
import { fulfillJson } from "./session";

export type OrganizationRole = "owner" | "administrator" | "member";

export interface OrganizationShellOptions {
  /** Workspace role served by organization/auth-status and account/organizations. */
  readonly role?: OrganizationRole | undefined;
  /** Enabled module ids served by organization/module-state. */
  readonly modules?: readonly string[] | undefined;
  readonly organizationId?: string | undefined;
  readonly organizationName?: string | undefined;
  /** Memberships for /account/organizations. Defaults to a single active membership. */
  readonly memberships?: readonly AccountOrganization[] | undefined;
}

export interface OrganizationShell {
  readonly authStatus: MutableState<OrganizationAuthStatusResponse>;
  readonly moduleState: MutableState<readonly { enabled: boolean; id: string }[]>;
  readonly organizationId: string;
  setRole(role: OrganizationRole): void;
}

/**
 * Authenticated workspace chrome fetched by the shell on nearly every org page: branding,
 * module catalog, setup completion, platform security posture, impersonation, and roster labels.
 * Installed by installOrganizationShell and available standalone for specs that compose smaller
 * installs (e.g. /platform/* journeys, which need these but not the membership 200s).
 */
export async function installWorkspaceExtras(
  page: Page,
  options: { organizationId?: string } = {},
): Promise<void> {
  const organizationId = options.organizationId ?? organizationAlphaId;
  await page.route("**/api/organization/branding", async (route) => {
    await fulfillJson(route, { logoFileId: null, organizationName: "Alpha Choir" });
  });
  await page.route("**/api/organization/modules", async (route) => {
    await fulfillJson(route, []);
  });
  await page.route("**/api/organization/setup", async (route) => {
    await fulfillJson(route, {
      completed: true,
      organizationId,
      organizationName: "Alpha Choir",
      requestId: "66666666-6666-4666-8666-666666666666",
    });
  });
  await page.route("**/api/platform/security/status", async (route) => {
    await fulfillJson(route, { activePlatformAdministrator: false });
  });
  await page.route("**/api/organization/impersonation/status", async (route) => {
    await fulfillJson(route, { active: false });
  });
  await page.route("**/api/organization/roster/configuration", async (route) => {
    await fulfillJson(route, { performerLabel: "Performer" });
  });
  await page.route("**/api/organization/provider-status", async (route) => {
    await fulfillJson(route, buildOrganizationProviderStatusResponse());
  });
  await page.route("**/api/organization/stripe-connect", async (route) => {
    await fulfillJson(route, buildOrganizationStripeConnectStatusResponse());
  });
  // Legacy fallthrough parity: the pre-extraction specs left these to the local Worker
  // (unauthorized there, tolerated by the views). They are registered as explicit 404s so the
  // strict guard stays silent; specs that need real data should add validated builders.
  await page.route("**/api/organization/website", async (route) => {
    await fulfillJson(route, { requestId: "11111111-1111-4111-8111-111111111111" }, 404);
  });
  await page.route("**/api/organization/members", async (route) => {
    await fulfillJson(route, { requestId: "11111111-1111-4111-8111-111111111111" }, 404);
  });
}

/**
 * Organization membership/setup surface: account organizations, organization auth-status,
 * module state, setup status, and the platform MFA status gate. Per-test workspace collections
 * (profiles, events, seating, donations, invitations) live in apiMocks.ts.
 */
export async function installOrganizationShell(
  page: Page,
  options: OrganizationShellOptions = {},
): Promise<OrganizationShell> {
  const organizationId = options.organizationId ?? organizationAlphaId;
  const role = options.role ?? "administrator";
  const rawAuthStatus = createMutableState(buildAuthStatus({ organizationId, role }));
  const authStatus: MutableState<OrganizationAuthStatusResponse> = {
    get: () => rawAuthStatus.get(),
    set: (next) => {
      rawAuthStatus.set(next);
    },
    update: (patch) => {
      const current = rawAuthStatus.get();
      const mfaRequired = patch.mfaRequired ?? current.mfaRequired;
      const mfaVerifiedUntil = patch.mfaVerifiedUntil ?? current.mfaVerifiedUntil;
      const mfaSatisfiedBy =
        patch.mfaSatisfiedBy !== undefined
          ? patch.mfaSatisfiedBy
          : patch.mfaSatisfied === false
            ? null
            : (current.mfaSatisfiedBy ?? (mfaVerifiedUntil ? "totp" : null));
      const mfaSatisfied =
        patch.mfaSatisfied ??
        (!mfaRequired || mfaSatisfiedBy === "passkey" || Boolean(mfaVerifiedUntil));
      rawAuthStatus.update({
        ...patch,
        mfaRequired,
        mfaSatisfied,
        mfaSatisfiedBy,
        mfaVerifiedUntil,
      });
    },
  };
  const moduleState = createMutableState<readonly { enabled: boolean; id: string }[]>(
    (options.modules ?? ["events", "people", "programs"]).map((id) => ({ enabled: true, id })),
  );
  const memberships = options.memberships ?? [buildAccountMembership({ organizationId, role })];

  await page.route("**/api/account/organizations", async (route) => {
    await fulfillJson(route, { organizations: memberships });
  });
  await page.route("**/api/organization/auth-status", async (route) => {
    await fulfillJson(route, authStatus.get());
  });
  await page.route("**/api/organization/module-state", async (route) => {
    await fulfillJson(route, buildModuleStateResponse(moduleState.get().map((entry) => entry.id)));
  });
  await page.route("**/api/setup/status", async (route) => {
    await fulfillJson(route, buildSetupStatusResponse({ organizationId }));
  });
  await page.route("**/api/platform/mfa/status", async (route) => {
    await fulfillJson(route, buildPlatformMfaStatusResponse({}));
  });
  await installWorkspaceExtras(page, { organizationId });

  return {
    authStatus,
    moduleState,
    organizationId,
    setRole: (next: OrganizationRole) => {
      authStatus.update({ role: next });
    },
  };
}

export interface InvitationMocksOptions {
  readonly invitations?: readonly OrganizationInvitationSummary[];
  readonly requestId?: string;
}

export interface InvitationMocks {
  readonly invitations: MutableState<OrganizationInvitationSummary[]>;
}

/**
 * Organization invitation lifecycle: list, create, details, accept, reject, and cancel.
 * Details/accept/reject endpoints are registered per invitation id known at install time plus a
 * wildcard fallback so specs can introduce new ids through the mutable list handle.
 */
export async function installInvitationMocks(
  page: Page,
  options: InvitationMocksOptions = {},
): Promise<InvitationMocks> {
  const requestId = options.requestId ?? "55555555-5555-4555-8555-555555555555";
  const invitations = createMutableState<OrganizationInvitationSummary[]>([
    ...(options.invitations ?? [buildInvitationSummary({})]),
  ]);

  await page.route("**/api/organization/invitations", async (route) => {
    if (route.request().method() === "GET") {
      await fulfillJson(route, {
        invitations: invitations.get(),
        requestId,
        truncated: false,
      });
      return;
    }
    const body: unknown = route.request().postDataJSON();
    const record =
      typeof body === "object" && body !== null ? Object.fromEntries(Object.entries(body)) : {};
    const created = buildInvitationSummary({
      email: typeof record.email === "string" ? record.email : "future.member@example.test",
      role:
        record.role === "owner" || record.role === "member" || record.role === "administrator"
          ? record.role
          : "administrator",
    });
    invitations.set([...invitations.get(), created]);
    await fulfillJson(route, buildInvitationCreateResponse(created.id, requestId), 201);
  });

  const findInvitation = (invitationId: string) =>
    invitations.get().find((invitation) => invitation.id === invitationId) ?? null;

  await page.route("**/api/organization/invitations/*/accept", async (route) => {
    const segments = new URL(route.request().url()).pathname.split("/").filter(Boolean);
    const invitationId = segments[3] ?? "";
    invitations.set(invitations.get().filter((invitation) => invitation.id !== invitationId));
    await fulfillJson(route, buildInvitationActionResponse(invitationId, "accepted", requestId));
  });

  await page.route("**/api/organization/invitations/*/reject", async (route) => {
    const segments = new URL(route.request().url()).pathname.split("/").filter(Boolean);
    const invitationId = segments[3] ?? "";
    invitations.set(invitations.get().filter((invitation) => invitation.id !== invitationId));
    await fulfillJson(route, buildInvitationActionResponse(invitationId, "rejected", requestId));
  });

  await page.route("**/api/organization/invitations/*", async (route) => {
    // Single-segment detail/cancel path: /api/organization/invitations/:id.
    const segments = new URL(route.request().url()).pathname.split("/").filter(Boolean);
    const invitationId = segments[3] ?? null;
    if (route.request().method() === "GET" && invitationId) {
      const invitation = findInvitation(invitationId);
      if (!invitation) {
        await fulfillJson(route, { requestId }, 404);
        return;
      }
      await fulfillJson(
        route,
        buildInvitationDetails({
          email: invitation.email,
          expiresAt: invitation.expiresAt,
          id: invitation.id,
          role: invitation.role,
        }),
      );
      return;
    }
    if (route.request().method() === "DELETE" && invitationId) {
      invitations.set(invitations.get().filter((invitation) => invitation.id !== invitationId));
      await fulfillJson(route, buildInvitationActionResponse(invitationId, "canceled", requestId));
      return;
    }
    await fulfillJson(route, { requestId }, 404);
  });

  return { invitations };
}
