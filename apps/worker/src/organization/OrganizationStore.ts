import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

import {
  addContactsToListInStore,
  createContactInStore,
  createContactListInStore,
  deleteContactInStore,
  deleteContactListInStore,
  getContactFromStore,
  listContactListsFromStore,
  listContactsFromStore,
  removeContactsFromListInStore,
  updateContactInStore,
  updateContactListInStore,
  type BulkMembershipInput,
  type CreateContactInput,
  type CreateContactListInput,
  type ListContactsInput,
  type UpdateContactInput,
  type UpdateContactListInput,
} from "./contactStore";
import {
  cancelContactImportInStore,
  confirmContactImportInStore,
  createContactImportInStore,
  getContactImportFromStore,
  previewContactImportFromStore,
  processContactImportBatchInStore,
  readContactImportErrorCsvFromStore,
  updateContactImportMappingInStore,
} from "./contactImportStore";
import { migrateOrganization } from "./migrations";
import { runOrganizationAlarm, wakeOrganizationAlarm } from "./scheduler";
import { dispatchPostRequest } from "./organizationStore/post";
import { dispatchGetRequest } from "./organizationStore/read";
import {
  isOrganizationRpcRecord,
  isOrganizationRpcValue,
  organizationRpcDomainForPath,
  organizationRpcOperationForPath,
  parseOrganizationRpcCall,
  type OrganizationRpcCall,
  type OrganizationRpcResult,
} from "./rpc/types";

function responseHeaders(response: Response): Readonly<Record<string, string>> {
  return Object.fromEntries(response.headers.entries());
}

const eventReminderResultSchema = z.object({
  attempt: z.number().int().min(1).max(10),
  idempotencyKey: z.string().min(1).max(256),
  jobId: z.uuid(),
  organizationId: z.string().min(1).max(128),
  status: z.enum(["failed", "sent", "terminal"]),
});

