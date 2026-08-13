import {
  organizationProvisionResponseSchema,
  platformMfaStatusResponseSchema,
  platformJobDeadLetterActionResponseSchema,
  platformJobDeadLettersResponseSchema,
  platformFleetSchemaStatusResponseSchema,
  platformEmailSuppressionsResponseSchema,
  platformEmailSuppressionReleaseResponseSchema,
  platformOrganizationContextResponseSchema,
  platformOrganizationsResponseSchema,
} from "@choir/contracts";
import { introspectWorkflow, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  setupAuthIntegration,
  teardownAuthIntegration,
  ALPHA_AUTH_ORIGIN,
  testEnv,
  enrollmentResponseSchema,
  authRequest,
  generateTotp,
  fetchWorker,
  readCapturedPlatformEmailsForTest,
  seedInvitedUser,
  seedOrganizations,
  signInInvitedUser,
  grantPlatformAdministratorForCurrentSession,
} from "./auth.integration.fixture";
beforeEach(async () => setupAuthIntegration());
afterEach(async () => teardownAuthIntegration());

describe("Platform Administrator MFA", () => {
  it("requires enrollment and a recent session-bound factor, then rejects revocation", async () => {
    await seedInvitedUser();
    let sessionCookie = await signInInvitedUser();

    const ordinaryUserStatus = await fetchWorker(
      authRequest("/api/platform/mfa/status", { headers: { cookie: sessionCookie } }),
    );
    expect(ordinaryUserStatus.status).toBe(200);
    expect(platformMfaStatusResponseSchema.parse(await ordinaryUserStatus.json())).toMatchObject({
      activePlatformAdministrator: false,
      enrollmentComplete: false,
      twoFactorEnabled: false,
    });

    const grantedAt = new Date().toISOString();
    await testEnv.CONTROL_DB.prepare(
      `INSERT INTO platform_administrators (user_id, granted_by, granted_at)
       VALUES (?, ?, ?)`,
    )
      .bind("user-invited-member", "bootstrap", grantedAt)
      .run();

    const pendingStatus = await fetchWorker(
      authRequest("/api/platform/mfa/status", { headers: { cookie: sessionCookie } }),
    );
    expect(platformMfaStatusResponseSchema.parse(await pendingStatus.json())).toMatchObject({
      activePlatformAdministrator: true,
      enrollmentComplete: false,
      twoFactorEnabled: false,
    });

    const beforeEnrollment = await fetchWorker(
      authRequest("/api/platform/context", { headers: { cookie: sessionCookie } }),
    );
    expect(beforeEnrollment.status).toBe(403);

    const enableResponse = await fetchWorker(
      authRequest("/api/auth/two-factor/enable", {
        body: JSON.stringify({}),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(enableResponse.status).toBe(200);
    const enrollment = enrollmentResponseSchema.parse(await enableResponse.json());
    expect(enrollment.backupCodes).toHaveLength(10);
    const enrollmentCode = await generateTotp(enrollment.totpURI);

    const verifyEnrollmentResponse = await fetchWorker(
      authRequest("/api/auth/two-factor/verify-totp", {
        body: JSON.stringify({ code: enrollmentCode, trustDevice: false }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(verifyEnrollmentResponse.status).toBe(200);
    sessionCookie =
      verifyEnrollmentResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? sessionCookie;

    const confirmResponse = await fetchWorker(
      authRequest("/api/platform/mfa/confirm-enrollment", {
        body: JSON.stringify({}),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(confirmResponse.status).toBe(200);

    const enrolledStatus = await fetchWorker(
      authRequest("/api/platform/mfa/status", { headers: { cookie: sessionCookie } }),
    );
    expect(platformMfaStatusResponseSchema.parse(await enrolledStatus.json())).toMatchObject({
      activePlatformAdministrator: true,
      enrollmentComplete: true,
      twoFactorEnabled: true,
    });

    const beforeFreshFactor = await fetchWorker(
      authRequest("/api/platform/context", { headers: { cookie: sessionCookie } }),
    );
    expect(beforeFreshFactor.status).toBe(401);

    const challengeCode = await generateTotp(enrollment.totpURI);
    const challengeResponse = await fetchWorker(
      authRequest("/api/platform/mfa/verify", {
        body: JSON.stringify({ code: challengeCode, method: "totp" }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(challengeResponse.status).toBe(200);

    const assertion = await testEnv.CONTROL_DB.prepare(
      `SELECT verified_at AS verifiedAt, expires_at AS expiresAt
       FROM platform_mfa_assertions
       WHERE user_id = ?
       ORDER BY verified_at DESC
       LIMIT 1`,
    )
      .bind("user-invited-member")
      .first<{ expiresAt: number; verifiedAt: number }>();
    if (!assertion) throw new Error("The Platform MFA assertion was not persisted.");
    expect(assertion.expiresAt - assertion.verifiedAt).toBe(60 * 60 * 1000);

    const authorized = await fetchWorker(
      authRequest("/api/platform/context", { headers: { cookie: sessionCookie } }),
    );
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toMatchObject({
      mfaMethod: "totp",
      scope: { kind: "product_base" },
      userId: "user-invited-member",
    });

    await testEnv.CONTROL_DB.prepare("DELETE FROM platform_mfa_assertions").run();
    const recoveryResponse = await fetchWorker(
      authRequest("/api/platform/mfa/verify", {
        body: JSON.stringify({ code: enrollment.backupCodes[0], method: "recovery_code" }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(recoveryResponse.status).toBe(200);
    const recoveryAuthorized = await fetchWorker(
      authRequest("/api/platform/context", { headers: { cookie: sessionCookie } }),
    );
    await expect(recoveryAuthorized.json()).resolves.toMatchObject({ mfaMethod: "recovery_code" });

    await testEnv.CONTROL_DB.prepare(
      "UPDATE platform_administrators SET revoked_at = ? WHERE user_id = ?",
    )
      .bind(new Date().toISOString(), "user-invited-member")
      .run();
    const revokedResponse = await fetchWorker(
      authRequest("/api/platform/context", { headers: { cookie: sessionCookie } }),
    );
    expect(revokedResponse.status).toBe(403);
  });

  it("lists application-wide email suppressions for verified Platform Administrators", async () => {
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();

    const ordinaryUserResponse = await fetchWorker(
      authRequest("/api/platform/email-suppressions", { headers: { cookie: sessionCookie } }),
    );
    expect(ordinaryUserResponse.status).toBe(403);

    await grantPlatformAdministratorForCurrentSession();
    const activeCreatedAt = "2026-08-06T17:07:28.817Z";
    const inactiveCreatedAt = "2026-08-05T17:07:28.817Z";
    await testEnv.CONTROL_DB.batch([
      testEnv.CONTROL_DB.prepare(
        `INSERT INTO email_recipient_suppressions
          (email_normalized, reason, source_event_id, provider_message_id, detail, active, created_at, updated_at)
         VALUES (?, 'bounce', ?, ?, ?, 1, ?, ?)`,
      ).bind(
        "bounce@example.test",
        "event-bounce",
        "provider-bounce",
        "Mailbox unavailable",
        activeCreatedAt,
        activeCreatedAt,
      ),
      testEnv.CONTROL_DB.prepare(
        `INSERT INTO email_recipient_suppressions
          (email_normalized, reason, source_event_id, provider_message_id, detail, active, created_at, updated_at)
         VALUES (?, 'complaint', ?, ?, ?, 0, ?, ?)`,
      ).bind(
        "complaint@example.test",
        "event-complaint",
        "provider-complaint",
        "Complaint cleared for test",
        inactiveCreatedAt,
        inactiveCreatedAt,
      ),
    ]);

    const activeResponse = await fetchWorker(
      authRequest("/api/platform/email-suppressions", { headers: { cookie: sessionCookie } }),
    );
    expect(activeResponse.status).toBe(200);
    expect(
      platformEmailSuppressionsResponseSchema.parse(await activeResponse.json()),
    ).toMatchObject({
      nextCursor: null,
      suppressions: [
        {
          active: true,
          email: "bounce@example.test",
          reason: "bounce",
          sourceEventId: "event-bounce",
        },
      ],
    });

    const searchResponse = await fetchWorker(
      authRequest("/api/platform/email-suppressions?q=complaint&status=all", {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(searchResponse.status).toBe(200);
    expect(
      platformEmailSuppressionsResponseSchema.parse(await searchResponse.json()),
    ).toMatchObject({
      suppressions: [
        {
          active: false,
          email: "complaint@example.test",
          reason: "complaint",
        },
      ],
    });

    const releaseResponse = await fetchWorker(
      authRequest("/api/platform/email-suppressions/release", {
        body: JSON.stringify({
          email: "BOUNCE@example.test",
          reason: "Mailbox issue was resolved and verified.",
        }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(releaseResponse.status).toBe(200);
    expect(
      platformEmailSuppressionReleaseResponseSchema.parse(await releaseResponse.json()),
    ).toMatchObject({ active: false, email: "bounce@example.test" });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT active FROM email_recipient_suppressions WHERE email_normalized = ?`,
      )
        .bind("bounce@example.test")
        .first(),
    ).resolves.toEqual({ active: 0 });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT action, actor_user_id AS actorUserId, target_id AS targetId
         FROM platform_audit_events
         WHERE target_id = ? AND action = 'platform.email_suppression.released'`,
      )
        .bind("bounce@example.test")
        .first(),
    ).resolves.toMatchObject({
      action: "platform.email_suppression.released",
      actorUserId: "user-invited-member",
      targetId: "bounce@example.test",
    });

    const repeatedReleaseResponse = await fetchWorker(
      authRequest("/api/platform/email-suppressions/release", {
        body: JSON.stringify({
          email: "bounce@example.test",
          reason: "Repeated release request.",
        }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(repeatedReleaseResponse.status).toBe(200);

    const invalidFilterResponse = await fetchWorker(
      authRequest("/api/platform/email-suppressions?status=invalid", {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(invalidFilterResponse.status).toBe(400);

    const wrongHostResponse = await fetchWorker(
      authRequest(
        "/api/platform/email-suppressions",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(wrongHostResponse.status).toBe(404);

    const wrongHostReleaseResponse = await fetchWorker(
      authRequest(
        "/api/platform/email-suppressions/release",
        {
          body: JSON.stringify({ email: "bounce@example.test", reason: "Verified." }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(wrongHostReleaseResponse.status).toBe(404);
  });

  it("gates queue controls and keeps provider test routes in fake mode", async () => {
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();
    const capturedEmailCount = readCapturedPlatformEmailsForTest().length;

    const protectedRequests = [
      {
        path: "/api/platform/queue-settings",
        request: authRequest("/api/platform/queue-settings", {
          headers: { cookie: sessionCookie },
        }),
      },
      {
        path: "/api/test-smtp",
        request: authRequest("/api/test-smtp", {
          body: JSON.stringify({ to: "platform-test@example.test" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        }),
      },
      {
        path: "/api/test-sms",
        request: authRequest("/api/test-sms", {
          body: JSON.stringify({ to: "+15551234567" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        }),
      },
    ];
    for (const { path, request } of protectedRequests) {
      const response = await fetchWorker(request);
      expect(response.status, path).toBe(403);
    }

    await grantPlatformAdministratorForCurrentSession();
    const queueSettings = await fetchWorker(
      authRequest("/api/platform/queue-settings", { headers: { cookie: sessionCookie } }),
    );
    expect(queueSettings.status).toBe(200);
    await expect(queueSettings.json()).resolves.toMatchObject({
      deadLetterQueue: "choir-management-jobs-dlq-local",
      mode: "fake",
      queue: "choir-management-jobs-local",
    });

    const generated = await fetchWorker(
      authRequest("/api/platform/queue-settings/generate", {
        body: JSON.stringify({}),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(generated.status).toBe(200);
    await expect(generated.json()).resolves.toMatchObject({ generated: true });

    const smtp = await fetchWorker(
      authRequest("/api/test-smtp", {
        body: JSON.stringify({ to: "platform-test@example.test" }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(smtp.status).toBe(200);
    await expect(smtp.json()).resolves.toMatchObject({ mode: "fake", sent: true });

    const sms = await fetchWorker(
      authRequest("/api/test-sms", {
        body: JSON.stringify({ to: "+15551234567" }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(sms.status).toBe(200);
    await expect(sms.json()).resolves.toMatchObject({ mode: "fake", sent: true });
    expect(readCapturedPlatformEmailsForTest()).toHaveLength(capturedEmailCount);
  });

  it("bounds edit elevation to one Organization and supports explicit revocation", async () => {
    await seedInvitedUser();
    await seedOrganizations(true);
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    await grantPlatformAdministratorForCurrentSession();

    const initialResponse = await fetchWorker(
      authRequest(
        "/api/platform/organization-context",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    const initialContext = platformOrganizationContextResponseSchema.parse(
      await initialResponse.json(),
    );
    expect(initialContext).toMatchObject({
      canEdit: false,
      organizationId: "organization-alpha",
      userId: "user-invited-member",
    });

    const elevationResponse = await fetchWorker(
      authRequest(
        "/api/platform/elevations",
        {
          body: JSON.stringify({ reason: "Verify scoped Organization maintenance" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(elevationResponse.status).toBe(201);
    const elevatedContext = platformOrganizationContextResponseSchema.parse(
      await elevationResponse.json(),
    );
    expect(elevatedContext.canEdit).toBe(true);

    const bravoResponse = await fetchWorker(
      authRequest(
        "/api/platform/organization-context",
        { headers: { cookie: sessionCookie } },
        "http://bravo.localhost",
      ),
    );
    const bravoContext = platformOrganizationContextResponseSchema.parse(
      await bravoResponse.json(),
    );
    expect(bravoContext).toMatchObject({
      canEdit: false,
      organizationId: "organization-bravo",
    });

    const revokeResponse = await fetchWorker(
      authRequest(
        `/api/platform/elevations/${elevatedContext.elevationId ?? "missing"}`,
        { headers: { cookie: sessionCookie }, method: "DELETE" },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(revokeResponse.status).toBe(200);

    const revokedResponse = await fetchWorker(
      authRequest(
        "/api/platform/organization-context",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    await expect(revokedResponse.json()).resolves.toMatchObject({ canEdit: false });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT action, actor_user_id AS actorUserId, organization_id AS organizationId
         FROM platform_audit_events
         WHERE target_id = ?
         ORDER BY occurred_at`,
      )
        .bind(elevatedContext.elevationId)
        .all(),
    ).resolves.toMatchObject({
      results: [
        {
          action: "platform.elevation.created",
          actorUserId: "user-invited-member",
          organizationId: "organization-alpha",
        },
        {
          action: "platform.elevation.revoked",
          actorUserId: "user-invited-member",
          organizationId: "organization-alpha",
        },
      ],
    });
  });

  it("recovers an unadministered launched Organization through scoped Platform MFA", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const sessionCookie = await signInInvitedUser();
    await grantPlatformAdministratorForCurrentSession();

    const organizationId = "organization-bravo";
    const organizationStub = testEnv.ORGANIZATION_STORE.get(
      testEnv.ORGANIZATION_STORE.idFromName(organizationId),
    );
    const provisionResponse = await organizationStub.fetch(
      "https://organization.internal/internal/provision",
      {
        body: JSON.stringify({
          actorUserId: "bootstrap",
          canonicalHostname: "bravo.localhost",
          canonicalStatus: "active",
          name: "Organization Bravo",
          organizationId,
          requestId: crypto.randomUUID(),
          slug: "bravo",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(provisionResponse.status).toBe(200);
    await organizationStub.fetch("https://organization.internal/internal/setup/manage", {
      body: JSON.stringify({
        action: "save_progress",
        data: { modules: true },
        organizationId,
        step: "modules",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const completeSetupResponse = await organizationStub.fetch(
      "https://organization.internal/internal/setup/manage",
      {
        body: JSON.stringify({ action: "complete_setup", organizationId }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(completeSetupResponse.status).toBe(200);

    const elevationResponse = await fetchWorker(
      authRequest(
        "/api/platform/elevations",
        {
          body: JSON.stringify({ reason: "Recover the unadministered Organization" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        "http://bravo.localhost",
      ),
    );
    expect(elevationResponse.status).toBe(201);

    const recoveryResponse = await fetchWorker(
      authRequest(
        "/api/setup/recover-admin",
        {
          body: JSON.stringify({
            email: "recovered.admin@example.test",
            name: "Recovered Administrator",
            password: "not-persisted-password",
            passwordConfirm: "not-persisted-password",
          }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        "http://bravo.localhost",
      ),
    );
    expect(recoveryResponse.status).toBe(200);
    const recovery = z
      .object({
        membershipId: z.uuid(),
        requestId: z.uuid(),
        success: z.literal(true),
        userId: z.uuid(),
      })
      .parse(await recoveryResponse.json());
    expect(
      await testEnv.CONTROL_DB.prepare(
        `SELECT role, profileId FROM member WHERE id = ? AND organizationId = ?`,
      )
        .bind(recovery.membershipId, organizationId)
        .first(),
    ).toMatchObject({ role: "admin" });
    expect(
      await testEnv.CONTROL_DB.prepare(`SELECT name, email, emailVerified FROM user WHERE id = ?`)
        .bind(recovery.userId)
        .first(),
    ).toMatchObject({ email: "recovered.admin@example.test", emailVerified: 1 });
    expect(
      await testEnv.CONTROL_DB.prepare(
        `SELECT action, actor_user_id AS actorUserId, organization_id AS organizationId
         FROM platform_audit_events WHERE target_id = ?`,
      )
        .bind(recovery.membershipId)
        .first(),
    ).toMatchObject({
      action: "organization.admin.recovered",
      actorUserId: "user-invited-member",
      organizationId,
    });

    const replayResponse = await fetchWorker(
      authRequest(
        "/api/setup/recover-admin",
        {
          body: JSON.stringify({ email: "another.admin@example.test", name: "Another Admin" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        "http://bravo.localhost",
      ),
    );
    expect(replayResponse.status).toBe(409);
    await expect(replayResponse.json()).resolves.toMatchObject({
      code: "admin_recovery_not_required",
    });

    const crossTenantResponse = await fetchWorker(
      authRequest(
        "/api/setup/recover-admin",
        {
          body: JSON.stringify({ email: "cross-tenant@example.test", name: "Cross Tenant" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        "http://alpha.localhost",
      ),
    );
    expect(crossTenantResponse.status).toBe(403);
  });

  it("starts audited Organization provisioning from the exact product base host", async () => {
    await seedInvitedUser();
    const sessionCookie = await signInInvitedUser();
    await grantPlatformAdministratorForCurrentSession();
    const workflowIntrospector = await introspectWorkflow(testEnv.PROVISIONING_WORKFLOW);
    const fleetWorkflowIntrospector = await introspectWorkflow(testEnv.FLEET_SCHEMA_WORKFLOW);
    try {
      await testEnv.CONTROL_DB.prepare(
        `INSERT INTO job_dead_letters
          (id, queue_name, message_id, message_valid, observed_attempt,
           organization_id, job_id, job_kind, idempotency_key,
           first_seen_at, last_seen_at, observation_count)
         VALUES (?, ?, ?, 1, 6, NULL, ?, 'organization_export', ?, ?, ?, 1)`,
      )
        .bind(
          "choir-management-jobs-dlq-local:platform-visible-failure",
          "choir-management-jobs-dlq-local",
          "platform-visible-failure",
          "33333333-3333-4333-8333-333333333333",
          "organization-export:unassigned",
          "2026-07-21T17:00:00.000Z",
          "2026-07-21T17:00:00.000Z",
        )
        .run();
      const deadLettersResponse = await fetchWorker(
        authRequest("/api/platform/job-dead-letters", { headers: { cookie: sessionCookie } }),
      );
      expect(deadLettersResponse.status).toBe(200);
      expect(
        platformJobDeadLettersResponseSchema.parse(await deadLettersResponse.json()),
      ).toMatchObject({
        deadLetters: [
          {
            jobKind: "organization_export",
            messageId: "platform-visible-failure",
            messageValid: true,
            observationCount: 1,
            organizationId: null,
          },
        ],
        nextCursor: null,
      });
      const invalidDeadLetterCursorResponse = await fetchWorker(
        authRequest("/api/platform/job-dead-letters?cursor=invalid", {
          headers: { cookie: sessionCookie },
        }),
      );
      expect(invalidDeadLetterCursorResponse.status).toBe(400);
      const scopedDeadLetterResponse = await fetchWorker(
        authRequest(
          "/api/platform/job-dead-letters",
          { headers: { cookie: sessionCookie } },
          ALPHA_AUTH_ORIGIN,
        ),
      );
      expect(scopedDeadLetterResponse.status).toBe(404);

      const initialDirectoryResponse = await fetchWorker(
        authRequest("/api/platform/organizations", { headers: { cookie: sessionCookie } }),
      );
      expect(initialDirectoryResponse.status).toBe(200);
      expect(
        platformOrganizationsResponseSchema.parse(await initialDirectoryResponse.json()),
      ).toMatchObject({ nextCursor: null, organizations: [] });

      const invalidCursorResponse = await fetchWorker(
        authRequest("/api/platform/organizations?cursor=invalid", {
          headers: { cookie: sessionCookie },
        }),
      );
      expect(invalidCursorResponse.status).toBe(400);

      const response = await fetchWorker(
        authRequest("/api/platform/organizations", {
          body: JSON.stringify({ name: "Organization Charlie", slug: "charlie" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        }),
      );
      expect(response.status).toBe(202);
      const provisioning = organizationProvisionResponseSchema.parse(await response.json());
      expect(provisioning).toMatchObject({
        canonicalHostname: "charlie.localhost",
        canonicalStatus: "active",
        lifecycleState: "provisioning",
      });

      const workflowInstances = await workflowIntrospector.get();
      expect(workflowInstances).toHaveLength(1);
      await workflowInstances[0]?.waitForStatus("complete");

      await expect(
        testEnv.CONTROL_DB.prepare(
          `SELECT name, slug, lifecycle_state AS lifecycleState,
            provisioning_workflow_id AS workflowId
           FROM organizations WHERE id = ?`,
        )
          .bind(provisioning.organizationId)
          .first(),
      ).resolves.toEqual({
        lifecycleState: "active",
        name: "Organization Charlie",
        slug: "charlie",
        workflowId: provisioning.workflowId,
      });
      await expect(
        testEnv.CONTROL_DB.prepare(
          `SELECT action, actor_user_id AS actorUserId
           FROM platform_audit_events
           WHERE organization_id = ? AND action = 'organization.provisioning.requested'`,
        )
          .bind(provisioning.organizationId)
          .first(),
      ).resolves.toEqual({
        action: "organization.provisioning.requested",
        actorUserId: "user-invited-member",
      });

      const directoryResponse = await fetchWorker(
        authRequest("/api/platform/organizations", { headers: { cookie: sessionCookie } }),
      );
      expect(directoryResponse.status).toBe(200);
      expect(
        platformOrganizationsResponseSchema.parse(await directoryResponse.json()),
      ).toMatchObject({
        nextCursor: null,
        organizations: [
          {
            canonicalHostname: "charlie.localhost",
            canonicalStatus: "active",
            lifecycleState: "active",
            name: "Organization Charlie",
            organizationId: provisioning.organizationId,
            slug: "charlie",
          },
        ],
      });

      const initialFleetResponse = await fetchWorker(
        authRequest("/api/platform/fleet-schema-preparation", {
          headers: { cookie: sessionCookie },
        }),
      );
      expect(initialFleetResponse.status).toBe(200);
      expect(
        platformFleetSchemaStatusResponseSchema.parse(await initialFleetResponse.json()),
      ).toMatchObject({ preparation: null });
      const fleetStartResponse = await fetchWorker(
        authRequest("/api/platform/fleet-schema-preparation", {
          body: JSON.stringify({}),
          headers: { cookie: sessionCookie },
          method: "POST",
        }),
      );
      expect(fleetStartResponse.status).toBe(202);
      const fleetStart = platformFleetSchemaStatusResponseSchema.parse(
        await fleetStartResponse.json(),
      );
      expect(fleetStart.preparation).toMatchObject({ processedCount: 0, status: "running" });
      const fleetInstances = await fleetWorkflowIntrospector.get();
      expect(fleetInstances).toHaveLength(1);
      await fleetInstances[0]?.waitForStatus("complete");
      const completedFleetResponse = await fetchWorker(
        authRequest("/api/platform/fleet-schema-preparation", {
          headers: { cookie: sessionCookie },
        }),
      );
      expect(
        platformFleetSchemaStatusResponseSchema.parse(await completedFleetResponse.json()),
      ).toMatchObject({
        preparation: { processedCount: 0, status: "completed" },
      });
      const scopedFleetResponse = await fetchWorker(
        authRequest(
          "/api/platform/fleet-schema-preparation",
          { headers: { cookie: sessionCookie } },
          "http://charlie.localhost",
        ),
      );
      expect(scopedFleetResponse.status).toBe(404);

      const paginationCreatedAt = "2030-01-01T00:00:00.000Z";
      await testEnv.CONTROL_DB.batch(
        Array.from({ length: 25 }, (_, index) => {
          const suffix = String(index).padStart(2, "0");
          const organizationId = `pagination-organization-${suffix}`;
          return [
            testEnv.CONTROL_DB.prepare(
              `INSERT INTO organizations
                (id, name, slug, lifecycle_state, durable_object_key,
                 operational_schema_version, created_at, updated_at, provisioned_at)
               VALUES (?, ?, ?, 'active', ?, 1, ?, ?, ?)`,
            ).bind(
              organizationId,
              `Pagination Organization ${suffix}`,
              `pagination-${suffix}`,
              organizationId,
              paginationCreatedAt,
              paginationCreatedAt,
              paginationCreatedAt,
            ),
            testEnv.CONTROL_DB.prepare(
              `INSERT INTO organization_domains
                (id, organization_id, hostname, kind, status, routing_version,
                 created_at, updated_at)
               VALUES (?, ?, ?, 'canonical', 'active', 1, ?, ?)`,
            ).bind(
              `pagination-domain-${suffix}`,
              organizationId,
              `pagination-${suffix}.localhost`,
              paginationCreatedAt,
              paginationCreatedAt,
            ),
          ];
        }).flat(),
      );
      const firstPageResponse = await fetchWorker(
        authRequest("/api/platform/organizations", { headers: { cookie: sessionCookie } }),
      );
      const firstPage = platformOrganizationsResponseSchema.parse(await firstPageResponse.json());
      expect(firstPage.organizations).toHaveLength(25);
      expect(firstPage.nextCursor).not.toBeNull();
      const secondPageResponse = await fetchWorker(
        authRequest(
          `/api/platform/organizations?cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
          { headers: { cookie: sessionCookie } },
        ),
      );
      const secondPage = platformOrganizationsResponseSchema.parse(await secondPageResponse.json());
      expect(secondPage.nextCursor).toBeNull();
      expect(secondPage.organizations).toHaveLength(1);
      expect(secondPage.organizations[0]?.organizationId).toBe(provisioning.organizationId);

      const wrongHostResponse = await fetchWorker(
        authRequest(
          "/api/platform/organizations",
          {
            body: JSON.stringify({ name: "Wrong Host", slug: "wrong-host" }),
            headers: { cookie: sessionCookie },
            method: "POST",
          },
          "http://charlie.localhost",
        ),
      );
      expect(wrongHostResponse.status).toBe(404);
      const wrongHostDirectoryResponse = await fetchWorker(
        authRequest(
          "/api/platform/organizations",
          { headers: { cookie: sessionCookie } },
          "http://charlie.localhost",
        ),
      );
      expect(wrongHostDirectoryResponse.status).toBe(404);
    } finally {
      await workflowIntrospector.dispose();
      await fleetWorkflowIntrospector.dispose();
    }
  });

  it("lets Platform Administrators retry valid queue jobs and dismiss invalid records", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const sessionCookie = await signInInvitedUser();
    await grantPlatformAdministratorForCurrentSession();

    const jobId = "44444444-4444-4444-8444-444444444444";
    const idempotencyKey = `organization-export:${jobId}`;
    const validDeadLetterId = `${testEnv.JOBS_DLQ_NAME}:retryable-export`;
    const invalidDeadLetterId = `${testEnv.JOBS_DLQ_NAME}:invalid-payload`;
    const now = "2026-08-06T18:00:00.000Z";
    await runInDurableObject(
      testEnv.ORGANIZATION_STORE.get(testEnv.ORGANIZATION_STORE.idFromName("organization-alpha")),
      (_instance, state) => {
        state.storage.sql.exec(
          `INSERT INTO organization_metadata
            (organization_id, name, slug, lifecycle_state, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?)`,
          "organization-alpha",
          "Organization Alpha",
          "alpha",
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO organization_exports
            (id, format, status, actor_type, actor_user_id, request_id, error_code,
             created_at, updated_at)
           VALUES (?, 'json', 'failed', 'organization_member', ?, ?, ?, ?, ?)`,
          jobId,
          "user-invited-member",
          "55555555-5555-4555-8555-555555555555",
          "queue_dead_lettered",
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO scheduled_job_outbox
            (job_id, kind, idempotency_key, due_at, created_at, enqueued_at)
           VALUES (?, 'organization_export', ?, ?, ?, ?)`,
          jobId,
          idempotencyKey,
          now,
          now,
          now,
        );
        state.storage.sql.exec(
          `INSERT INTO job_ledger
            (idempotency_key, job_id, kind, status, attempt, retry_count,
             claimed_at, failed_at, terminal_at, last_error_code)
           VALUES (?, ?, 'organization_export', 'failed', 1, 1, ?, ?, ?, 'queue_dead_lettered')`,
          idempotencyKey,
          jobId,
          now,
          now,
          now,
        );
      },
    );
    await testEnv.CONTROL_DB.batch([
      testEnv.CONTROL_DB.prepare(
        `INSERT INTO job_dead_letters
          (id, queue_name, message_id, message_valid, observed_attempt,
           organization_id, job_id, job_kind, idempotency_key,
           first_seen_at, last_seen_at, observation_count)
         VALUES (?, ?, ?, 1, 2, ?, ?, 'organization_export', ?, ?, ?, 1)`,
      ).bind(
        validDeadLetterId,
        testEnv.JOBS_DLQ_NAME,
        "retryable-export",
        "organization-alpha",
        jobId,
        idempotencyKey,
        now,
        now,
      ),
      testEnv.CONTROL_DB.prepare(
        `INSERT INTO job_dead_letters
          (id, queue_name, message_id, message_valid, observed_attempt,
           organization_id, job_id, job_kind, idempotency_key,
           first_seen_at, last_seen_at, observation_count)
         VALUES (?, ?, ?, 0, 2, NULL, NULL, NULL, NULL, ?, ?, 1)`,
      ).bind(invalidDeadLetterId, testEnv.JOBS_DLQ_NAME, "invalid-payload", now, now),
    ]);
    let sourceSnapshot:
      | {
          readonly exportStatus: string;
          readonly jobKind: string;
          readonly jobStatus: string;
          readonly outboxKey: string;
        }
      | undefined;
    await runInDurableObject(
      testEnv.ORGANIZATION_STORE.get(testEnv.ORGANIZATION_STORE.idFromName("organization-alpha")),
      (_instance, state) => {
        sourceSnapshot = state.storage.sql
          .exec<{
            readonly exportStatus: string;
            readonly jobKind: string;
            readonly jobStatus: string;
            readonly outboxKey: string;
          }>(
            `SELECT e.status AS exportStatus, l.kind AS jobKind, l.status AS jobStatus,
              o.idempotency_key AS outboxKey
             FROM organization_exports e
             JOIN job_ledger l ON l.job_id = e.id
             JOIN scheduled_job_outbox o ON o.job_id = e.id
             WHERE e.id = ?`,
            jobId,
          )
          .toArray()
          .at(0);
      },
    );
    expect(sourceSnapshot).toEqual({
      exportStatus: "failed",
      jobKind: "organization_export",
      jobStatus: "failed",
      outboxKey: idempotencyKey,
    });

    const retryResponse = await fetchWorker(
      authRequest(`/api/platform/job-dead-letters/${encodeURIComponent(validDeadLetterId)}/retry`, {
        body: JSON.stringify({ reason: "Export source was repaired; retrying once." }),
        headers: { cookie: sessionCookie },
        method: "POST",
      }),
    );
    expect(retryResponse.status, await retryResponse.clone().text()).toBe(202);
    expect(
      platformJobDeadLetterActionResponseSchema.parse(await retryResponse.json()),
    ).toMatchObject({
      actionStatus: "retry_queued",
      deadLetterId: validDeadLetterId,
      retryAttempt: 1,
    });

    const dismissResponse = await fetchWorker(
      authRequest(
        `/api/platform/job-dead-letters/${encodeURIComponent(invalidDeadLetterId)}/dismiss`,
        {
          body: JSON.stringify({ reason: "Invalid payload reviewed and no source job exists." }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
      ),
    );
    expect(dismissResponse.status).toBe(200);
    expect(
      platformJobDeadLetterActionResponseSchema.parse(await dismissResponse.json()),
    ).toMatchObject({
      actionStatus: "dismissed",
      deadLetterId: invalidDeadLetterId,
    });

    const duplicateDismissResponse = await fetchWorker(
      authRequest(
        `/api/platform/job-dead-letters/${encodeURIComponent(invalidDeadLetterId)}/dismiss`,
        {
          body: JSON.stringify({ reason: "Repeated dismissal remains idempotent." }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
      ),
    );
    expect(duplicateDismissResponse.status).toBe(200);
    expect(
      platformJobDeadLetterActionResponseSchema.parse(await duplicateDismissResponse.json()),
    ).toMatchObject({
      actionStatus: "dismissed",
      deadLetterId: invalidDeadLetterId,
    });

    const openResponse = await fetchWorker(
      authRequest("/api/platform/job-dead-letters", { headers: { cookie: sessionCookie } }),
    );
    expect(platformJobDeadLettersResponseSchema.parse(await openResponse.json())).toMatchObject({
      deadLetters: [{ actionStatus: "retry_queued", id: validDeadLetterId }],
    });
    const allResponse = await fetchWorker(
      authRequest("/api/platform/job-dead-letters?view=all", {
        headers: { cookie: sessionCookie },
      }),
    );
    expect(
      platformJobDeadLettersResponseSchema.parse(await allResponse.json()).deadLetters,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionStatus: "dismissed", id: invalidDeadLetterId }),
        expect.objectContaining({ actionStatus: "retry_queued", id: validDeadLetterId }),
      ]),
    );
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT COUNT(*) AS count FROM platform_audit_events
         WHERE target_type = 'job_dead_letter' AND target_id IN (?, ?)`,
      )
        .bind(validDeadLetterId, invalidDeadLetterId)
        .first<{ count: number }>(),
    ).resolves.toEqual({ count: 3 });
  });
});
