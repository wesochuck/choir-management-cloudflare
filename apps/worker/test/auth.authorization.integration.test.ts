import {
  organizationAuthStatusResponseSchema,
  organizationContextResponseSchema,
  organizationMfaPolicyResponseSchema,
  organizationMfaVerificationResponseSchema,
  organizationMembershipsResponseSchema,
  organizationProfileLinkResponseSchema,
  publicDomainResponseSchema,
} from "@choir/contracts";
import { introspectWorkflow, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  setupAuthIntegration,
  teardownAuthIntegration,
  ALPHA_AUTH_ORIGIN,
  INVITED_EMAIL,
  testEnv,
  enrollmentResponseSchema,
  authRequest,
  generateTotp,
  fetchWorker,
  seedInvitedUser,
  seedOrganizations,
  signInInvitedUser,
} from "./auth.integration.fixture";
beforeEach(async () => setupAuthIntegration());
afterEach(async () => teardownAuthIntegration());

describe("host-derived Organization authorization", () => {
  it("ignores client-supplied Organization IDs and returns the host Organization", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    const response = await fetchWorker(
      new Request(
        "http://alpha.localhost/api/organization/context?organizationId=organization-bravo",
        {
          headers: {
            cookie: sessionCookie,
            origin: ALPHA_AUTH_ORIGIN,
            "x-organization-id": "organization-bravo",
          },
        },
      ),
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(organizationContextResponseSchema.parse(body)).toMatchObject({
      organizationId: "organization-alpha",
      role: "administrator",
      userId: "user-invited-member",
    });
  });

  it("rejects a membership that belongs only to another Organization", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    const response = await fetchWorker(
      new Request("http://bravo.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: "http://bravo.localhost" },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "forbidden" });
  });

  it("treats KV routing as a hint and confirms a poisoned entry against D1", async () => {
    await seedInvitedUser();
    await seedOrganizations(true);
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    await testEnv.ROUTING_CACHE.put(
      "host:alpha.localhost",
      JSON.stringify({
        organizationId: "organization-bravo",
        routeKind: "canonical",
        routingVersion: 1,
      }),
    );

    const response = await fetchWorker(
      new Request("http://alpha.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: ALPHA_AUTH_ORIGIN },
      }),
    );
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(organizationContextResponseSchema.parse(body).organizationId).toBe("organization-alpha");
  });

  it("supports multi-Organization selection without allowing it to select tenant storage", async () => {
    await seedInvitedUser();
    await seedOrganizations(true);
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    const listResponse = await fetchWorker(
      authRequest(
        "/api/auth/organization/list",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(listResponse.status).toBe(200);
    const organizations = z
      .array(z.object({ id: z.string(), slug: z.string() }))
      .parse(await listResponse.json());
    expect(new Set(organizations.map((organization) => organization.slug))).toEqual(
      new Set(["alpha", "bravo"]),
    );

    const selectResponse = await fetchWorker(
      authRequest(
        "/api/auth/organization/set-active",
        {
          body: JSON.stringify({ organizationId: "organization-bravo" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(selectResponse.status).toBe(200);

    const contextResponse = await fetchWorker(
      new Request("http://alpha.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: ALPHA_AUTH_ORIGIN },
      }),
    );
    const context = organizationContextResponseSchema.parse(await contextResponse.json());
    expect(context.organizationId).toBe("organization-alpha");
  });

  it("enforces optional MFA per Organization and per session", async () => {
    await seedInvitedUser();
    await seedOrganizations(true);
    await testEnv.CONTROL_DB.prepare(
      "UPDATE member SET role = 'owner' WHERE organizationId = ? AND userId = ?",
    )
      .bind("organization-alpha", "user-invited-member")
      .run();
    let sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);

    const enableResponse = await fetchWorker(
      authRequest(
        "/api/auth/two-factor/enable",
        {
          body: JSON.stringify({}),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    const enrollment = enrollmentResponseSchema.parse(await enableResponse.json());
    const enrollmentResponse = await fetchWorker(
      authRequest(
        "/api/auth/two-factor/verify-totp",
        {
          body: JSON.stringify({
            code: await generateTotp(enrollment.totpURI),
            trustDevice: false,
          }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(enrollmentResponse.status).toBe(200);
    sessionCookie = enrollmentResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? sessionCookie;

    const initialStatusResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-status",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(
      organizationAuthStatusResponseSchema.parse(await initialStatusResponse.json()),
    ).toMatchObject({
      mfaRequired: false,
      mfaVerifiedUntil: null,
      organizationId: "organization-alpha",
      role: "owner",
      twoFactorEnabled: true,
      twoFactorVerified: true,
    });

    const policyResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-policy",
        {
          body: JSON.stringify({ mfaRequired: true }),
          headers: { cookie: sessionCookie },
          method: "PATCH",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(policyResponse.status).toBe(200);
    expect(organizationMfaPolicyResponseSchema.parse(await policyResponse.json())).toMatchObject({
      mfaRequired: true,
      organizationId: "organization-alpha",
    });

    const beforeVerification = await fetchWorker(
      new Request("http://alpha.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: ALPHA_AUTH_ORIGIN },
      }),
    );
    expect(beforeVerification.status).toBe(401);
    await expect(beforeVerification.json()).resolves.toMatchObject({
      message: "A recent Organization MFA verification is required.",
    });

    const verificationResponse = await fetchWorker(
      authRequest(
        "/api/organization/mfa/verify",
        {
          body: JSON.stringify({
            code: await generateTotp(enrollment.totpURI),
            method: "totp",
          }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(verificationResponse.status).toBe(200);
    expect(
      organizationMfaVerificationResponseSchema.parse(await verificationResponse.json()),
    ).toMatchObject({ organizationId: "organization-alpha", status: "verified" });

    const authorizedResponse = await fetchWorker(
      new Request("http://alpha.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: ALPHA_AUTH_ORIGIN },
      }),
    );
    expect(authorizedResponse.status).toBe(200);
    const verifiedStatusResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-status",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(
      organizationAuthStatusResponseSchema.parse(await verifiedStatusResponse.json())
        .mfaVerifiedUntil,
    ).not.toBeNull();

    await testEnv.CONTROL_DB.prepare(
      "UPDATE organizations SET mfa_required = 1 WHERE id = 'organization-bravo'",
    ).run();
    const otherOrganizationResponse = await fetchWorker(
      new Request("http://bravo.localhost/api/organization/context", {
        headers: { cookie: sessionCookie, origin: "http://bravo.localhost" },
      }),
    );
    expect(otherOrganizationResponse.status).toBe(401);
    const otherOrganizationStatusResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-status",
        { headers: { cookie: sessionCookie } },
        "http://bravo.localhost",
      ),
    );
    expect(
      organizationAuthStatusResponseSchema.parse(await otherOrganizationStatusResponse.json()),
    ).toMatchObject({
      mfaRequired: true,
      mfaVerifiedUntil: null,
      organizationId: "organization-bravo",
    });

    const secondSessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    const otherSessionResponse = await fetchWorker(
      new Request("http://alpha.localhost/api/organization/context", {
        headers: { cookie: secondSessionCookie, origin: ALPHA_AUTH_ORIGIN },
      }),
    );
    expect(otherSessionResponse.status).toBe(401);
    const otherSessionStatusResponse = await fetchWorker(
      authRequest(
        "/api/organization/auth-status",
        { headers: { cookie: secondSessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(
      organizationAuthStatusResponseSchema.parse(await otherSessionStatusResponse.json()),
    ).toMatchObject({ mfaVerifiedUntil: null, organizationId: "organization-alpha" });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT actor_user_id AS actorUserId, action
         FROM platform_audit_events
         WHERE organization_id = ? AND action = 'organization.auth_policy.updated'`,
      )
        .bind("organization-alpha")
        .first(),
    ).resolves.toEqual({
      action: "organization.auth_policy.updated",
      actorUserId: "user-invited-member",
    });
  });

  it("links a Membership only to a Profile in the host Organization store", async () => {
    await seedInvitedUser();
    await seedOrganizations();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    const alphaProfileId = "c9ea355d-8ac2-4dc4-af06-27828846dba8";
    const bravoProfileId = "0cd25a2b-71cc-4437-8524-2445074bbd18";
    const now = new Date().toISOString();

    const alphaObjectId = testEnv.ORGANIZATION_STORE.idFromName("organization-alpha");
    await runInDurableObject(testEnv.ORGANIZATION_STORE.get(alphaObjectId), (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        alphaProfileId,
        "Alpha Profile",
        now,
        now,
      );
    });
    const bravoObjectId = testEnv.ORGANIZATION_STORE.idFromName("organization-bravo");
    await runInDurableObject(testEnv.ORGANIZATION_STORE.get(bravoObjectId), (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO profiles (id, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        bravoProfileId,
        "Bravo Profile",
        now,
        now,
      );
    });

    const membershipsResponse = await fetchWorker(
      authRequest(
        "/api/organization/members",
        { headers: { cookie: sessionCookie } },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(membershipsResponse.status).toBe(200);
    expect(
      organizationMembershipsResponseSchema.parse(await membershipsResponse.json()),
    ).toMatchObject({
      memberships: [
        {
          email: INVITED_EMAIL,
          id: "member-alpha",
          profileId: null,
          role: "administrator",
        },
      ],
      truncated: false,
    });

    const linkResponse = await fetchWorker(
      authRequest(
        "/api/organization/members/member-alpha/profile",
        {
          body: JSON.stringify({ profileId: alphaProfileId }),
          headers: { cookie: sessionCookie },
          method: "PUT",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(linkResponse.status).toBe(200);
    expect(organizationProfileLinkResponseSchema.parse(await linkResponse.json())).toMatchObject({
      membershipId: "member-alpha",
      organizationId: "organization-alpha",
      profileId: alphaProfileId,
    });

    const crossOrganizationResponse = await fetchWorker(
      authRequest(
        "/api/organization/members/member-alpha/profile",
        {
          body: JSON.stringify({ profileId: bravoProfileId }),
          headers: { cookie: sessionCookie },
          method: "PUT",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(crossOrganizationResponse.status).toBe(404);
    await expect(
      testEnv.CONTROL_DB.prepare("SELECT profileId FROM member WHERE id = 'member-alpha'").first(),
    ).resolves.toEqual({ profileId: alphaProfileId });
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT actor_user_id AS actorUserId, action
         FROM platform_audit_events
         WHERE target_id = 'member-alpha'
           AND action = 'organization.membership.profile_linked'`,
      ).first(),
    ).resolves.toEqual({
      action: "organization.membership.profile_linked",
      actorUserId: "user-invited-member",
    });
  });

  it("registers Public Website Domains without exposing authenticated routes", async () => {
    await seedInvitedUser();
    await seedOrganizations(true);
    await testEnv.CONTROL_DB.prepare("UPDATE member SET role = 'owner' WHERE userId = ?")
      .bind("user-invited-member")
      .run();
    const sessionCookie = await signInInvitedUser(ALPHA_AUTH_ORIGIN);
    const workflowIntrospector = await introspectWorkflow(testEnv.CUSTOM_DOMAIN_WORKFLOW);

    const registrationResponse = await fetchWorker(
      authRequest(
        "/api/organization/public-domains",
        {
          body: JSON.stringify({ hostname: "Public.Example.Test." }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(registrationResponse.status).toBe(201);
    const domain = publicDomainResponseSchema.parse(await registrationResponse.json());
    expect(domain).toMatchObject({
      hostname: "public.example.test",
      organizationId: "organization-alpha",
      providerHostnameId: null,
      providerStatus: "not_configured",
      routingVersion: 1,
      status: "pending",
    });

    try {
      const instances = await workflowIntrospector.get();
      expect(instances).toHaveLength(1);
      const [instance] = instances;
      if (!instance) throw new Error("The custom-domain workflow instance was not created.");
      await instance.waitForStatus("complete");
    } finally {
      await workflowIntrospector.dispose();
    }

    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT status, provider_status AS providerStatus, provider_hostname_id AS providerHostnameId
         FROM organization_domains WHERE id = ?`,
      )
        .bind(domain.domainId)
        .first(),
    ).resolves.toEqual({
      providerHostnameId: "fake-public-example-test",
      providerStatus: "active",
      status: "active",
    });

    const productHostnameResponse = await fetchWorker(
      authRequest(
        "/api/organization/public-domains",
        {
          body: JSON.stringify({ hostname: "fake.alpha.localhost" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(productHostnameResponse.status).toBe(400);

    const ipAddressResponse = await fetchWorker(
      authRequest(
        "/api/organization/public-domains",
        {
          body: JSON.stringify({ hostname: "192.0.2.1" }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(ipAddressResponse.status).toBe(400);

    const crossOrganizationResponse = await fetchWorker(
      authRequest(
        "/api/organization/public-domains",
        {
          body: JSON.stringify({ hostname: domain.hostname }),
          headers: { cookie: sessionCookie },
          method: "POST",
        },
        "http://bravo.localhost",
      ),
    );
    expect(crossOrganizationResponse.status).toBe(409);

    const authOnPublicDomain = await fetchWorker(
      new Request(`http://${domain.hostname}/api/auth/get-session`, {
        headers: { origin: `http://${domain.hostname}` },
      }),
    );
    expect(authOnPublicDomain.status).toBe(404);
    const organizationRouteOnPublicDomain = await fetchWorker(
      new Request(`http://${domain.hostname}/api/organization/context`, {
        headers: { cookie: sessionCookie, origin: `http://${domain.hostname}` },
      }),
    );
    expect(organizationRouteOnPublicDomain.status).toBe(404);

    const disableResponse = await fetchWorker(
      authRequest(
        `/api/organization/public-domains/${domain.domainId}`,
        { headers: { cookie: sessionCookie }, method: "DELETE" },
        ALPHA_AUTH_ORIGIN,
      ),
    );
    expect(disableResponse.status).toBe(200);
    expect(publicDomainResponseSchema.parse(await disableResponse.json())).toMatchObject({
      routingVersion: 3,
      status: "disabled",
    });
    await expect(testEnv.ROUTING_CACHE.get(`host:${domain.hostname}`)).resolves.toBeNull();
    await expect(
      testEnv.CONTROL_DB.prepare(
        `SELECT COUNT(*) AS count FROM platform_audit_events
         WHERE target_id = ? AND action IN (
           'organization.public_domain.registered',
           'organization.public_domain.activated',
           'organization.public_domain.disabled'
         )`,
      )
        .bind(domain.domainId)
        .first(),
    ).resolves.toEqual({ count: 3 });
  });
});
