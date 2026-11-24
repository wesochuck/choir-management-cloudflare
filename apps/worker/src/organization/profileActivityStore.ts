import { z } from "zod";
import { primaryRosterContactSql } from "./organizationStore/rosterContact";

const RECENT_REHEARSALS_WINDOW_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1_000;

export interface ProfileActivitySqlStorage {
  readonly sql: {
    exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: unknown[]
    ): {
      toArray(): T[];
    };
  };
}

export interface ReadProfileActivityInput {
  readonly nowIso?: string | undefined;
  readonly organizationId: string;
  readonly profileId: string;
}

export interface ProfileActivityStoreTimelineEntry {
  readonly actorId: string;
  readonly actorType: string;
  readonly automatic: boolean;
  readonly detail: string;
  readonly id: string;
  readonly kind: "attendance" | "dues_payment" | "poll_response" | "rsvp_change" | "status_change";
  readonly occurredAt: string;
  readonly title: string;
}

export interface ProfileActivityStoreData {
  readonly attendance: {
    readonly lastAttendedEvent: {
      readonly eventId: string;
      readonly eventTitle: string;
      readonly eventType: "Other" | "Performance" | "Rehearsal";
      readonly startsAt: string;
    } | null;
    readonly recentRehearsals: {
      readonly absentCount: number;
      readonly pendingCount: number;
      readonly presentCount: number;
      readonly totalCount: number;
    };
  };
  readonly emailHealth: {
    readonly bounceReason: string;
    readonly doNotEmail: boolean;
    readonly lastBounceAt: string | null;
    readonly lastDeliveredAt: string | null;
    readonly providerEmailSuppressed: boolean;
  };
  readonly lastPollResponseAt: string | null;
  readonly lastRsvpResponseAt: string | null;
  readonly primaryContactEmail: string;
  readonly profileCreatedAt: string;
  readonly profileId: string;
  readonly profileUpdatedAt: string;
  readonly timeline: readonly ProfileActivityStoreTimelineEntry[];
}

export type ReadProfileActivityStoreResult =
  | { readonly code: "organization_not_found" | "profile_not_found"; readonly ok: false }
  | { readonly data: ProfileActivityStoreData; readonly ok: true };

function normalizeIsoTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatStatusLabel(status: string): string {
  return status === "Idle" ? "On Break" : status;
}

