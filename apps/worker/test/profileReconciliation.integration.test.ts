import {
  organizationProfileResponseSchema,
  organizationProfilesResponseSchema,
  problemDetailsSchema,
  profileReconciliationCandidatesResponseSchema,
  profileReconciliationPreviewResponseSchema,
  profileReconciliationResponseSchema,
} from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  provisionOrganization,
  readEmailOneTimeCode,
  seedAuthUser,
  signInWithOtp,
} from "@choir/testkit";
import { applyD1Migrations, reset } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  clearCapturedPlatformEmailsForTest,
  readCapturedPlatformEmailsForTest,
} from "../src/auth/platformEmail";
import { repairPendingProfileReconciliations } from "../src/control/profileReconciliationService";
import { organizationStoreStub } from "../src/organization/rpc/client";

const ADMIN_EMAIL = "admin.reconcile@example.test";
const SINGER_EMAIL = "singer.reconcile@example.test";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const apiRequest = (hostname: string, path: string, cookie?: string, init?: RequestInit) =>
  organizationRequest(hostname, path, cookie, init);

const fetchWorker = (request: Request) => exports.default.fetch(request);

const signInAdmin = () =>
  signInWithOtp(exports.default, "alpha.localhost", ADMIN_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

const signInMember = () =>
  signInWithOtp(exports.default, "alpha.localhost", SINGER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
  clearCapturedPlatformEmailsForTest();
  await seedAuthUser(controlDatabase, "user-admin", ADMIN_EMAIL, "Admin Reconcile");
  await seedAuthUser(controlDatabase, "user-singer", SINGER_EMAIL, "Singer Reconcile");
  await provisionOrganization(controlDatabase, organizationStore, {
    id: "organization-alpha",
    name: "Organization Alpha",
    role: "admin",
    slug: "alpha",
    userId: "user-admin",
  });
  await controlDatabase
    .prepare(
      `INSERT INTO member (id, organizationId, userId, role, createdAt)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind("member-singer-initial", "organization-alpha", "user-singer", "member", Date.now())
    .run();
});

afterEach(async () => {
  await reset();
});

describe("Profile Reconciliation Integration", () => {
  it("executes full profile reconciliation workflow from preview to consolidation", async () => {
    const adminCookie = await signInAdmin();
    const now = Date.now();

    // 1. Create target profile via API (historical Jane Smith)
    const createTargetRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Jane Smith",
          doNotEmail: false,
          globalStatus: "Active",
          notes: "Historical notes",
          phone: "555-0100",
          showInDirectory: true,
          voicePart: "Alto 1",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(createTargetRes.status).toBe(201);
    const createdTarget = organizationProfileResponseSchema.parse(await createTargetRes.json());

    // 2. Create source profile via API (signup duplicate Jane Smith)
    const createSourceRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Jane Smith",
          doNotEmail: false,
          globalStatus: "Active",
          notes: "Duplicate signup notes",
          phone: "555-0199",
          showInDirectory: true,
          voicePart: "Alto 1",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(createSourceRes.status).toBe(201);
    const createdSource = organizationProfileResponseSchema.parse(await createSourceRes.json());

    // 3. Seed user & membership for Jane Smith in D1, linked to createdSource.id
    const janeEmail = "jane.smith.test@example.test";
    await seedAuthUser(controlDatabase, "user-jane", janeEmail, "Jane Smith");
    const membershipId = "mem-jane-1";
    await controlDatabase
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, profileId, createdAt)
         VALUES (?, 'organization-alpha', 'user-jane', 'member', ?, ?)`,
      )
      .bind(membershipId, createdSource.id, now)
      .run();

    // 4. Fetch candidates for Jane's membership
    const candidatesRes = await fetchWorker(
      apiRequest(
        "alpha.localhost",
        `/api/organization/profile-reconciliations/candidates?membershipId=${membershipId}`,
        adminCookie,
      ),
    );
    expect(candidatesRes.status).toBe(200);
    const candidatesData = profileReconciliationCandidatesResponseSchema.parse(
      await candidatesRes.json(),
    );
    expect(candidatesData.candidates.some((c) => c.id === createdTarget.id)).toBe(true);

    // 5. Request Preview
    const previewRes = await fetchWorker(
      apiRequest(
        "alpha.localhost",
        "/api/organization/profile-reconciliations/preview",
        adminCookie,
        {
          body: JSON.stringify({
            membershipId,
            targetProfileId: createdTarget.id,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      ),
    );
    expect(previewRes.status).toBe(200);
    const previewData = profileReconciliationPreviewResponseSchema.parse(await previewRes.json());
    expect(previewData.canReconcile).toBe(true);
    expect(previewData.sourceProfile.id).toBe(createdSource.id);
    expect(previewData.targetProfile.id).toBe(createdTarget.id);
    expect(previewData.conflictInventory.transferCounts).toBeDefined();

    // 6. Execute Reconciliation with fresh revision
    const idempotencyKey = "rec-idem-test-123456";
    const executeRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profile-reconciliations", adminCookie, {
        body: JSON.stringify({
          confirmedSamePerson: true,
          expectedSourceProfileId: createdSource.id,
          fieldChoices: {
            notes: "keep_target",
            phone: "overwrite_with_source",
          },
          idempotencyKey,
          membershipId,
          previewRevision: previewData.previewRevision,
          targetProfileId: createdTarget.id,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(executeRes.status).toBe(200);
    const executeData = profileReconciliationResponseSchema.parse(await executeRes.json());
    expect(executeData.status).toBe("completed");
    expect(executeData.canonicalProfileId).toBe(createdTarget.id);

    // Verify D1 Membership now points to targetProfileId
    const updatedMember = await controlDatabase
      .prepare("SELECT profileId FROM member WHERE id = ?")
      .bind(membershipId)
      .first<{ profileId: string }>();
    expect(updatedMember?.profileId).toBe(createdTarget.id);

    // Verify Roster list omits retired source profile or marks it hidden
    const rosterRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie),
    );
    expect(rosterRes.status).toBe(200);
    const rosterData = organizationProfilesResponseSchema.parse(await rosterRes.json());
    expect(rosterData.profiles.some((p) => p.id === createdTarget.id)).toBe(true);
    const sourceInRoster = rosterData.profiles.find((p) => p.id === createdSource.id);
    expect(sourceInRoster?.hidden).toBe(true);

    // 7. Idempotency test: replaying identical execution payload succeeds
    const replayRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profile-reconciliations", adminCookie, {
        body: JSON.stringify({
          confirmedSamePerson: true,
          expectedSourceProfileId: createdSource.id,
          fieldChoices: {
            notes: "keep_target",
            phone: "overwrite_with_source",
          },
          idempotencyKey,
          membershipId,
          previewRevision: previewData.previewRevision,
          targetProfileId: createdTarget.id,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(replayRes.status).toBe(200);
    const replayData = profileReconciliationResponseSchema.parse(await replayRes.json());
    expect(replayData.status).toBe("completed");

    // 8. Replay with SAME idempotency key but DIFFERENT targetProfileId rejects with 409
    const conflictRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profile-reconciliations", adminCookie, {
        body: JSON.stringify({
          confirmedSamePerson: true,
          expectedSourceProfileId: createdSource.id,
          fieldChoices: {
            notes: "keep_target",
            phone: "overwrite_with_source",
          },
          idempotencyKey,
          membershipId,
          previewRevision: previewData.previewRevision,
          targetProfileId: "33333333-3333-4333-8333-333333333333",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(conflictRes.status).toBe(409);

    // 9. Authorization test: ordinary member is forbidden
    const memberCookie = await signInMember();
    const memberForbiddenRes = await fetchWorker(
      apiRequest(
        "alpha.localhost",
        "/api/organization/profile-reconciliations/preview",
        memberCookie,
        {
          body: JSON.stringify({
            membershipId,
            targetProfileId: createdTarget.id,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      ),
    );
    expect(memberForbiddenRes.status).toBe(403);
  });

  it("rejects execution with stale previewRevision", async () => {
    const adminCookie = await signInAdmin();
    const now = Date.now();

    const createTargetRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Bob Stone",
          doNotEmail: false,
          globalStatus: "Active",
          notes: "",
          phone: "",
          showInDirectory: true,
          voicePart: "Bass 1",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const target = organizationProfileResponseSchema.parse(await createTargetRes.json());

    const createSourceRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Bob Stone",
          doNotEmail: false,
          globalStatus: "Active",
          notes: "",
          phone: "",
          showInDirectory: true,
          voicePart: "Bass 1",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const source = organizationProfileResponseSchema.parse(await createSourceRes.json());

    await seedAuthUser(controlDatabase, "user-bob", "bob@example.test", "Bob Stone");
    const membershipId = "mem-bob-1";
    await controlDatabase
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, profileId, createdAt)
         VALUES (?, 'organization-alpha', 'user-bob', 'member', ?, ?)`,
      )
      .bind(membershipId, source.id, now)
      .run();

    const staleExecuteRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profile-reconciliations", adminCookie, {
        body: JSON.stringify({
          confirmedSamePerson: true,
          expectedSourceProfileId: source.id,
          fieldChoices: {
            notes: "keep_target",
            phone: "keep_target",
          },
          idempotencyKey: "rec-stale-key-12345",
          membershipId,
          previewRevision: "rev-outdated-timestamp",
          targetProfileId: target.id,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(staleExecuteRes.status).toBe(409);
    const errJson = problemDetailsSchema.parse(await staleExecuteRes.json());
    expect(errJson.code).toBe("conflict");
    expect(errJson.message).toContain("modified after the reconciliation preview was generated");
  });

  it("blocks preview when target profile is already linked to another active membership", async () => {
    const adminCookie = await signInAdmin();
    const now = Date.now();

    const createTargetRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Charlie Day",
          doNotEmail: false,
          globalStatus: "Active",
          notes: "",
          phone: "",
          showInDirectory: true,
          voicePart: "Tenor 1",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const target = organizationProfileResponseSchema.parse(await createTargetRes.json());

    const createSourceRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Charlie Day",
          doNotEmail: false,
          globalStatus: "Active",
          notes: "",
          phone: "",
          showInDirectory: true,
          voicePart: "Tenor 1",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const source = organizationProfileResponseSchema.parse(await createSourceRes.json());

    // Link target to another member
    await seedAuthUser(
      controlDatabase,
      "user-charlie-holder",
      "charlie.holder@example.test",
      "Charlie Holder",
    );
    await controlDatabase
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, profileId, createdAt)
         VALUES ('mem-target-holder', 'organization-alpha', 'user-charlie-holder', 'member', ?, ?)`,
      )
      .bind(target.id, now)
      .run();

    // Link source to Charlie's membership
    await seedAuthUser(controlDatabase, "user-charlie", "charlie@example.test", "Charlie Day");
    const membershipId = "mem-charlie";
    await controlDatabase
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, profileId, createdAt)
         VALUES (?, 'organization-alpha', 'user-charlie', 'member', ?, ?)`,
      )
      .bind(membershipId, source.id, now)
      .run();

    const previewRes = await fetchWorker(
      apiRequest(
        "alpha.localhost",
        "/api/organization/profile-reconciliations/preview",
        adminCookie,
        {
          body: JSON.stringify({
            membershipId,
            targetProfileId: target.id,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      ),
    );
    expect(previewRes.status).toBe(200);
    const previewData = profileReconciliationPreviewResponseSchema.parse(await previewRes.json());
    expect(previewData.canReconcile).toBe(false);
    expect(previewData.status).toBe("blocked");
    expect(
      previewData.conflictInventory.blockers.some((b) =>
        b.includes("Target profile is already linked to another active Membership"),
      ),
    ).toBe(true);
  });

  it("rejects preview when target profile belongs to another organization", async () => {
    const adminCookie = await signInAdmin();

    // Create source profile in alpha
    const createSourceRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Cross Tenant Singer",
          doNotEmail: false,
          globalStatus: "Active",
          notes: "",
          phone: "",
          showInDirectory: true,
          voicePart: "Soprano 1",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const source = organizationProfileResponseSchema.parse(await createSourceRes.json());
    await controlDatabase
      .prepare("UPDATE member SET profileId = ? WHERE id = 'member-singer-initial'")
      .bind(source.id)
      .run();

    // Random UUID not belonging to organization alpha
    const foreignProfileId = "44444444-4444-4444-8444-444444444444";
    const previewRes = await fetchWorker(
      apiRequest(
        "alpha.localhost",
        "/api/organization/profile-reconciliations/preview",
        adminCookie,
        {
          body: JSON.stringify({
            membershipId: "member-singer-initial",
            targetProfileId: foreignProfileId,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      ),
    );
    expect(previewRes.status).toBe(404);
  });

  it("discovers candidate duplicate profiles matching exact name and voice part", async () => {
    const adminCookie = await signInAdmin();

    // Create target candidate profile
    const createTargetRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Candidate Person",
          doNotEmail: false,
          globalStatus: "Active",
          notes: "Historical unlinked",
          phone: "555-4321",
          showInDirectory: true,
          voicePart: "Tenor 1",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const target = organizationProfileResponseSchema.parse(await createTargetRes.json());

    // Create source profile
    const createSourceRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Candidate Person",
          doNotEmail: false,
          globalStatus: "Active",
          notes: "New signup",
          phone: "555-4321",
          showInDirectory: true,
          voicePart: "Tenor 1",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const source = organizationProfileResponseSchema.parse(await createSourceRes.json());
    await controlDatabase
      .prepare("UPDATE member SET profileId = ? WHERE id = 'member-singer-initial'")
      .bind(source.id)
      .run();

    const candidatesRes = await fetchWorker(
      apiRequest(
        "alpha.localhost",
        "/api/organization/profile-reconciliations/candidates?membershipId=member-singer-initial",
        adminCookie,
      ),
    );
    expect(candidatesRes.status).toBe(200);
    const candidatesData = profileReconciliationCandidatesResponseSchema.parse(
      await candidatesRes.json(),
    );
    const matchedCandidate = candidatesData.candidates.find((c) => c.id === target.id);
    expect(matchedCandidate).toBeDefined();
    expect(matchedCandidate?.displayName).toBe("Candidate Person");
    expect(matchedCandidate?.voicePart).toBe("T1");
  });

  it("safely resolves dues and poll collisions without database errors", async () => {
    const adminCookie = await signInAdmin();
    const now = Date.now();

    const createTargetRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Collision Tester",
          doNotEmail: false,
          globalStatus: "Active",
          notes: "Target notes",
          phone: "555-1001",
          showInDirectory: true,
          voicePart: "Bass 1",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const target = organizationProfileResponseSchema.parse(await createTargetRes.json());

    const createSourceRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Collision Tester",
          doNotEmail: false,
          globalStatus: "Active",
          notes: "Source notes",
          phone: "555-1002",
          showInDirectory: true,
          voicePart: "Bass 1",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const source = organizationProfileResponseSchema.parse(await createSourceRes.json());

    await seedAuthUser(
      controlDatabase,
      "user-collision",
      "collision@example.test",
      "Collision Tester",
    );
    const membershipId = "mem-collision";
    await controlDatabase
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, profileId, createdAt)
         VALUES (?, 'organization-alpha', 'user-collision', 'member', ?, ?)`,
      )
      .bind(membershipId, source.id, now)
      .run();

    const previewRes = await fetchWorker(
      apiRequest(
        "alpha.localhost",
        "/api/organization/profile-reconciliations/preview",
        adminCookie,
        {
          body: JSON.stringify({
            membershipId,
            targetProfileId: target.id,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      ),
    );
    expect(previewRes.status).toBe(200);
    const previewData = profileReconciliationPreviewResponseSchema.parse(await previewRes.json());
    expect(previewData.canReconcile).toBe(true);

    const executeRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profile-reconciliations", adminCookie, {
        body: JSON.stringify({
          confirmedSamePerson: true,
          expectedSourceProfileId: source.id,
          fieldChoices: { notes: "append_source", phone: "keep_target" },
          idempotencyKey: "test-rec-collision-key",
          membershipId,
          previewRevision: previewData.previewRevision,
          targetProfileId: target.id,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(executeRes.status).toBe(200);
    const executeData = profileReconciliationResponseSchema.parse(await executeRes.json());
    expect(executeData.status).toBe("completed");
    expect(executeData.canonicalProfileId).toBe(target.id);
  });

  it("recovers from needs_repair state using repairPendingProfileReconciliations", async () => {
    const adminCookie = await signInAdmin();
    const now = Date.now();

    const createTargetRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Repair Person",
          doNotEmail: false,
          globalStatus: "Active",
          notes: "",
          phone: "",
          showInDirectory: true,
          voicePart: "Tenor 2",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const target = organizationProfileResponseSchema.parse(await createTargetRes.json());

    const createSourceRes = await fetchWorker(
      apiRequest("alpha.localhost", "/api/organization/profiles", adminCookie, {
        body: JSON.stringify({
          displayName: "Repair Person",
          doNotEmail: false,
          globalStatus: "Active",
          notes: "",
          phone: "",
          showInDirectory: true,
          voicePart: "Tenor 2",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const source = organizationProfileResponseSchema.parse(await createSourceRes.json());

    await seedAuthUser(controlDatabase, "user-repair", "repair@example.test", "Repair Person");
    const membershipId = "mem-repair-candidate";
    await controlDatabase
      .prepare(
        `INSERT INTO member (id, organizationId, userId, role, profileId, createdAt)
         VALUES (?, 'organization-alpha', 'user-repair', 'member', ?, ?)`,
      )
      .bind(membershipId, source.id, now)
      .run();

    const previewRes = await fetchWorker(
      apiRequest(
        "alpha.localhost",
        "/api/organization/profile-reconciliations/preview",
        adminCookie,
        {
          body: JSON.stringify({
            membershipId,
            targetProfileId: target.id,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      ),
    );
    expect(previewRes.status).toBe(200);
    const previewData = profileReconciliationPreviewResponseSchema.parse(await previewRes.json());
    expect(previewData.canReconcile).toBe(true);

    // Prepare DO profile reconciliation record so it's prepared
    const stub = organizationStoreStub(env, "organization-alpha");
    const recId = "rec-repair-job-test";
    await stub.prepareProfileReconciliation({
      actorUserId: "user-admin",
      expectedSourceProfileId: source.id,
      fieldChoices: { notes: "keep_target", phone: "keep_target" },
      idempotencyKey: "idem-repair-key",
      membershipId,
      organizationId: "organization-alpha",
      previewRevision: previewData.previewRevision,
      reconciliationId: recId,
      requestId: "req-prepare-1",
      targetProfileId: target.id,
    });

    // Membership was relinked in D1
    await controlDatabase
      .prepare("UPDATE member SET profileId = ? WHERE id = ?")
      .bind(target.id, membershipId)
      .run();

    await controlDatabase
      .prepare(
        `INSERT INTO organization_profile_reconciliations
          (id, organization_id, membership_id, source_profile_id, target_profile_id,
           idempotency_key, state, preview_revision, request_digest, actor_user_id,
           field_choices_json, created_at, updated_at)
         VALUES (?, 'organization-alpha', ?, ?, ?, 'idem-repair-key', 'needs_repair', ?, 'digest', 'user-admin', ?, ?, ?)`,
      )
      .bind(
        recId,
        membershipId,
        source.id,
        target.id,
        previewData.previewRevision,
        JSON.stringify({ notes: "keep_target", phone: "keep_target" }),
        now,
        now,
      )
      .run();

    const repairResult = await repairPendingProfileReconciliations(env);
    expect(repairResult.repaired).toBe(1);

    const recRow = await controlDatabase
      .prepare("SELECT state FROM organization_profile_reconciliations WHERE id = ?")
      .bind(recId)
      .first<{ state: string }>();
    expect(recRow?.state).toBe("completed");
  });
});
