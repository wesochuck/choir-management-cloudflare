import { organizationPollRequestSchema, type OrganizationPollOption } from "@choir/contracts";
import { z } from "zod";

import type { DurableObjectStorage, SqlStorageValue } from "@cloudflare/workers-types";

const actorSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

function safeParseStringArray(value: unknown): string[] {
  if (!value || !Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

const managementRequestSchema = z.discriminatedUnion("action", [
  actorSchema.extend({
    action: z.literal("create_poll"),
    poll: organizationPollRequestSchema.extend({ id: z.uuid() }),
  }),
  actorSchema.extend({
    action: z.literal("update_poll"),
    poll: organizationPollRequestSchema.extend({ id: z.uuid() }),
  }),
  actorSchema.extend({
    action: z.literal("archive_poll"),
    pollId: z.uuid(),
  }),
  actorSchema.extend({
    action: z.literal("submit_poll_response"),
    pollId: z.uuid(),
    response: z.object({
      optionIds: z.array(z.uuid()).min(1).max(100),
      profileId: z.uuid(),
      profileName: z.string(),
    }),
  }),
]);

interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

function identityMatches(storage: DurableObjectStorage, organizationId: string | null): boolean {
  if (!organizationId) return false;
  const row = storage.sql
    .exec<IdentityRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  return row?.organizationId === organizationId;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isExpired(expiresAt: string): boolean {
  return expiresAt !== "" && Date.parse(expiresAt) <= Date.now();
}

interface PollRow {
  readonly [column: string]: SqlStorageValue;
  readonly archivedAt: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly description: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly multipleChoice: number;
  readonly title: string;
  readonly updatedAt: string;
}

export function listPollsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!identityMatches(storage, organizationId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const rows = storage.sql
    .exec<PollRow & { responseCount: number }>(
      `SELECT p.id, p.title, p.expires_at AS expiresAt, p.archived_at AS archivedAt,
              p.created_at AS createdAt,
              (SELECT COUNT(*) FROM poll_responses r WHERE r.poll_id = p.id) AS responseCount
       FROM polls p
       WHERE p.archived_at = ''
       ORDER BY p.created_at DESC`,
    )
    .toArray();
  return Response.json(rows);
}

export function listArchivedPollsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!identityMatches(storage, organizationId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const rows = storage.sql
    .exec<PollRow & { responseCount: number }>(
      `SELECT p.id, p.title, p.expires_at AS expiresAt, p.archived_at AS archivedAt,
              p.created_at AS createdAt,
              (SELECT COUNT(*) FROM poll_responses r WHERE r.poll_id = p.id) AS responseCount
       FROM polls p WHERE p.archived_at != ''
       ORDER BY p.created_at DESC`,
    )
    .toArray();
  return Response.json(rows);
}

export function readPollFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
  pollId: string | null,
): Response {
  if (!identityMatches(storage, organizationId) || !z.uuid().safeParse(pollId).success) {
    return Response.json({ code: "poll_not_found" }, { status: 404 });
  }
  const pollRow = storage.sql
    .exec<PollRow>(
      `SELECT id, title, description, multiple_choice AS multipleChoice,
              expires_at AS expiresAt, archived_at AS archivedAt,
              created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
       FROM polls WHERE id = ? LIMIT 1`,
      pollId,
    )
    .toArray()
    .at(0);
  if (!pollRow) {
    return Response.json({ code: "poll_not_found" }, { status: 404 });
  }
  const options = storage.sql
    .exec<OrganizationPollOption>(
      `SELECT id, label, sort_order AS sortOrder
       FROM poll_options WHERE poll_id = ? ORDER BY sort_order, id`,
      pollId,
    )
    .toArray();
  return Response.json({
    ...pollRow,
    multipleChoice: pollRow.multipleChoice === 1,
    options,
  });
}

export function readProfilePollFromStore(
  storage: DurableObjectStorage,
  input: {
    readonly pollId: string | null;
    readonly organizationId: string | null;
    readonly profileId: string | null;
  },
): Response {
  const pollId = z.uuid().safeParse(input.pollId);
  const profileId = z.uuid().safeParse(input.profileId);
  if (!identityMatches(storage, input.organizationId) || !pollId.success || !profileId.success) {
    return Response.json({ code: "poll_not_found" }, { status: 404 });
  }
  const pollRow = storage.sql
    .exec<{
      readonly archivedAt: string;
      readonly description: string;
      readonly expiresAt: string;
      readonly id: string;
      readonly multipleChoice: number;
      readonly title: string;
    }>(
      `SELECT id, title, description, multiple_choice AS multipleChoice,
              expires_at AS expiresAt, archived_at AS archivedAt
       FROM polls WHERE id = ? LIMIT 1`,
      pollId.data,
    )
    .toArray()
    .at(0);
  if (!pollRow) {
    return Response.json({ code: "poll_not_found" }, { status: 404 });
  }
  const options = storage.sql
    .exec<OrganizationPollOption>(
      `SELECT id, label, sort_order AS sortOrder
       FROM poll_options WHERE poll_id = ? ORDER BY sort_order, id`,
      pollId.data,
    )
    .toArray();
  const profileRow = storage.sql
    .exec<{ displayName: string }>(
      "SELECT display_name AS displayName FROM profiles WHERE id = ? LIMIT 1",
      profileId.data,
    )
    .toArray()
    .at(0);
  const profileName = profileRow?.displayName ?? "";
  const responseRow = storage.sql
    .exec<{ optionIds: string }>(
      "SELECT option_ids AS optionIds FROM poll_responses WHERE poll_id = ? AND profile_id = ? LIMIT 1",
      pollId.data,
      profileId.data,
    )
    .toArray()
    .at(0);
  const responseOptionIds: string[] = responseRow
    ? safeParseStringArray(JSON.parse(responseRow.optionIds))
    : [];
  return Response.json({
    canSubmit: pollRow.archivedAt === "" && !responseRow && !isExpired(pollRow.expiresAt),
    description: pollRow.description,
    expiresAt: pollRow.expiresAt,
    multipleChoice: pollRow.multipleChoice === 1,
    options,
    pollId: pollRow.id,
    profileId: profileId.data,
    profileName,
    responseOptionIds,
    title: pollRow.title,
  });
}

// eslint-disable-next-line complexity -- this store dispatches the bounded poll management union.
export async function managePollInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = managementRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "invalid_management_request" }, { status: 400 });
  }
  if (!identityMatches(storage, parsed.data.organizationId)) {
    return Response.json({ code: "identity_mismatch" }, { status: 403 });
  }
  const { action, actorUserId, requestId } = parsed.data;
  switch (action) {
    case "create_poll": {
      const { id, ...poll } = parsed.data.poll;
      const createdAt = nowIso();
      storage.sql.exec(
        `INSERT INTO polls
          (id, title, description, multiple_choice, expires_at, archived_at,
           created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)`,
        id,
        poll.title,
        poll.description,
        poll.multipleChoice ? 1 : 0,
        poll.expiresAt,
        actorUserId,
        createdAt,
        createdAt,
      );
      for (const option of poll.options) {
        storage.sql.exec(
          `INSERT INTO poll_options (id, poll_id, label, sort_order) VALUES (?, ?, ?, ?)`,
          option.id,
          id,
          option.label,
          option.sortOrder,
        );
      }
      storage.sql.exec(
        `INSERT INTO audit_events
          (id, actor_type, actor_id, action, target_type, target_id,
           request_id, change_summary, occurred_at)
         VALUES (?, 'user', ?, 'poll.created', 'poll', ?, ?, ?, ?)`,
        `poll-created:${requestId}`,
        actorUserId,
        id,
        requestId,
        JSON.stringify({ title: poll.title }),
        createdAt,
      );
      return Response.json({
        ...poll,
        archivedAt: "",
        createdAt,
        createdBy: actorUserId,
        id,
        updatedAt: createdAt,
      });
    }
    case "update_poll": {
      const { id, ...poll } = parsed.data.poll;
      const updatedAt = nowIso();
      storage.sql.exec(
        `UPDATE polls SET title = ?, description = ?, multiple_choice = ?,
          expires_at = ?, archived_at = ?,
          updated_at = ? WHERE id = ?`,
        poll.title,
        poll.description,
        poll.multipleChoice ? 1 : 0,
        poll.expiresAt,
        poll.archivedAt,
        updatedAt,
        id,
      );
      storage.sql.exec(`DELETE FROM poll_options WHERE poll_id = ?`, id);
      for (const option of poll.options) {
        storage.sql.exec(
          `INSERT INTO poll_options (id, poll_id, label, sort_order) VALUES (?, ?, ?, ?)`,
          option.id,
          id,
          option.label,
          option.sortOrder,
        );
      }
      return readPollFromStore(storage, parsed.data.organizationId, id);
    }
    case "archive_poll": {
      const { pollId } = parsed.data;
      const archivedAt = nowIso();
      storage.sql.exec(
        `UPDATE polls SET archived_at = ?, updated_at = ? WHERE id = ?`,
        archivedAt,
        archivedAt,
        pollId,
      );
      return Response.json({ id: pollId, archivedAt });
    }
    case "submit_poll_response": {
      const { pollId, response } = parsed.data;
      const poll = storage.sql
        .exec<{ multipleChoice: number; archivedAt: string; expiresAt: string }>(
          `SELECT multiple_choice AS multipleChoice, archived_at AS archivedAt,
                  expires_at AS expiresAt
           FROM polls WHERE id = ? LIMIT 1`,
          pollId,
        )
        .toArray()
        .at(0);
      if (!poll) return Response.json({ code: "poll_not_found" }, { status: 404 });
      if (poll.archivedAt !== "") {
        return Response.json({ code: "poll_archived" }, { status: 410 });
      }
      if (isExpired(poll.expiresAt)) {
        return Response.json({ code: "poll_expired" }, { status: 410 });
      }
      if (!poll.multipleChoice && response.optionIds.length > 1) {
        return Response.json({ code: "single_choice_only" }, { status: 400 });
      }
      const uniqueOptionIds = new Set(response.optionIds);
      const placeholders = response.optionIds.map(() => "?").join(", ");
      const ownedOptions = storage.sql
        .exec<{ id: string }>(
          `SELECT id FROM poll_options WHERE poll_id = ? AND id IN (${placeholders})`,
          pollId,
          ...response.optionIds,
        )
        .toArray();
      if (ownedOptions.length !== uniqueOptionIds.size) {
        return Response.json({ code: "poll_option_not_found" }, { status: 400 });
      }
      storage.sql.exec(
        `INSERT OR REPLACE INTO poll_responses
          (poll_id, profile_id, option_ids, profile_name, responded_at)
         VALUES (?, ?, ?, ?, ?)`,
        pollId,
        response.profileId,
        JSON.stringify(response.optionIds),
        response.profileName,
        nowIso(),
      );
      return Response.json({ pollId, profileId: response.profileId });
    }
  }
}
