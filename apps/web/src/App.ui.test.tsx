import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishedOrganizationProjectionSchema } from "@choir/contracts";

import { App } from "./App";
import * as api from "./api";
import * as authApi from "./auth/api";
import { setSessionHint } from "./auth/sessionHint";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    getHealth: vi.fn(),
  };
});

vi.mock("./auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof authApi>();
  return {
    ...actual,
    getCurrentSession: vi.fn(),
    getPublishedOrganizationProjection: vi.fn(),
    signOut: vi.fn(),
  };
});

const mockProjection = publishedOrganizationProjectionSchema.parse({
  generatedAt: "2026-07-20T12:00:00.000Z",
  organizationId: "11111111-1111-4111-8111-111111111111",
  payload: {
    mediaFileIds: [],
    organizationName: "Test Chorus",
    performances: [],
    settings: {
      aboutUsText: "We sing songs.",
      bodyFont: "system",
      contactEmail: "info@example.test",
      enabledNavigation: [],
      headerFont: "system",
      heroFileId: null,
      heroHeadline: "Welcome to Test Chorus",
      heroSubtitle: "A community choir",
      historyText: "",
      logoFileId: null,
      showBrandingHeaderFooter: false,
    },
    ticketBundles: [],
    timezone: "America/New_York",
  },
  version: 1,
});

describe("App startup network optimization (#317)", () => {
  const originalLocationHref = window.location.href;

  beforeEach(() => {
    vi.clearAllMocks();
    setSessionHint(false);
  });

  afterEach(() => {
    window.history.pushState({}, "", originalLocationHref);
    setSessionHint(false);
  });

  it("on anonymous visit to published Organization home page (/), calls getPublishedOrganizationProjection once and skips getHealth and getCurrentSession", async () => {
    setSessionHint(false);
    window.history.pushState({}, "", "/");
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(mockProjection);

    render(<App />);

    await screen.findByRole("heading", { name: "Welcome to Test Chorus" });

    expect(authApi.getPublishedOrganizationProjection).toHaveBeenCalledTimes(1);
    expect(api.getHealth).not.toHaveBeenCalled();
    expect(authApi.getCurrentSession).not.toHaveBeenCalled();
  });

  it("on visit to published Organization page with active session hint, verifies session and renders dashboard link", async () => {
    setSessionHint(true);
    window.history.pushState({}, "", "/");
    vi.mocked(authApi.getCurrentSession).mockResolvedValue({
      session: {
        activeOrganizationId: "11111111-1111-4111-8111-111111111111",
        createdAt: "2026-07-20T12:00:00.000Z",
        expiresAt: "2026-07-27T12:00:00.000Z",
        id: "session-1",
        ipAddress: "127.0.0.1",
        updatedAt: "2026-07-20T12:00:00.000Z",
        userAgent: "TestBrowser",
        userId: "user-1",
      },
      user: {
        createdAt: "2026-07-20T12:00:00.000Z",
        email: "singer@example.test",
        emailVerified: true,
        id: "user-1",
        image: null,
        name: "Test Singer",
        twoFactorEnabled: false,
        updatedAt: "2026-07-20T12:00:00.000Z",
      },
    });
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(mockProjection);

    render(<App />);

    await screen.findByRole("heading", { name: "Welcome to Test Chorus" });
    expect(await screen.findByRole("link", { name: "My dashboard" })).toBeInTheDocument();
    expect(authApi.getCurrentSession).toHaveBeenCalledTimes(1);
    expect(api.getHealth).not.toHaveBeenCalled();
  });

  it("on visit to standalone public route like /tickets, skips health and session check on initial load", async () => {
    setSessionHint(false);
    window.history.pushState({}, "", "/tickets");

    render(<App />);

    expect(api.getHealth).not.toHaveBeenCalled();
    expect(authApi.getCurrentSession).not.toHaveBeenCalled();
    await screen.findByRole("heading", { name: "Tickets" });
  });

  it("on visit to unpublished home page (/), triggers health and session check to determine platform fallback", async () => {
    setSessionHint(false);
    window.history.pushState({}, "", "/");
    vi.mocked(authApi.getPublishedOrganizationProjection).mockResolvedValue(null);
    vi.mocked(api.getHealth).mockResolvedValue({
      baseHostname: "localhost",
      environment: "local",
      fingerprint: "cloudflare-worker",
      requestId: "req-1",
      service: "choir-management-cloudflare",
      status: "ok",
      version: "test-ver",
    });
    vi.mocked(authApi.getCurrentSession).mockResolvedValue(null);

    render(<App />);

    await waitFor(() => {
      expect(api.getHealth).toHaveBeenCalledTimes(1);
      expect(authApi.getCurrentSession).toHaveBeenCalledTimes(1);
    });
  });
});
