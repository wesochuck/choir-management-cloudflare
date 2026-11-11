import { upcomingCommunications } from "../src/organization/communicationStore/upcoming";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInDurableObject } from "cloudflare:test";
import {
  communicationAudienceRequestSchema,
  communicationOverviewSchema,
  communicationHistoryPageResponseSchema,
} from "@choir/contracts";
import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  setupTicketingIntegration,
  teardownTicketingIntegration,
  stores,
  exports,
  api,
  signIn,
} from "./ticketing.integration.fixture";

beforeEach(setupTicketingIntegration);
afterEach(teardownTicketingIntegration);
const audience = communicationAudienceRequestSchema.parse({
  eventId: null,
  globalStatuses: ["Active"],
  profileIds: [],
  rsvp: "All",
  targetAudiences: ["Members"],
  voiceParts: [],
});
const reach = JSON.stringify({ both: 0, email: 1, sms: 0, total: 1, unreachable: 0 });

describe("communications overview RPC and routes", () => {
  it("authorizes the owning Organization, returns an honest empty snapshot, and never arms alarms", async () => {
    const cookie = await signIn();
    const path = "/api/organization/communications/overview";
    expect((await exports.default.fetch(api("alpha.localhost", path))).status).toBe(401);
    expect((await exports.default.fetch(api("bravo.localhost", path, cookie))).status).toBe(403);
    const response = await exports.default.fetch(api("alpha.localhost", path, cookie));
    expect(response.status).toBe(200);
    expect(communicationOverviewSchema.parse(await response.json())).toMatchObject({
      drafts: [],
      recent: [],
      attention: [],
      upcoming: [],
      hasMore: { drafts: false, recent: false, attention: false, upcoming: false },
    });
    const stub = stores.getByName("organization-alpha");
    expect(
      await stub.readCommunicationOverview({ organizationId: "organization-bravo" }),
    ).toBeNull();
    await runInDurableObject<OrganizationStore, undefined>(stub, (instance, state) => {
      const alarm = state.storage.getAlarm();
      instance.readCommunicationOverview({ organizationId: "organization-alpha" });
      return Promise.all([alarm, state.storage.getAlarm()]).then(([before, after]) => {
        expect(after).toBe(before);
        return undefined;
      });
    });
  });
  it("caps each section, sorts drafts by edits, labels stored automation, and keeps upcoming previews out of recent sends", async () => {
    const stub = stores.getByName("organization-alpha");
    await runInDurableObject<OrganizationStore, undefined>(stub, (instance, state) => {
      const now = new Date();
      for (let index = 0; index < 8; index++) {
        const created = new Date(now.getTime() - (index + 1) * 60_000).toISOString();
        const updated = new Date(now.getTime() + index * 1000).toISOString();
        for (const status of ["Draft", "Sent"] as const)
          state.storage.sql.exec(
            `INSERT INTO communication_messages
          (id,channel,status,subject,content_markdown,audience_json,reach_json,created_by,created_at,updated_at,sent_at)
          VALUES (?,'Email',?,?,'Body',?,?,?,?,?,?)`,
            crypto.randomUUID(),
            status,
            `${status} ${String(index)}`,
            JSON.stringify(audience),
            reach,
            index === 0 ? "system:scheduler" : "user",
            created,
            updated,
            status === "Sent" ? created : null,
          );
        const starts = new Date(now.getTime() + (index + 1) * 86400000).toISOString();
        state.storage.sql.exec(
          "INSERT INTO events (id,title,type,starts_at,created_at,updated_at) VALUES (?,?,'Performance',?,?,?)",
          crypto.randomUUID(),
          `Concert ${String(index)}`,
          starts,
          created,
          created,
        );
      }
      const overview = instance.readCommunicationOverview({ organizationId: "organization-alpha" });
      expect(overview?.drafts).toHaveLength(3);
      expect(overview?.drafts[0]?.subject).toBe("Draft 7");
      expect(overview?.recent).toHaveLength(5);
      expect(overview?.recent[0]).toMatchObject({
        subject: "Sent 0",
        automatic: true,
        projected: false,
      });
      expect(overview?.hasMore).toMatchObject({ drafts: true, recent: true, upcoming: true });
      expect(overview?.upcoming).toHaveLength(3);
      expect(overview?.recent.every((item) => item.status === "Sent")).toBe(true);
      expect(
        overview?.upcoming.every(
          (item) => Date.parse(item.timestamp) <= now.getTime() + 7 * 86400000,
        ),
      ).toBe(true);
      return undefined;
    });
  });
  it("shows partial failures, excludes canceled messages, and treats old processing as delayed", async () => {
    const stub = stores.getByName("organization-alpha");
    await runInDurableObject<OrganizationStore, undefined>(stub, (instance, state) => {
      const old = new Date(Date.now() - 30 * 60_000).toISOString();
      const now = new Date().toISOString();
      const partial = crypto.randomUUID();
      for (const [status, canceled, id] of [
        ["Sent", null, partial],
        ["Queued", null, crypto.randomUUID()],
        ["Failed", now, crypto.randomUUID()],
      ] as const) {
        state.storage.sql.exec(
          `INSERT INTO communication_messages (id,channel,status,subject,content_markdown,audience_json,reach_json,created_by,created_at,updated_at,sent_at,canceled_at)
          VALUES (?,'Email',?,'Test message','Body',?,?,'user',?,?,?,?)`,
          id,
          status,
          JSON.stringify(audience),
          reach,
          old,
          old,
          status === "Sent" ? old : null,
          canceled,
        );
      }
      state.storage.sql.exec(
        `INSERT INTO communication_deliveries (id,message_id,profile_id,recipient_name,channel,destination,status,attempts,created_at,updated_at)
        VALUES (?,?,'profile','Buyer','email','buyer@example.test','failed',1,?,?)`,
        crypto.randomUUID(),
        partial,
        old,
        now,
      );
      const overview = instance.readCommunicationOverview({ organizationId: "organization-alpha" });
      expect(overview?.attention.map((item) => item.status).sort()).toEqual([
        "Delayed",
        "Sent with issues",
      ]);
      expect(overview?.recent[0]?.status).toBe("Sent with issues");
      return undefined;
    });
  });
  it("uses provider failures without changing historical send time and ignores fresh processing claims", async () => {
    const stub = stores.getByName("organization-alpha");
    await runInDurableObject<OrganizationStore, undefined>(stub, (instance, state) => {
      const old = new Date(Date.now() - 60 * 60_000).toISOString();
      const now = new Date().toISOString();
      const sent = crypto.randomUUID();
      const queued = crypto.randomUUID();
      const job = crypto.randomUUID();
      for (const [id, status] of [
        [sent, "Sent"],
        [queued, "Queued"],
      ]) {
        state.storage.sql.exec(
          `INSERT INTO communication_messages (id,channel,status,subject,content_markdown,audience_json,reach_json,created_by,created_at,updated_at,sent_at)
          VALUES (?,'Email',?,'Same subject','Body',?,?,'system:scheduler',?,?,?)`,
          id ?? "",
          status ?? "",
          JSON.stringify(audience),
          reach,
          old,
          old,
          status === "Sent" ? old : null,
        );
      }
      state.storage.sql.exec(
        `INSERT INTO job_ledger (idempotency_key,job_id,kind,status,attempt,claimed_at) VALUES ('fresh',?,'communication_delivery','claimed',1,?)`,
        job,
        now,
      );
      for (const [id, status, provider] of [
        [sent, "sent", "bounced"],
        [queued, "processing", null],
      ] as const) {
        state.storage.sql.exec(
          `INSERT INTO communication_deliveries (id,message_id,profile_id,recipient_name,channel,destination,status,provider_status,delivery_job_id,created_at,updated_at)
          VALUES (?,?,'profile','Buyer','email','buyer@example.test',?,?,?,?,?)`,
          crypto.randomUUID(),
          id,
          status,
          provider,
          status === "processing" ? job : null,
          old,
          now,
        );
      }
      const overview = instance.readCommunicationOverview({ organizationId: "organization-alpha" });
      expect(overview?.attention).toHaveLength(1);
      expect(overview?.attention[0]).toMatchObject({ id: sent, status: "Sent with issues" });
      expect(overview?.recent[0]).toMatchObject({
        id: sent,
        timestamp: old,
        automatic: true,
        status: "Sent with issues",
      });
      return undefined;
    });
  });
  it("does not duplicate scheduler bookkeeping when its communication already exists", async () => {
    const stub = stores.getByName("organization-alpha");
    await runInDurableObject<OrganizationStore, undefined>(stub, (instance, state) => {
      const now = new Date().toISOString();
      const job = crypto.randomUUID();
      state.storage.sql.exec(
        `INSERT INTO job_ledger (idempotency_key,job_id,kind,status,attempt,claimed_at,failed_at)
        VALUES ('test',?,'event_reminder','failed',6,?,?)`,
        job,
        now,
        now,
      );
      state.storage.sql.exec(
        `INSERT INTO audit_events (id,actor_type,actor_id,action,target_type,target_id,request_id,change_summary,occurred_at)
        VALUES (?,'organization_system','system:scheduler','organization.communication.queued','communication_message','message',?,'{}',?)`,
        `communication:organization.communication.queued:${job}`,
        job,
        now,
      );
      expect(
        instance.readCommunicationOverview({ organizationId: "organization-alpha" })?.attention,
      ).toEqual([]);
      return undefined;
    });
  });
  it("uses selective indexes for every new overview access path", async () => {
    const stub = stores.getByName("organization-alpha");
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const cases: readonly (readonly [string, string])[] = [
        [
          "SELECT id FROM communication_messages WHERE canceled_at IS NULL AND status='Draft' ORDER BY updated_at DESC,id DESC LIMIT 4",
          "communication_overview_state",
        ],
        [
          "SELECT id FROM communication_messages INDEXED BY communication_overview_sent WHERE canceled_at IS NULL AND status='Sent' ORDER BY COALESCE(sent_at,created_at) DESC,id DESC LIMIT 6",
          "communication_overview_sent",
        ],
        [
          "SELECT id FROM ticket_notifications INDEXED BY ticket_overview_sent WHERE status='sent' ORDER BY COALESCE(sent_at,scheduled_for) DESC,id DESC LIMIT 6",
          "ticket_overview_sent",
        ],
        [
          "SELECT id FROM audition_notifications INDEXED BY audition_overview_sent WHERE status='sent' ORDER BY COALESCE(sent_at,scheduled_for) DESC,id DESC LIMIT 6",
          "audition_overview_sent",
        ],
        [
          "SELECT id FROM checkout_reminders WHERE state='sent' AND state IN ('sent','failed','sending') ORDER BY COALESCE(sent_at,due_at) DESC,id DESC LIMIT 6",
          "checkout_overview_state",
        ],
        [
          "SELECT id FROM ticket_notifications INDEXED BY ticket_overview_issues WHERE status='sent' AND provider_status IN ('bounced','failed','rejected','complained') ORDER BY COALESCE(provider_event_at,updated_at) DESC,id DESC LIMIT 4",
          "ticket_overview_issues",
        ],
        [
          "SELECT id FROM audition_notifications INDEXED BY audition_overview_issues WHERE status='sent' AND provider_status IN ('bounced','failed','rejected','complained') ORDER BY COALESCE(provider_event_at,updated_at) DESC,id DESC LIMIT 4",
          "audition_overview_issues",
        ],
        [
          "SELECT job_id FROM scheduled_job_outbox WHERE enqueued_at IS NULL AND due_at > '2026-11-01' AND due_at < '2026-11-08' ORDER BY due_at LIMIT 4",
          "idx_scheduled_job_outbox_pending",
        ],
        [
          "SELECT id FROM events INDEXED BY idx_events_active_calendar WHERE is_archived=0 AND is_canceled=0 AND starts_at > '2026-11-01' AND starts_at < '2026-11-08' ORDER BY starts_at,id LIMIT 4",
          "idx_events_active_calendar",
        ],
        [
          "SELECT id FROM events INDEXED BY idx_events_active_rsvp_deadline WHERE rsvp_deadline_date IS NOT NULL AND rsvp_deadline_date >= '2026-11-01' AND rsvp_deadline_date <= '2026-11-08' LIMIT 4",
          "idx_events_active_rsvp_deadline",
        ],
        [
          "SELECT message_id FROM communication_deliveries INDEXED BY communication_overview_failed_deliveries WHERE (status='failed' OR provider_status IN ('bounced','failed','rejected','complained')) GROUP BY message_id LIMIT 4",
          "communication_overview_failed_deliveries",
        ],
        [
          "SELECT job_id FROM job_ledger INDEXED BY communication_overview_jobs WHERE status='failed' AND kind IN ('attendance_report','event_reminder','rsvp_follow_up') ORDER BY COALESCE(failed_at,claimed_at) DESC,job_id DESC LIMIT 4",
          "communication_overview_jobs",
        ],
      ];
      for (const [sql, index] of cases) {
        const plan = state.storage.sql
          .exec<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
          .toArray();
        expect(plan.map((row) => row.detail).join("; "), index).toContain(index);
      }
      return undefined;
    });
  });
  it("matches the existing preview calculations across DST and after booked events are excluded", async () => {
    const stub = stores.getByName("organization-alpha");
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const now = new Date("2026-10-30T12:00:00.000Z");
      const organizationId = "organization-alpha";
      for (let index = 0; index < 40; index++) {
        const id = crypto.randomUUID();
        const timestamp = now.toISOString();
        const starts = new Date(now.getTime() + (index + 1) * 6 * 3600000).toISOString();
        state.storage.sql.exec(
          "INSERT INTO events (id,title,type,starts_at,rsvp_deadline_date,rsvp_follow_up_mode,rsvp_follow_up_lead_hours,created_at,updated_at) VALUES (?,?,'Performance',?,'2026-11-02','enabled',24,?,?)",
          id,
          `DST concert ${String(index)}`,
          starts,
          timestamp,
          timestamp,
        );
        if (index < 20)
          state.storage.sql.exec(
            "INSERT INTO scheduled_job_outbox (job_id,kind,idempotency_key,due_at,created_at) VALUES (?,'event_reminder',?,?,?)",
            crypto.randomUUID(),
            `event-reminder:${organizationId}:${id}`,
            timestamp,
            timestamp,
          );
      }
      const expected = [...upcomingCommunications(state.storage, organizationId, now, 7)]
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id))
        .slice(0, 4);
      const actual = upcomingCommunications(state.storage, organizationId, now, 7, 4);
      expect(actual).toEqual(expected);
      expect(actual).toHaveLength(4);
      return undefined;
    });
  });
  it("keeps legacy history defaults while allowing recorded-only pagination", async () => {
    const cookie = await signIn();
    const stub = stores.getByName("organization-alpha");
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        "INSERT INTO events (id,title,type,starts_at,created_at,updated_at) VALUES (?,'Future concert','Performance',?,?,?)",
        crypto.randomUUID(),
        new Date(Date.now() + 3 * 86400000).toISOString(),
        now,
        now,
      );
      return undefined;
    });
    const read = async (query: string) =>
      communicationHistoryPageResponseSchema.parse(
        await (
          await exports.default.fetch(
            api("alpha.localhost", `/api/organization/communications/history${query}`, cookie),
          )
        ).json(),
      );
    await runInDurableObject<OrganizationStore, undefined>(stub, (_instance, state) => {
      const now = new Date().toISOString();
      for (const actor of ["system:scheduler", "user"])
        state.storage.sql.exec(
          `INSERT INTO communication_messages (id,channel,status,subject,content_markdown,audience_json,reach_json,created_by,created_at,updated_at,sent_at)
          VALUES (?,'Email','Sent','Same subject','Body',?,?,?,?,?,?)`,
          crypto.randomUUID(),
          JSON.stringify(audience),
          reach,
          actor,
          now,
          now,
          now,
        );
      return undefined;
    });
    const legacy = await read("");
    const recorded = await read("?includePreviews=false");
    expect(
      legacy.items.some((item) => item.kind === "automated" && item.scheduledMessage.projected),
    ).toBe(true);
    expect(recorded.items).toHaveLength(2);
    expect(recorded.items.every((item) => item.kind === "manual")).toBe(true);
    const automatic = await read("?includePreviews=false&origin=automated");
    expect(automatic.items).toHaveLength(1);
    expect(automatic.items[0]).toMatchObject({ kind: "manual", automatic: true });
    const manual = await read("?includePreviews=false&origin=manual");
    expect(manual.items).toHaveLength(1);
    expect(manual.items[0]).not.toHaveProperty("automatic");
    expect(
      (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            "/api/organization/communications/history?includePreviews=maybe",
            cookie,
          ),
        )
      ).status,
    ).toBe(400);
  });
});
