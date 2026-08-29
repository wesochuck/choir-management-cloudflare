import type { Page, Route } from "@playwright/test";

export interface MockSessionOptions {
  readonly email?: string;
  readonly name?: string;
  readonly organizationId?: string;
  readonly role?: "admin" | "member" | "superadmin";
  readonly twoFactorEnabled?: boolean;
  readonly userId?: string;
}

export const defaultMockRequestId = "11111111-1111-4111-8111-111111111111";
export const defaultMockOrganizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const defaultMockUserId = "user-test-admin";

export async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json",
    status,
  });
}

export function createMockSession(options: MockSessionOptions = {}) {
  const organizationId = options.organizationId ?? defaultMockOrganizationId;
  const userId = options.userId ?? defaultMockUserId;
  const email = options.email ?? "admin@example.test";
  const name = options.name ?? "Test Administrator";

  return {
    session: {
      activeOrganizationId: organizationId,
      createdAt: "2026-07-20T20:00:00.000Z",
      expiresAt: "2026-07-27T20:00:00.000Z",
      id: `session-${userId}`,
      ipAddress: "192.0.2.40",
      token: "test-token-not-displayed",
      updatedAt: "2026-07-20T20:00:00.000Z",
      userAgent: "Chromium browser",
      userId,
    },
    user: {
      createdAt: "2026-07-20T19:00:00.000Z",
      email,
      emailVerified: true,
      id: userId,
      image: null,
      name,
      twoFactorEnabled: options.twoFactorEnabled ?? false,
      updatedAt: "2026-07-20T19:00:00.000Z",
    },
  };
}

export async function mockHealth(page: Page, overrides?: Record<string, unknown>): Promise<void> {
  await page.route("**/api/health", async (route) => {
    await fulfillJson(route, {
      environment: "local",
      requestId: defaultMockRequestId,
      service: "choir-management-cloudflare",
      status: "ok",
      version: "browser-test",
      ...overrides,
    });
  });
}

export async function mockAuthenticatedSession(
  page: Page,
  options: MockSessionOptions = {},
): Promise<void> {
  const session = createMockSession(options);
  await page.route("**/api/auth/get-session", async (route) => {
    await fulfillJson(route, session);
  });
}

export async function mockAnonymousSession(page: Page): Promise<void> {
  await page.route("**/api/auth/get-session", async (route) => {
    await fulfillJson(route, null);
  });
}

export async function mockBranding(
  page: Page,
  branding = {
    brandColor: "#0284c7",
    name: "Test Choir",
    tagline: "Singing Together",
  },
): Promise<void> {
  await page.route("**/api/organization/branding", async (route) => {
    await fulfillJson(route, branding);
  });
}

export async function mockRosterConfiguration(
  page: Page,
  config = {
    partLabel: "Voice Part",
    performerLabel: "Singer",
    performerLabelPlural: "Singers",
  },
): Promise<void> {
  await page.route("**/api/organization/roster-configuration", async (route) => {
    await fulfillJson(route, config);
  });
}

export async function mockPlatformMfaStatus(
  page: Page,
  status = { enforced: false },
): Promise<void> {
  await page.route("**/api/platform/mfa-status", async (route) => {
    await fulfillJson(route, status);
  });
}

export async function mockOrganizationAuthStatus(
  page: Page,
  status = {
    activeOrganizationId: defaultMockOrganizationId,
    activeRole: "admin",
    membershipCount: 1,
    memberships: [
      {
        id: "membership-1",
        organizationId: defaultMockOrganizationId,
        organizationName: "Test Choir",
        role: "admin",
      },
    ],
  },
): Promise<void> {
  await page.route("**/api/organization/auth-status", async (route) => {
    await fulfillJson(route, status);
  });
}
