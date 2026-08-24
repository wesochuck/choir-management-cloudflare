import { describe, expect, it } from "vitest";
import {
  isSafeBoundaryResponse,
  safeSetupMaintenanceQualificationSummary,
  setupMaintenanceQualificationPlan,
} from "./qualify-staging-setup-maintenance.mjs";

describe("qualify-staging-setup-maintenance", () => {
  it("provides a non-empty qualification plan covering setup and maintenance", () => {
    const plan = setupMaintenanceQualificationPlan();
    expect(plan.length).toBeGreaterThanOrEqual(10);
    expect(
      plan.some((step) => step.includes("Music Credit Rename") || step.includes("music credit")),
    ).toBe(true);
    expect(plan.some((step) => step.includes("Setup claim") || step.includes("Setup"))).toBe(true);
    expect(plan.some((step) => step.includes("Administrator recovery"))).toBe(true);
    expect(plan.some((step) => step.includes("stale payment cleanup"))).toBe(true);
    expect(plan.some((step) => step.includes("test-email"))).toBe(true);
    expect(plan.some((step) => step.includes("test-sms"))).toBe(true);
  });

  it("formats safe qualification summary with sanitized fields", () => {
    const summary = safeSetupMaintenanceQualificationSummary({
      cleanupCompleted: true,
      crossOrganizationRejected: true,
      maintenanceIdempotent: true,
      musicCreditRenamed: true,
      musicCreditValidationVerified: true,
      pieceId: "12345678-1234-4234-8234-123456789012",
      setupClaimVerified: true,
      setupCompleteVerified: true,
      setupRecoveryBounded: true,
      stalePaymentCleanupRan: true,
      testEmailQualified: true,
      testSmsQualified: true,
    });
    expect(summary).toEqual({
      cleanupCompleted: true,
      crossOrganizationRejected: true,
      maintenanceIdempotent: true,
      musicCreditRenamed: true,
      musicCreditValidationVerified: true,
      pieceId: "12345678-1234-4234-8234-123456789012",
      setupClaimVerified: true,
      setupCompleteVerified: true,
      setupRecoveryBounded: true,
      stalePaymentCleanupRan: true,
      testEmailQualified: true,
      testSmsQualified: true,
    });
  });

  it("evaluates safe boundary response statuses correctly", () => {
    expect(isSafeBoundaryResponse({ status: 401 })).toBe(true);
    expect(isSafeBoundaryResponse({ status: 403 })).toBe(true);
    expect(isSafeBoundaryResponse({ status: 404 })).toBe(true);
    expect(isSafeBoundaryResponse({ status: 409 })).toBe(true);
    expect(isSafeBoundaryResponse({ status: 200 })).toBe(false);
    expect(isSafeBoundaryResponse({ status: 500 })).toBe(false);
  });
});
