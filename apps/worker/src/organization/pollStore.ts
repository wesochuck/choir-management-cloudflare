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

interface PollSummaryRow extends PollRow {
  readonly responseCount: number;
}

interface PollOptionRow {
  readonly [column: string]: SqlStorageValue;
  readonly id: string;
  readonly label: string;
  readonly pollId: string;
  readonly sortOrder: number;
}

interface PollResponseOptionRow {
  readonly [column: string]: SqlStorageValue;
  readonly optionIds: string;
  readonly pollId: string;
}

function attachOptionTallies(storage: DurableObjectStorage, polls: readonly PollSummaryRow[]) {
  if (polls.length === 0) return [];
  const pollIds = polls.map((p) => p.id);
  const placeholders = pollIds.map(() => "?").join(", ");
  const options = storage.sql
    .exec<PollOptionRow>(
      `SELECT id, poll_id AS pollId, label, sort_order AS sortOrder
       FROM poll_options
       WHERE poll_id IN (${placeholders})
       ORDER BY sort_order, id`,
      ...pollIds,
    )
    .toArray();

  const responses = storage.sql
    .exec<PollResponseOptionRow>(
      `SELECT poll_id AS pollId, option_ids AS optionIds
       FROM poll_responses
       WHERE poll_id IN (${placeholders})`,
      ...pollIds,
    )
    .toArray();

  const optionsByPoll = new Map<string, PollOptionRow[]>();
  for (const opt of options) {
    const list = optionsByPoll.get(opt.pollId) ?? [];
    list.push(opt);
    optionsByPoll.set(opt.pollId, list);
  }

  const countsByPollOption = new Map<string, Map<string, number>>();
  for (const resp of responses) {
    let pollMap = countsByPollOption.get(resp.pollId);
    if (!pollMap) {
      pollMap = new Map<string, number>();
      countsByPollOption.set(resp.pollId, pollMap);
    }
    const ids = safeParseStringArray(JSON.parse(resp.optionIds));
    for (const id of ids) {
      pollMap.set(id, (pollMap.get(id) ?? 0) + 1);
    }
  }

  return polls.map((p) => {
    const pollOptions = optionsByPoll.get(p.id) ?? [];
    const pollCounts = countsByPollOption.get(p.id);
    const optionTallies = pollOptions.map((opt) => ({
      count: pollCounts?.get(opt.id) ?? 0,
      id: opt.id,
      label: opt.label,
    }));
    return {
      archivedAt: p.archivedAt,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
      id: p.id,
      optionTallies,
      responseCount: p.responseCount,
      title: p.title,
    };
  });
}

export function listPollsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!identityMatches(storage, organizationId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const rows = storage.sql
    .exec<PollSummaryRow>(
      `SELECT p.id, p.title, p.expires_at AS expiresAt, p.archived_at AS archivedAt,
              p.created_at AS createdAt,
              (SELECT COUNT(*) FROM poll_responses r WHERE r.poll_id = p.id) AS responseCount
       FROM polls p
       WHERE p.archived_at = ''
       ORDER BY p.created_at DESC`,
    )
    .toArray();
  return Response.json(attachOptionTallies(storage, rows));
}

export function listArchivedPollsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!identityMatches(storage, organizationId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const rows = storage.sql
    .exec<PollSummaryRow>(
      `SELECT p.id, p.title, p.expires_at AS expiresAt, p.archived_at AS archivedAt,
              p.created_at AS createdAt,
              (SELECT COUNT(*) FROM poll_responses r WHERE r.poll_id = p.id) AS responseCount
       FROM polls p WHERE p.archived_at != ''
       ORDER BY p.created_at DESC`,
    )
    .toArray();
  return Response.json(attachOptionTallies(storage, rows));
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

export function readPollResultsFromStore(
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

  const responses = storage.sql
    .exec<{
      optionIds: string;
      profileId: string;
      profileName: string;
      respondedAt: string;
      voicePart: string | null;
    }>(
      `SELECT r.profile_id AS profileId,
              COALESCE(p.display_name, r.profile_name) AS profileName,
              COALESCE(p.voice_part, '') AS voicePart,
              r.option_ids AS optionIds,
              r.responded_at AS respondedAt
       FROM poll_responses r
       LEFT JOIN profiles p ON p.id = r.profile_id
       WHERE r.poll_id = ?
       ORDER BY r.responded_at DESC`,
      pollId,
    )
    .toArray();

  const totalResponses = responses.length;

  const optionRespondentsMap = new Map<
    string,
    { profileId: string; profileName: string; respondedAt: string; voicePart: string }[]
  >();
  for (const opt of options) {
    optionRespondentsMap.set(opt.id, []);
  }

  for (const resp of responses) {
    const selectedIds = safeParseStringArray(JSON.parse(resp.optionIds));
    for (const optId of selectedIds) {
      const list = optionRespondentsMap.get(optId);
      if (list) {
        list.push({
          profileId: resp.profileId,
          profileName: resp.profileName,
          respondedAt: resp.respondedAt,
          voicePart: resp.voicePart ?? "",
        });
      }
    }
  }

  const resultOptions = options.map((opt) => {
    const respondents = optionRespondentsMap.get(opt.id) ?? [];
    const count = respondents.length;
    const percentage = totalResponses > 0 ? Math.round((count / totalResponses) * 1000) / 10 : 0;
    return {
      count,
      id: opt.id,
      label: opt.label,
      percentage,
      respondents,
      sortOrder: opt.sortOrder,
    };
  });

  return Response.json({
    archivedAt: pollRow.archivedAt,
    createdAt: pollRow.createdAt,
    description: pollRow.description,
    expiresAt: pollRow.expiresAt,
    multipleChoice: pollRow.multipleChoice === 1,
    options: resultOptions,
    pollId: pollRow.id,
    title: pollRow.title,
    totalResponses,
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
    canSubmit: pollRow.archivedAt === "" && !isExpired(pollRow.expiresAt),
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
      const responseCountRow = storage.sql
        .exec<{ count: number }>(
          `SELECT COUNT(*) AS count FROM poll_responses WHERE poll_id = ?`,
          id,
        )
        .toArray()
        .at(0);
      const responseCount = responseCountRow?.count ?? 0;
      if (responseCount > 0) {
        const existingOptions = storage.sql
          .exec<{ id: string }>(
            `SELECT id FROM poll_options WHERE poll_id = ? ORDER BY sort_order, id`,
            id,
          )
          .toArray();
        const existingIds = new Set(existingOptions.map((o) => o.id));
        const isSameStructure =
          existingOptions.length === poll.options.length &&
          poll.options.every((opt) => existingIds.has(opt.id));
        if (!isSameStructure) {
          return Response.json({ code: "poll_options_locked" }, { status: 400 });
        }
      }
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
