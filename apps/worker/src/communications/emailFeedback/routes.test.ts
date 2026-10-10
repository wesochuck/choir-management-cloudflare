import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendPlatformEmail } from "../../auth/platformEmail";
import { deliverOrganizationCommunication } from "../provider";
import type { EmailProviderRouteInput } from "./contracts";
import { attachProviderRouteResult, prepareEmailProviderRoute } from "./routes";

type SqlBinding = null | number | bigint | string | Uint8Array;

function toBinding(value: unknown): SqlBinding {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new Error(`Unsupported SQLite binding type: ${typeof value}`);
}

function emptyMeta(): D1Meta & Record<string, unknown> {
  return {
    changed_db: true,
    changes: 0,
    duration: 0,
    last_row_id: 0,
    rows_read: 0,
    rows_written: 0,
    size_after: 0,
  };
}

/**
 * D1-compatible adapter over a real in-memory SQLite engine. Every statement
 * truly executes against the real control migration schema below, so route
 * reservation/attach/unknown transitions behave exactly as in production.
 * Row shaping mirrors production D1 (untyped JSON rows typed by the caller).
 */
function makeRaw(
  db: DatabaseSync,
  query: string,
  readBindings: () => SqlBinding[],
): D1PreparedStatement["raw"] {
  function raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  function raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  function raw(options?: { columnNames?: boolean }): Promise<unknown[]> {
    const rows = db.prepare(query).all(...readBindings());
    const values = rows.map((row) => Object.values(row));
    if (options?.columnNames === true) {
      const firstRow = rows[0];
      const names = firstRow === undefined ? [] : Object.keys(firstRow);
      return Promise.resolve([names, ...values]);
    }
    return Promise.resolve(values);
  }
  return raw;
}

function createTestD1(db: DatabaseSync): D1Database {
  const prepare = (query: string): D1PreparedStatement => {
    let bindings: SqlBinding[] = [];
    const statement: D1PreparedStatement = {
      all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const rows = db.prepare(query).all(...bindings);
        return Promise.resolve({
          meta: emptyMeta(),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- D1 returns untyped rows; the caller-declared shape is the contract, exactly as with production D1 JSON.
          results: rows as T[],
          success: true,
        });
      },
      bind(...values: unknown[]): D1PreparedStatement {
        bindings = values.map(toBinding);
        return statement;
      },
      first<T = Record<string, unknown>>(): Promise<T | null> {
        const row = db.prepare(query).get(...bindings);
        if (row === undefined) return Promise.resolve(null);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- D1 returns untyped rows; the caller-declared shape is the contract, exactly as with production D1 JSON.
        return Promise.resolve(row as T);
      },
      raw: makeRaw(db, query, () => bindings),
      run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const info = db.prepare(query).run(...bindings);
        return Promise.resolve({
          meta: {
            ...emptyMeta(),
            changes: Number(info.changes),
            last_row_id: Number(info.lastInsertRowid),
            rows_written: Number(info.changes),
          },
          results: [],
          success: true,
        });
      },
    };
    return statement;
  };
  const batch = async <T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> => {
    const results: D1Result<T>[] = [];
    for (const statement of statements) {
      const result = await statement.run();
      results.push({
        ...result,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- D1 returns untyped rows; the caller-declared shape is the contract, exactly as with production D1 JSON.
        results: result.results as T[],
      });
    }
    return results;
  };
  const session: D1DatabaseSession = {
    batch,
    getBookmark: () => null,
    prepare,
  };
  return {
    batch,
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    exec: (query: string) => {
      db.exec(query);
      return Promise.resolve({ count: 0, duration: 0 });
    },
    prepare,
    withSession: () => session,
  };
}

const MIGRATION_SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../control/migrations/0010_email_feedback.sql"),
  "utf8",
);

function setupRouteDatabase(): D1Database {
  const db = new DatabaseSync(":memory:");
  // D1 does not enforce foreign keys; match that semantic so the organizations
  // reference in the routes table behaves as it does in production.
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec(MIGRATION_SQL);
  return createTestD1(db);
}

interface RouteRow {
  readonly provider_message_id: string | null;
  readonly state: string;
}

async function readRouteState(
  database: D1Database,
  input: EmailProviderRouteInput,
): Promise<RouteRow | null> {
  return database
    .prepare(
      `SELECT provider_message_id, state FROM email_provider_routes
       WHERE provider = 'cloudflare_email' AND source_kind = ? AND source_id = ?`,
    )
    .bind(input.sourceKind, input.sourceId)
    .first<RouteRow>();
}

const routeInput: EmailProviderRouteInput = {
  destination: "singer@example.test",
  organizationId: "organization-alpha",
  sourceId: "test-source-001",
  sourceKind: "communication_delivery",
};

const sandboxEnv = {
  PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "",
  PLATFORM_EMAIL_FROM: "communications@mail.staging.example.com",
  PLATFORM_EMAIL_MODE: "sandbox",
} as const;

function bindingDouble(sendImpl: () => Promise<{ messageId: string }>): SendEmail {
  return { send: () => sendImpl() };
}