function isAlarmWakePath(pathname: string): boolean {
  return (
    pathname === "/internal/audition/create" ||
    pathname === "/internal/audition/update" ||
    pathname === "/internal/donations/manage" ||
    pathname === "/internal/export/create" ||
    pathname === "/internal/seasons/manage" ||
    pathname === "/internal/ticketing/manage"
  );
}

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} binding is not configured.`);
  return binding;
}

function clearUnsuccessfulEventReminderMarkers(storage: DurableObjectStorage): void {
  storage.sql.exec(
    `UPDATE events
     SET reminder_sent_at = NULL
     WHERE reminder_sent_at IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM scheduled_job_outbox o
         LEFT JOIN job_ledger l ON l.job_id = o.job_id
         WHERE o.kind = 'event_reminder'
           AND o.idempotency_key =
             'event-reminder:' ||
             (SELECT organization_id FROM organization_metadata LIMIT 1) || ':' || events.id
           AND COALESCE(l.status, '') != 'completed'
       )`,
  );
}

function recordEventReminderResult(storage: DurableObjectStorage, input: unknown): Response {
  const parsed = eventReminderResultSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json({ code: "invalid_event_reminder_result" }, { status: 400 });
  }
  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0)?.organizationId;
  if (identity !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const job = storage.sql
    .exec<{ readonly idempotencyKey: string }>(
      `SELECT idempotency_key AS idempotencyKey
       FROM scheduled_job_outbox WHERE job_id = ? AND kind = 'event_reminder' LIMIT 1`,
      parsed.data.jobId,
    )
    .toArray()
    .at(0);
  const prefix = `event-reminder:${parsed.data.organizationId}:`;
  if (!job?.idempotencyKey.startsWith(prefix)) {
    return Response.json({ code: "event_reminder_not_found" }, { status: 404 });
  }
  const eventId = job.idempotencyKey.slice(prefix.length).split(":retry:", 1)[0];
  const event = storage.sql
    .exec<{ readonly id: string }>("SELECT id FROM events WHERE id = ? LIMIT 1", eventId)
    .toArray()
    .at(0);
  if (!event) return Response.json({ code: "event_reminder_not_found" }, { status: 404 });
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE events SET reminder_sent_at = ? WHERE id = ?",
      parsed.data.status === "sent" ? now : null,
      eventId,
    );
    if (parsed.data.status === "terminal") {
      storage.sql.exec(
        `INSERT INTO job_ledger
          (idempotency_key, job_id, kind, status, attempt, claimed_at, failed_at)
         VALUES (?, ?, 'event_reminder', 'failed', ?, ?, ?)
         ON CONFLICT(idempotency_key) DO UPDATE SET
           status = 'failed', attempt = MAX(job_ledger.attempt, excluded.attempt),
           completed_at = NULL, failed_at = excluded.failed_at`,
        parsed.data.idempotencyKey,
        parsed.data.jobId,
        parsed.data.attempt,
        now,
        now,
      );
    }
  });
  return Response.json({ recorded: true });
}

export class OrganizationStore extends DurableObject {
  constructor(state: DurableObjectState, env: Cloudflare.Env) {
    super(state, env);
    void state.blockConcurrencyWhile(() => {
      migrateOrganization(state.storage);
      return Promise.resolve();
    });
  }

  override async fetch(request: Request): Promise<Response> {
    return this.dispatchHttpRequest(request);
  }

  async lifecycleRpc(call: OrganizationRpcCall<"lifecycle">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async profileRpc(call: OrganizationRpcCall<"profile">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async calendarRpc(call: OrganizationRpcCall<"calendar">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async communicationRpc(
    call: OrganizationRpcCall<"communication">,
  ): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async contentRpc(call: OrganizationRpcCall<"content">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async engagementRpc(call: OrganizationRpcCall<"engagement">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async commerceRpc(call: OrganizationRpcCall<"commerce">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async fileRpc(call: OrganizationRpcCall<"file">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async jobRpc(call: OrganizationRpcCall<"job">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  async operationsRpc(call: OrganizationRpcCall<"operations">): Promise<OrganizationRpcResult> {
    return this.dispatchRpcCall(call);
  }

  // Phase 2 marketing contacts: strongly typed Durable Object RPC methods.
  // Call via `stub.methodName(...)`; no internal fetch routing.
  listContacts(input: ListContactsInput) {
    return listContactsFromStore(this.ctx.storage, input);
  }

  getContact(input: { readonly contactId: string; readonly organizationId: string | null }) {
    return getContactFromStore(this.ctx.storage, input.organizationId, input.contactId);
  }

  createContact(input: CreateContactInput) {
    return createContactInStore(this.ctx.storage, input);
  }

  updateContact(input: UpdateContactInput) {
    return updateContactInStore(this.ctx.storage, input);
  }

  deleteContact(input: {
    readonly actorUserId: string;
    readonly contactId: string;
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    return deleteContactInStore(this.ctx.storage, input);
  }

  listContactLists(input: { readonly organizationId: string | null }) {
    return listContactListsFromStore(this.ctx.storage, input.organizationId);
  }

  createContactList(input: CreateContactListInput) {
    return createContactListInStore(this.ctx.storage, input);
  }

  updateContactList(input: UpdateContactListInput) {
    return updateContactListInStore(this.ctx.storage, input);
  }

  deleteContactList(input: {
    readonly actorUserId: string;
    readonly listId: string;
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    return deleteContactListInStore(this.ctx.storage, input);
  }

  addContactsToList(input: BulkMembershipInput) {
    return addContactsToListInStore(this.ctx.storage, input);
  }

  removeContactsFromList(input: BulkMembershipInput) {
    return removeContactsFromListInStore(this.ctx.storage, input);
  }

  // Phase 5 staged CSV contact imports: strongly typed Durable Object RPC
  // methods. Call via `stub.methodName(...)`; no internal fetch routing.
  // Only confirmation enqueues async work (via the scheduler outbox + alarm);
  // upload/mapping/preview/cancel never mutate contacts.
  createContactImport(input: {
    readonly actorUserId: string;
    readonly byteCount: number;
    readonly fileName: string;
    readonly headers: readonly string[];
    readonly importId: string;
    readonly malformedRows?:
      | readonly {
          readonly cells: readonly string[];
          readonly error: string;
          readonly rowNumber: number;
        }[]
      | undefined;
    readonly organizationId: string;
    readonly requestId: string;
    readonly rows:
      | readonly (readonly string[])[]
      | readonly {
          readonly cells: readonly string[];
          readonly rowNumber?: number;
        }[];
  }) {
    return createContactImportInStore(this.ctx.storage, input);
  }

  getContactImport(input: { readonly importId: string; readonly organizationId: string | null }) {
    return getContactImportFromStore(this.ctx.storage, input.organizationId, input.importId);
  }

  updateContactImportMapping(input: {
    readonly actorUserId: string;
    readonly importId: string;
    readonly listIds: readonly string[];
    readonly mapping: readonly string[];
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    return updateContactImportMappingInStore(this.ctx.storage, input);
  }

  previewContactImport(input: {
    readonly importId: string;
    readonly organizationId: string | null;
  }) {
    return previewContactImportFromStore(this.ctx.storage, input.organizationId, input.importId);
  }

  async confirmContactImport(input: {
    readonly actorUserId: string;
    readonly importId: string;
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    const result = confirmContactImportInStore(this.ctx.storage, input);
    // Wake the scheduler promptly so the queued import does not wait for the
    // hourly cadence; the alarm drains the outbox through the queue consumer.
    await wakeOrganizationAlarm(this.ctx.storage);
    return result;
  }

  cancelContactImport(input: {
    readonly actorUserId: string;
    readonly importId: string;
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    return cancelContactImportInStore(this.ctx.storage, input);
  }

  processContactImportBatch(input: {
    readonly actorUserId: string;
    readonly batchSize?: number | undefined;
    readonly importId: string;
    readonly organizationId: string;
    readonly requestId: string;
  }) {
    return processContactImportBatchInStore(this.ctx.storage, input);
  }

  contactImportErrorCsv(input: {
    readonly importId: string;
    readonly organizationId: string | null;
  }) {
    return readContactImportErrorCsvFromStore(
      this.ctx.storage,
      input.organizationId,
      input.importId,
    );
  }

  private async dispatchRpcCall(call: OrganizationRpcCall): Promise<OrganizationRpcResult> {
    const parsedCall = parseOrganizationRpcCall(call);
    if (!parsedCall) {
      return {
        error: {
          body: { code: "invalid_organization_rpc_call" },
          code: "invalid_organization_rpc_call",
          headers: { "content-type": "application/json" },
          status: 400,
        },
        ok: false,
      };
    }
    if (
      parsedCall.domain !== organizationRpcDomainForPath(parsedCall.path) ||
      parsedCall.operation !== organizationRpcOperationForPath(parsedCall.method, parsedCall.path)
    ) {
      return {
        error: {
          body: { code: "invalid_organization_rpc_operation" },
          code: "invalid_organization_rpc_operation",
          headers: { "content-type": "application/json" },
          status: 400,
        },
        ok: false,
      };
    }
    if (parsedCall.path !== "/internal/provision" && !this.rpcIdentityMatches(parsedCall)) {
      return {
        error: {
          body: { code: "organization_not_found" },
          code: "organization_identity_conflict",
          headers: { "content-type": "application/json" },
          status: 404,
        },
        ok: false,
      };
    }
    const url = new URL(`https://organization.internal${parsedCall.path}`);
    for (const [key, value] of Object.entries(parsedCall.query ?? {})) {
      url.searchParams.set(key, value);
    }
    const init: RequestInit = { method: parsedCall.method };
    if (parsedCall.body !== undefined) {
      init.body = JSON.stringify(parsedCall.body);
      init.headers = { "content-type": "application/json" };
    }
    const response = await this.dispatchHttpRequest(new Request(url, init));
    const contentType = response.headers.get("content-type") ?? "application/json";
    const body: unknown = contentType.toLowerCase().includes("json")
      ? await response.json().catch(() => null)
      : await response.text();
    if (!isOrganizationRpcValue(body)) {
      throw new Error("Organization RPC response must be JSON-serializable.");
    }
    if (!response.ok) {
      const code =
        isOrganizationRpcRecord(body) && typeof body.code === "string"
          ? body.code
          : "organization_rpc_error";
      return {
        error: { body, code, headers: responseHeaders(response), status: response.status },
        ok: false,
      };
    }
    return { headers: responseHeaders(response), ok: true, status: response.status, value: body };
  }

  private rpcIdentityMatches(call: OrganizationRpcCall): boolean {
    const storedOrganizationId = this.ctx.storage.sql
      .exec<{ readonly organizationId: string }>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.organizationId;
    if (!storedOrganizationId) return false;

    const requestedOrganizationIds: string[] = [];
    const queryOrganizationId = call.query?.organizationId;
    if (queryOrganizationId) requestedOrganizationIds.push(queryOrganizationId);
    if (isOrganizationRpcRecord(call.body) && typeof call.body.organizationId === "string") {
      requestedOrganizationIds.push(call.body.organizationId);
    }
    return (
      requestedOrganizationIds.length > 0 &&
      requestedOrganizationIds.every((organizationId) => organizationId === storedOrganizationId)
    );
  }

  private async dispatchHttpRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST") {
      if (url.pathname === "/internal/scheduling/event-reminder-result") {
        return recordEventReminderResult(this.ctx.storage, await request.json().catch(() => null));
      }
      const jobsQueue = requireBinding(this.env.JOBS_QUEUE, "JOBS_QUEUE");
      const response = await dispatchPostRequest(
        this.ctx.storage,
        jobsQueue,
        url.pathname,
        request,
      );
      if (response) {
        if (response.ok && isAlarmWakePath(url.pathname)) {
          await wakeOrganizationAlarm(this.ctx.storage);
        }
        return response;
      }
    }
    if (request.method === "GET") {
      const response = dispatchGetRequest(this.ctx.storage, url);
      if (response) return response;
    }
    return Response.json({ code: "not_found" }, { status: 404 });
  }

  override async alarm(): Promise<void> {
    try {
      await runOrganizationAlarm(
        this.ctx.storage,
        requireBinding(this.env.JOBS_QUEUE, "JOBS_QUEUE"),
      );
    } finally {
      clearUnsuccessfulEventReminderMarkers(this.ctx.storage);
    }
  }
}