function formatCurrencyCents(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`;
}

function organizationMatches(storage: ProfileActivitySqlStorage, organizationId: string): boolean {
  if (!organizationId) return false;
  const row = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  return row?.organizationId === organizationId;
}

function readAttendanceSummary(
  storage: ProfileActivitySqlStorage,
  profileId: string,
  recentWindowStartIso: string,
  nowIso: string,
): ProfileActivityStoreData["attendance"] {
  const lastAttendedRow = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly eventId: string;
      readonly eventTitle: string;
      readonly eventType: "Other" | "Performance" | "Rehearsal";
      readonly startsAt: string;
    }>(
      `SELECT e.id AS eventId, e.title AS eventTitle, e.type AS eventType, e.starts_at AS startsAt
       FROM event_rosters r
       JOIN events e ON e.id = r.event_id
       WHERE r.profile_id = ?
         AND r.attendance = 'Present'
         AND e.is_archived = 0
         AND e.is_canceled = 0
       ORDER BY e.starts_at DESC, e.id DESC
       LIMIT 1`,
      profileId,
    )
    .toArray()
    .at(0);

  const recentRehearsalsRow = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly absentCount: number;
      readonly pendingCount: number;
      readonly presentCount: number;
      readonly totalCount: number;
    }>(
      `SELECT
        CAST(COUNT(*) AS INTEGER) AS totalCount,
        CAST(SUM(CASE WHEN r.attendance = 'Present' THEN 1 ELSE 0 END) AS INTEGER) AS presentCount,
        CAST(SUM(CASE WHEN r.attendance = 'Absent' OR (r.attendance = 'Pending' AND r.rsvp = 'No') THEN 1 ELSE 0 END) AS INTEGER) AS absentCount,
        CAST(SUM(CASE WHEN r.attendance = 'Pending' AND r.rsvp != 'No' THEN 1 ELSE 0 END) AS INTEGER) AS pendingCount
       FROM event_rosters r
       JOIN events e ON e.id = r.event_id
       WHERE r.profile_id = ?
         AND e.type = 'Rehearsal'
         AND e.is_archived = 0
         AND e.is_canceled = 0
         AND e.starts_at >= ?
         AND e.starts_at <= ?`,
      profileId,
      recentWindowStartIso,
      nowIso,
    )
    .toArray()
    .at(0);

  const lastAttendedStartsAt = normalizeIsoTimestamp(lastAttendedRow?.startsAt);

  return {
    lastAttendedEvent:
      lastAttendedRow && lastAttendedStartsAt
        ? {
            eventId: lastAttendedRow.eventId,
            eventTitle: lastAttendedRow.eventTitle,
            eventType: lastAttendedRow.eventType,
            startsAt: lastAttendedStartsAt,
          }
        : null,
    recentRehearsals: {
      absentCount: recentRehearsalsRow?.absentCount ?? 0,
      pendingCount: recentRehearsalsRow?.pendingCount ?? 0,
      presentCount: recentRehearsalsRow?.presentCount ?? 0,
      totalCount: recentRehearsalsRow?.totalCount ?? 0,
    },
  };
}

function readAttendanceTimeline(
  storage: ProfileActivitySqlStorage,
  profileId: string,
): readonly ProfileActivityStoreTimelineEntry[] {
  const rows = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly attendance: "Absent" | "Present";
      readonly eventId: string;
      readonly eventTitle: string;
      readonly eventType: "Other" | "Performance" | "Rehearsal";
      readonly startsAt: string;
    }>(
      `SELECT e.id AS eventId, e.title AS eventTitle, e.type AS eventType,
        e.starts_at AS startsAt, r.attendance AS attendance
       FROM event_rosters r
       JOIN events e ON e.id = r.event_id
       WHERE r.profile_id = ?
         AND r.attendance IN ('Present', 'Absent')
         AND e.is_archived = 0
         AND e.is_canceled = 0
       ORDER BY e.starts_at DESC, e.id DESC
       LIMIT 15`,
      profileId,
    )
    .toArray();

  return rows.flatMap((row) => {
    const occurredAt = normalizeIsoTimestamp(row.startsAt);
    return occurredAt
      ? [
          {
            actorId: "",
            actorType: "administrator",
            automatic: false,
            detail: `${row.eventType} attendance marked ${row.attendance}`,
            id: `attendance:${row.eventId}`,
            kind: "attendance" as const,
            occurredAt,
            title: `${row.attendance} — ${row.eventTitle}`,
          },
        ]
      : [];
  });
}

function readRsvpTimeline(
  storage: ProfileActivitySqlStorage,
  profileId: string,
): {
  readonly entries: readonly ProfileActivityStoreTimelineEntry[];
  readonly lastRsvpResponseAt: string | null;
} {
  const rows = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly actorId: string;
      readonly actorType: string;
      readonly automatic: number;
      readonly eventTitle: string | null;
      readonly id: string;
      readonly newRsvp: string;
      readonly occurredAt: string;
      readonly previousRsvp: string;
      readonly reason: string;
    }>(
      `SELECT h.id, h.previous_rsvp AS previousRsvp, h.new_rsvp AS newRsvp,
        h.reason, h.automatic, h.actor_type AS actorType, h.actor_id AS actorId,
        h.occurred_at AS occurredAt, e.title AS eventTitle
       FROM event_rsvp_history h
       LEFT JOIN events e ON e.id = h.event_id
       WHERE h.profile_id = ?
       ORDER BY h.occurred_at DESC, h.id DESC
       LIMIT 20`,
      profileId,
    )
    .toArray();

  const lastManualRsvp = rows.find((row) => row.automatic === 0) ?? rows[0];
  const entries = rows.flatMap((row) => {
    const occurredAt = normalizeIsoTimestamp(row.occurredAt);
    if (!occurredAt) return [];
    const changeSummary = `${row.previousRsvp} → ${row.newRsvp}`;
    return [
      {
        actorId: row.actorId,
        actorType: row.actorType,
        automatic: row.automatic === 1,
        detail: row.reason ? `${changeSummary} · ${row.reason}` : changeSummary,
        id: `rsvp:${row.id}`,
        kind: "rsvp_change" as const,
        occurredAt,
        title: `RSVP updated for ${row.eventTitle ?? "Event"}`,
      },
    ];
  });

  return { entries, lastRsvpResponseAt: normalizeIsoTimestamp(lastManualRsvp?.occurredAt) };
}

function readStatusTimeline(
  storage: ProfileActivitySqlStorage,
  profileId: string,
): readonly ProfileActivityStoreTimelineEntry[] {
  const rows = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly actorId: string;
      readonly actorType: string;
      readonly id: string;
      readonly newStatus: string;
      readonly occurredAt: string;
      readonly previousStatus: string;
      readonly reason: string;
    }>(
      `SELECT id, previous_status AS previousStatus, new_status AS newStatus,
        reason, actor_type AS actorType, actor_id AS actorId, occurred_at AS occurredAt
       FROM profile_status_history
       WHERE profile_id = ?
       ORDER BY occurred_at DESC, id DESC
       LIMIT 20`,
      profileId,
    )
    .toArray();

  return rows.flatMap((row) => {
    const occurredAt = normalizeIsoTimestamp(row.occurredAt);
    if (!occurredAt) return [];
    const transition = `${formatStatusLabel(row.previousStatus)} → ${formatStatusLabel(row.newStatus)}`;
    return [
      {
        actorId: row.actorId,
        actorType: row.actorType,
        automatic: row.actorType === "system",
        detail: row.reason || transition,
        id: `status:${row.id}`,
        kind: "status_change" as const,
        occurredAt,
        title: `Status changed to ${formatStatusLabel(row.newStatus)}`,
      },
    ];
  });
}

function readPollTimeline(
  storage: ProfileActivitySqlStorage,
  profileId: string,
): {
  readonly entries: readonly ProfileActivityStoreTimelineEntry[];
  readonly lastPollResponseAt: string | null;
} {
  const rows = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly pollId: string;
      readonly pollTitle: string | null;
      readonly respondedAt: string;
    }>(
      `SELECT pr.poll_id AS pollId, pr.responded_at AS respondedAt, p.title AS pollTitle
       FROM poll_responses pr
       LEFT JOIN polls p ON p.id = pr.poll_id
       WHERE pr.profile_id = ?
       ORDER BY pr.responded_at DESC, pr.poll_id DESC
       LIMIT 15`,
      profileId,
    )
    .toArray();

  const entries = rows.flatMap((row) => {
    const occurredAt = normalizeIsoTimestamp(row.respondedAt);
    return occurredAt
      ? [
          {
            actorId: "",
            actorType: "member",
            automatic: false,
            detail: "Submitted a response",
            id: `poll:${row.pollId}`,
            kind: "poll_response" as const,
            occurredAt,
            title: `Voted in ${row.pollTitle ?? "Poll"}`,
          },
        ]
      : [];
  });

  return { entries, lastPollResponseAt: normalizeIsoTimestamp(rows[0]?.respondedAt) };
}

function readDuesTimeline(
  storage: ProfileActivitySqlStorage,
  profileId: string,
): readonly ProfileActivityStoreTimelineEntry[] {
  const rows = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly amountCents: number;
      readonly id: string;
      readonly paidAt: string | null;
      readonly paymentMethod: "cash" | "online";
      readonly seasonName: string | null;
      readonly status: "paid" | "pending" | "refunded";
      readonly updatedAt: string;
    }>(
      `SELECT d.id, d.amount_cents AS amountCents, d.status, d.payment_method AS paymentMethod,
        d.paid_at AS paidAt, d.updated_at AS updatedAt, s.name AS seasonName
       FROM dues d
       LEFT JOIN seasons s ON s.id = d.season_id
       WHERE d.profile_id = ? AND d.status IN ('paid', 'refunded')
       ORDER BY COALESCE(d.paid_at, d.updated_at) DESC, d.id DESC
       LIMIT 15`,
      profileId,
    )
    .toArray();

  return rows.flatMap((row) => {
    const occurredAt = normalizeIsoTimestamp(row.paidAt ?? row.updatedAt);
    if (!occurredAt) return [];
    const seasonLabel = row.seasonName ?? "Season";
    const methodLabel = row.paymentMethod === "cash" ? "Cash" : "Online";
    return [
      {
        actorId: "",
        actorType: row.paymentMethod === "cash" ? "administrator" : "member",
        automatic: false,
        detail: `${formatCurrencyCents(row.amountCents)} · ${methodLabel}`,
        id: `dues:${row.id}`,
        kind: "dues_payment" as const,
        occurredAt,
        title:
          row.status === "refunded"
            ? `Dues refunded for ${seasonLabel}`
            : `Dues paid for ${seasonLabel}`,
      },
    ];
  });
}

export function readProfileActivityFromStore(
  storage: ProfileActivitySqlStorage,
  input: ReadProfileActivityInput,
): ReadProfileActivityStoreResult {
  if (!organizationMatches(storage, input.organizationId)) {
    return { code: "organization_not_found", ok: false };
  }
  const parsedProfileId = z.uuid().safeParse(input.profileId);
  if (!parsedProfileId.success) {
    return { code: "profile_not_found", ok: false };
  }
  const profileId = parsedProfileId.data;

  const profileRow = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly bounceReason: string;
      readonly createdAt: string;
      readonly doNotEmail: number;
      readonly email: string | null;
      readonly id: string;
      readonly lastBounceAt: string;
      readonly providerEmailSuppressed: number;
      readonly updatedAt: string;
    }>(
      `SELECT p.id,
        (SELECT c.email FROM contacts c WHERE c.id = ${primaryRosterContactSql}) AS email,
        p.created_at AS createdAt,
        p.updated_at AS updatedAt,
        p.last_bounce_at AS lastBounceAt,
        p.bounce_reason AS bounceReason,
        p.provider_email_suppressed AS providerEmailSuppressed,
        p.do_not_email AS doNotEmail
       FROM profiles p
       WHERE p.id = ?
       LIMIT 1`,
      profileId,
    )
    .toArray()
    .at(0);

  if (!profileRow) {
    return { code: "profile_not_found", ok: false };
  }

  const nowDate = input.nowIso ? new Date(input.nowIso) : new Date();
  const safeNow = Number.isNaN(nowDate.getTime()) ? new Date() : nowDate;
  const nowIso = safeNow.toISOString();
  const recentWindowStartIso = new Date(
    safeNow.getTime() - RECENT_REHEARSALS_WINDOW_DAYS * MS_PER_DAY,
  ).toISOString();

  const lastDeliveryRow = storage.sql
    .exec<{
      readonly [column: string]: SqlStorageValue;
      readonly deliveredAt: string | null;
    }>(
      `SELECT COALESCE(provider_event_at, last_attempt_at, updated_at) AS deliveredAt
       FROM communication_deliveries
       WHERE profile_id = ?
         AND channel = 'email'
         AND status = 'sent'
         AND (provider_status IS NULL OR provider_status IN ('accepted', 'delivered'))
       ORDER BY COALESCE(provider_event_at, last_attempt_at, updated_at) DESC, id DESC
       LIMIT 1`,
      profileId,
    )
    .toArray()
    .at(0);

  const attendance = readAttendanceSummary(storage, profileId, recentWindowStartIso, nowIso);
  const rsvpTimeline = readRsvpTimeline(storage, profileId);
  const pollTimeline = readPollTimeline(storage, profileId);

  return {
    data: {
      attendance,
      emailHealth: {
        bounceReason: profileRow.bounceReason,
        doNotEmail: profileRow.doNotEmail === 1,
        lastBounceAt: normalizeIsoTimestamp(profileRow.lastBounceAt),
        lastDeliveredAt: normalizeIsoTimestamp(lastDeliveryRow?.deliveredAt),
        providerEmailSuppressed: profileRow.providerEmailSuppressed === 1,
      },
      lastPollResponseAt: pollTimeline.lastPollResponseAt,
      lastRsvpResponseAt: rsvpTimeline.lastRsvpResponseAt,
      primaryContactEmail: profileRow.email ?? "",
      profileCreatedAt: normalizeIsoTimestamp(profileRow.createdAt) ?? nowIso,
      profileId,
      profileUpdatedAt: normalizeIsoTimestamp(profileRow.updatedAt) ?? nowIso,
      timeline: [
        ...readAttendanceTimeline(storage, profileId),
        ...rsvpTimeline.entries,
        ...readStatusTimeline(storage, profileId),
        ...pollTimeline.entries,
        ...readDuesTimeline(storage, profileId),
      ],
    },
    ok: true,
  };
}