describe("provider route-attach bookkeeping", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("attaches an accepted message to the reserved route", async () => {
    const database = setupRouteDatabase();
    await prepareEmailProviderRoute(database, routeInput);
    await attachProviderRouteResult(database, routeInput, "provider-message-1");
    await expect(readRouteState(database, routeInput)).resolves.toEqual({
      provider_message_id: "provider-message-1",
      state: "accepted",
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("marks the route unknown and logs a redacted error when the attach fails", async () => {
    const database = setupRouteDatabase();
    await prepareEmailProviderRoute(database, routeInput);
    await attachProviderRouteResult(database, routeInput, "");
    await expect(readRouteState(database, routeInput)).resolves.toEqual({
      provider_message_id: null,
      state: "unknown",
    });
    expect(errorSpy).toHaveBeenCalledOnce();
    const serialized = String(errorSpy.mock.calls[0]?.[0]);
    const logged: unknown = JSON.parse(serialized);
    expect(logged).toMatchObject({
      errorType: "Error",
      event: "email_provider_route_attach_failed",
      sourceId: routeInput.sourceId,
      sourceKind: routeInput.sourceKind,
    });
    expect(serialized).not.toContain(routeInput.destination);
  });

  it("marks the platform route unknown and rethrows the raw send error", async () => {
    const database = setupRouteDatabase();
    const sendError = new Error("provider send exploded");
    const email = bindingDouble(() => Promise.reject(sendError));
    let caught: unknown;
    try {
      await sendPlatformEmail(
        {
          ...sandboxEnv,
          CONTROL_DB: database,
          PLATFORM_EMAIL: email,
        },
        {
          kind: "email-one-time-code",
          recipient: routeInput.destination,
          sourceId: routeInput.sourceId,
          subject: "Code",
          text: "123456",
        },
      );
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBe(sendError);
    await expect(
      readRouteState(database, {
        ...routeInput,
        sourceKind: "platform_auth",
      }),
    ).resolves.toEqual({ provider_message_id: null, state: "unknown" });
  });

  it("accepts platform mail once and skips the provider on replay", async () => {
    const database = setupRouteDatabase();
    let sends = 0;
    const email = bindingDouble(() => {
      sends += 1;
      return Promise.resolve({ messageId: "platform-message-1" });
    });
    const message = {
      kind: "email-one-time-code",
      recipient: routeInput.destination,
      sourceId: routeInput.sourceId,
      subject: "Code",
      text: "123456",
    } as const;
    await sendPlatformEmail(
      { ...sandboxEnv, CONTROL_DB: database, PLATFORM_EMAIL: email },
      message,
    );
    await sendPlatformEmail(
      { ...sandboxEnv, CONTROL_DB: database, PLATFORM_EMAIL: email },
      message,
    );
    expect(sends).toBe(1);
    await expect(
      readRouteState(database, { ...routeInput, sourceKind: "platform_auth" }),
    ).resolves.toEqual({ provider_message_id: "platform-message-1", state: "accepted" });
  });

  it("marks the Organization route unknown and rethrows the raw send error", async () => {
    const database = setupRouteDatabase();
    const sendError = new Error("organization send exploded");
    const email = bindingDouble(() => Promise.reject(sendError));
    let caught: unknown;
    try {
      await deliverOrganizationCommunication(
        {
          CONTROL_DB: database,
          EXTERNAL_EFFECTS_MODE: "sandbox",
          PLATFORM_EMAIL: email,
          PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "",
          PLATFORM_EMAIL_FROM: "communications@mail.staging.example.com",
          PLATFORM_EMAIL_MODE: "sandbox",
        },
        {
          channel: "email",
          contentMarkdown: "Hello",
          deliveryId: "00000000-0000-4000-8000-000000000001",
          destination: routeInput.destination,
          messageId: "00000000-0000-4000-8000-000000000002",
          organizationId: routeInput.organizationId ?? undefined,
          recipientName: "Singer",
          sourceId: routeInput.sourceId,
          sourceKind: routeInput.sourceKind,
          subject: "Rehearsal",
          unsubscribeUrl: "https://alpha.example.test/unsubscribe?token=signed-value",
        },
      );
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBe(sendError);
    await expect(readRouteState(database, routeInput)).resolves.toEqual({
      provider_message_id: null,
      state: "unknown",
    });
  });

  it("returns the accepted Organization message without resending on replay", async () => {
    const database = setupRouteDatabase();
    let sends = 0;
    const email = bindingDouble(() => {
      sends += 1;
      return Promise.resolve({ messageId: "organization-message-1" });
    });
    const config = {
      CONTROL_DB: database,
      EXTERNAL_EFFECTS_MODE: "sandbox",
      PLATFORM_EMAIL: email,
      PLATFORM_EMAIL_ALLOWED_RECIPIENTS: "",
      PLATFORM_EMAIL_FROM: "communications@mail.staging.example.com",
      PLATFORM_EMAIL_MODE: "sandbox",
    } as const;
    const delivery = {
      channel: "email",
      contentMarkdown: "Hello",
      deliveryId: "00000000-0000-4000-8000-000000000001",
      destination: routeInput.destination,
      messageId: "00000000-0000-4000-8000-000000000002",
      organizationId: routeInput.organizationId ?? undefined,
      recipientName: "Singer",
      sourceId: routeInput.sourceId,
      sourceKind: routeInput.sourceKind,
      subject: "Rehearsal",
      unsubscribeUrl: "https://alpha.example.test/unsubscribe?token=signed-value",
    } as const;
    const first = await deliverOrganizationCommunication(config, { ...delivery });
    const second = await deliverOrganizationCommunication(config, { ...delivery });
    expect(first).toEqual({
      failureDetail: "",
      providerMessageId: "organization-message-1",
      status: "sent",
    });
    expect(second).toEqual(first);
    expect(sends).toBe(1);
  });
});
