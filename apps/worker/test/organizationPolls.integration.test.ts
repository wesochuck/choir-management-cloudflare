import { organizationPollSummariesResponseSchema } from "@choir/contracts";
import { env, exports } from "cloudflare:workers";
import {
  organizationRequest,
  readEmailOneTimeCode,
  signInWithOtp,
  writeJson,
} from "@choir/testkit";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readCapturedPlatformEmailsForTest } from "../src/auth/platformEmail";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  requireIntegrationBinding,
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";

const USER_EMAIL = "calendar.manager@example.test";

const database = requireIntegrationBinding(env.CONTROL_DB, "CONTROL_DB");
const stores = requireIntegrationBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

const api = organizationRequest;

const signIn = () =>
  signInWithOtp(exports.default, "alpha.localhost", USER_EMAIL, (email) =>
    readEmailOneTimeCode(readCapturedPlatformEmailsForTest(), email),
  );

const post = (host: string, path: string, cookie: string, body: unknown) =>
  writeJson(exports.default, host, path, cookie, body);

beforeEach(async () => {
  await setupOrganizationIntegration(database, stores, {
    displayName: "Calendar Manager",
    email: USER_EMAIL,
    organizations: [
      { id: "organization-alpha", name: "Organization Alpha", slug: "alpha" },
      { id: "organization-bravo", name: "Organization Bravo", slug: "bravo" },
    ],
    userId: "calendar-manager",
  });
});

afterEach(async () => {
  await teardownOrganizationIntegration();
});

describe("Organization polls integration", () => {
  it("manages Organization polls and issues recipient-scoped poll tokens", async () => {
    const cookie = await signIn();
    const stub = stores.get(stores.idFromName("organization-alpha"));
    const profileId = crypto.randomUUID();
    const pollId = crypto.randomUUID();
    const pollOptionIds = [crypto.randomUUID(), crypto.randomUUID()] as const;
    const createdPollId = crypto.randomUUID();
    const createdOptionIds = [crypto.randomUUID(), crypto.randomUUID()] as const;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1_000).toISOString();
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO profiles (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        profileId,
        "Poll Recipient",
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO polls
          (id, title, description, multiple_choice, expires_at, archived_at,
           created_by, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, '', ?, ?, ?)`,
        pollId,
        "Initial question",
        "Choose one",
        expiresAt,
        "calendar-manager",
        now,
        now,
      );
      state.storage.sql.exec(
        "INSERT INTO poll_options (id, poll_id, label, sort_order) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
        pollOptionIds[0],
        pollId,
        "First",
        0,
        pollOptionIds[1],
        pollId,
        "Second",
        1,
      );
      return null;
    });

    const list = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/polls", cookie),
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      polls: [expect.objectContaining({ id: pollId, title: "Initial question" })],
    });

    const detail = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/polls/${pollId}`, cookie),
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      id: pollId,
      options: [
        { id: pollOptionIds[0], label: "First" },
        { id: pollOptionIds[1], label: "Second" },
      ],
      title: "Initial question",
    });

    const tokenResponse = await post("alpha.localhost", "/api/organization/poll-tokens", cookie, {
      pollId,
      profileIds: [profileId],
    });
    expect(tokenResponse.status).toBe(200);
    expect(await tokenResponse.json()).toMatchObject({
      tokens: { [profileId]: expect.any(String) },
    });

    const created = await post("alpha.localhost", "/api/organization/polls", cookie, {
      description: "Created through the route",
      expiresAt,
      id: createdPollId,
      multipleChoice: true,
      options: [
        { id: createdOptionIds[0], label: "Yes", sortOrder: 0 },
        { id: createdOptionIds[1], label: "No", sortOrder: 1 },
      ],
      title: "Created question",
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ id: createdPollId, title: "Created question" });

    const updated = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/polls/${createdPollId}`, cookie, {
        body: JSON.stringify({
          description: "Updated through the route",
          expiresAt,
          multipleChoice: true,
          options: [
            { id: createdOptionIds[0], label: "Absolutely", sortOrder: 0 },
            { id: createdOptionIds[1], label: "Not yet", sortOrder: 1 },
          ],
          title: "Updated question",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      description: "Updated through the route",
      title: "Updated question",
    });

    const archive = await post(
      "alpha.localhost",
      `/api/organization/polls/${pollId}/archive`,
      cookie,
      {},
    );
    expect(archive.status).toBe(200);
    expect(await archive.json()).toMatchObject({ id: pollId, archivedAt: expect.any(String) });

    const archived = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/polls?archived=true", cookie),
    );
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({
      polls: [expect.objectContaining({ id: pollId, title: "Initial question" })],
    });

    // Record response on createdPollId
    await runInDurableObject<OrganizationStore, null>(stub, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO poll_responses (poll_id, profile_id, option_ids, profile_name, responded_at)
         VALUES (?, ?, ?, 'Poll Recipient', ?)`,
        createdPollId,
        profileId,
        JSON.stringify([createdOptionIds[0]]),
        now,
      );
      return null;
    });

    // Verify option tallies on list endpoint
    const listWithTallies = await exports.default.fetch(
      api("alpha.localhost", "/api/organization/polls", cookie),
    );
    expect(listWithTallies.status).toBe(200);
    const listData = organizationPollSummariesResponseSchema.parse(await listWithTallies.json());
    const createdPollSummary = listData.polls.find((p) => p.id === createdPollId);
    expect(createdPollSummary).toBeDefined();
    expect(createdPollSummary?.optionTallies).toEqual([
      expect.objectContaining({ count: 1, id: createdOptionIds[0] }),
      expect.objectContaining({ count: 0, id: createdOptionIds[1] }),
    ]);

    // Verify results endpoint
    const resultsResponse = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/polls/${createdPollId}/results`, cookie),
    );
    expect(resultsResponse.status).toBe(200);
    const resultsJson = await resultsResponse.json();
    expect(resultsJson).toMatchObject({
      pollId: createdPollId,
      title: "Updated question",
      totalResponses: 1,
      options: [
        expect.objectContaining({
          count: 1,
          id: createdOptionIds[0],
          percentage: 100,
          respondents: [
            expect.objectContaining({
              profileId,
              profileName: "Poll Recipient",
            }),
          ],
        }),
        expect.objectContaining({
          count: 0,
          id: createdOptionIds[1],
          percentage: 0,
          respondents: [],
        }),
      ],
    });

    // Verify updating options is rejected now that responses exist
    const invalidOptionUpdate = await exports.default.fetch(
      api("alpha.localhost", `/api/organization/polls/${createdPollId}`, cookie, {
        body: JSON.stringify({
          description: "Trying to remove options",
          expiresAt,
          multipleChoice: true,
          options: [
            { id: createdOptionIds[0], label: "Only one option", sortOrder: 0 },
            { id: crypto.randomUUID(), label: "New brand option", sortOrder: 1 },
          ],
          title: "Updated question",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
    );
    expect(invalidOptionUpdate.status).toBe(400);
  });
});
