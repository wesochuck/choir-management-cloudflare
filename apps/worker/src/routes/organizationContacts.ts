import {
  addContactsToListRequestSchema,
  CONTACT_BULK_OPERATION_MAX,
  contactCommunicationStatusSchema,
  contactCreateRequestSchema,
  contactListCreateRequestSchema,
  contactListUpdateRequestSchema,
  contactSearchRequestSchema,
  contactUpdateRequestSchema,
  removeContactsFromListRequestSchema,
  type ContactCommunicationStatus,
  type ProblemDetails,
} from "@choir/contracts";
import { z } from "zod";
import { ContactStoreError, type ContactStoreErrorCode } from "../organization/contactStore";
import { organizationStoreStub } from "../organization/rpc/client";

import type { Context, Hono } from "hono";

import type { WorkerHonoEnvironment } from "./helpers";

import { authorizeCalendarRoute } from "./helpers";

/**
 * Phase 3 marketing-contacts API surface (Contacts and Contact Lists).
 *
 * Tenancy: the Organization is resolved from the validated canonical
 * hostname inside `authorizeCalendarRoute` before any membership check, and
 * only that server-resolved Organization ID selects the Durable Object via
 * `organizationStoreStub`. A client-supplied Organization ID is never
 * trusted for storage. Every route requires an Organization Owner or
 * Administrator; members receive `forbidden` before any storage access.
 *
 * All Durable Object access uses typed `stub.methodName(...)` RPC; there
 * are no provider calls on these routes. Audit evidence is written by the
 * Organization store layer. This module never logs contact values (names,
 * emails, phones) and maps store failures to typed `ProblemDetails`
 * without raw SQLite text.
 */

const contactPreferenceFieldsSchema = z.object({
  emailStatus: contactCommunicationStatusSchema.optional(),
  preferenceSource: z.string().trim().max(200).nullable().optional(),
  smsStatus: contactCommunicationStatusSchema.optional(),
});

type ContactPreferenceFields = z.infer<typeof contactPreferenceFieldsSchema>;

interface ContactPreferenceInput {
  readonly emailStatus?: ContactCommunicationStatus | undefined;
  readonly preferenceSource?: string | null | undefined;
  readonly smsStatus?: ContactCommunicationStatus | undefined;
}

const membershipEnvelopeSchema = z.object({
  contactIds: z.array(z.unknown()).min(1).max(CONTACT_BULK_OPERATION_MAX),
});

const CONTACT_UPDATE_KEYS = [
  "displayName",
  "email",
  "firstName",
  "lastName",
  "normalizedEmail",
  "normalizedPhone",
  "phone",
  "profileId",
  "source",
] as const;

type MembershipBodyResult =
  | { readonly contactIds: readonly unknown[]; readonly kind: "ok" }
  | { readonly kind: "invalid" }
  | { readonly kind: "oversized" };

function matchContactStoreErrorCode(value: string): ContactStoreErrorCode | null {
  switch (value) {
    case "organization_identity_conflict":
    case "contact_not_found":
    case "contact_duplicate_email":
    case "contact_missing_identity":
    case "contact_profile_not_found":
    case "contact_list_not_found":
    case "validation_failed":
      return value;
    default:
      return null;
  }
}

/**
 * Durable Object RPC does not preserve the `ContactStoreError` prototype, so
 * route-side mapping reads the typed error code instead of `instanceof`.
 * `ContactStoreError` always prefixes its message with `${code}: `, which
 * lets the boundary preserve the code without leaking storage details.
 */
function contactStoreErrorCode(error: unknown): ContactStoreErrorCode | null {
  if (error instanceof ContactStoreError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code: unknown = error.code;
    if (typeof code === "string") {
      const matched = matchContactStoreErrorCode(code);
      if (matched !== null) return matched;
    }
  }
  if (error instanceof Error) {
    const prefix = error.message.split(":", 1)[0]?.trim() ?? "";
    return matchContactStoreErrorCode(prefix);
  }
  return null;
}

function contactProblem(
  error: unknown,
  requestId: string,
  fallbackMessage: string,
): { readonly problem: ProblemDetails; readonly status: 400 | 404 | 409 | 503 } {
  const code = contactStoreErrorCode(error);
  if (code !== null) {
    switch (code) {
      case "contact_not_found":
        return {
          problem: {
            code,
            message: "The contact was not found in this organization.",
            requestId,
          },
          status: 404,
        };
      case "contact_list_not_found":
        return {
          problem: {
            code,
            message: "The contact list was not found in this organization.",
            requestId,
          },
          status: 404,
        };
      case "contact_duplicate_email":
        return {
          problem: {
            code,
            message: "A contact with this email address already exists in this organization.",
            requestId,
          },
          status: 409,
        };
      case "contact_profile_not_found":
        return {
          problem: {
            code,
            message: "The linked organization profile was not found in this organization.",
            requestId,
          },
          status: 400,
        };
      case "contact_missing_identity":
        return {
          problem: {
            code,
            message: "A contact requires a name, contact method, or linked profile.",
            requestId,
          },
          status: 400,
        };
      case "organization_identity_conflict":
        return {
          problem: {
            code,
            message: "The organization context was rejected.",
            requestId,
          },
          status: 409,
        };
      case "validation_failed":
        return {
          problem: {
            code,
            message: "The contact request was not valid.",
            requestId,
          },
          status: 400,
        };
    }
  }
  console.error(
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      event: "contact_route_error",
      requestId,
    }),
  );
  return {
    problem: {
      code: "service_unavailable",
      message: fallbackMessage,
      requestId,
    } satisfies ProblemDetails,
    status: 503,
  };
}

function validationProblem(message: string, requestId: string): ProblemDetails {
  return { code: "validation_failed", message, requestId };
}

function parseRouteUuid(value: string): string | null {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function readRequestJson(context: Context<WorkerHonoEnvironment>): Promise<unknown> {
  return context.req.json<unknown>().catch(() => null);
}

function preferenceInput(data: ContactPreferenceFields): ContactPreferenceInput {
  return {
    ...(data.emailStatus === undefined ? {} : { emailStatus: data.emailStatus }),
    ...(data.preferenceSource === undefined ? {} : { preferenceSource: data.preferenceSource }),
    ...(data.smsStatus === undefined ? {} : { smsStatus: data.smsStatus }),
  };
}

function hasContactFieldKey(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  return CONTACT_UPDATE_KEYS.some((key) => Object.hasOwn(raw, key));
}

function hasPreferenceUpdate(data: ContactPreferenceFields): boolean {
  return (
    data.emailStatus !== undefined ||
    data.smsStatus !== undefined ||
    data.preferenceSource !== undefined
  );
}

function readMembershipBody(raw: unknown): MembershipBodyResult {
  const envelope = membershipEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    const oversized = envelope.error.issues.some((issue) => issue.code === "too_big");
    return { kind: oversized ? "oversized" : "invalid" };
  }
  return { contactIds: envelope.data.contactIds, kind: "ok" };
}

export function registerRoutes(router: Hono<WorkerHonoEnvironment>): void {
  router.get("/api/organization/contacts", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const requestUrl = new URL(context.req.url);
    const limitRaw = requestUrl.searchParams.get("limit");
    const parsedQuery = contactSearchRequestSchema.safeParse({
      channel: requestUrl.searchParams.get("channel") ?? undefined,
      cursor: requestUrl.searchParams.get("cursor") ?? undefined,
      limit: limitRaw === null ? undefined : Number(limitRaw),
      listId: requestUrl.searchParams.get("listId") ?? undefined,
      query: requestUrl.searchParams.get("query") ?? undefined,
      source: requestUrl.searchParams.get("source") ?? undefined,
      status: requestUrl.searchParams.get("status") ?? undefined,
    });
    if (!parsedQuery.success) {
      return context.json(
        {
          ...validationProblem(
            "Valid contact search filters are required.",
            context.get("requestId"),
          ),
        },
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const page = await stub.listContacts({
        ...parsedQuery.data,
        // The management UI renders status/list columns from the same page;
        // the store resolves them with two batched queries (never N+1).
        includeDetails: true,
        organizationId: authorization.organizationId,
      });
      return context.json({
        contacts: page.contacts,
        hasMore: page.hasMore,
        // Phase 4 browser enrichment, resolved with batched store queries
        // (never N+1). Unknown keys are ignored by older contract parsers,
        // so this additive shape stays backward compatible.
        memberships: page.memberships,
        nextCursor: page.nextCursor,
        preferences: page.preferences,
        requestId: context.get("requestId"),
      });
    } catch (error: unknown) {
      const result = contactProblem(
        error,
        context.get("requestId"),
        "Contacts are temporarily unavailable.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.post("/api/organization/contacts", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const raw = await readRequestJson(context);
    const parsedBody = contactCreateRequestSchema.safeParse(raw);
    if (!parsedBody.success) {
      return context.json(
        { ...validationProblem("Valid contact details are required.", context.get("requestId")) },
        400,
      );
    }
    const parsedPreferences = contactPreferenceFieldsSchema.safeParse(raw);
    if (!parsedPreferences.success) {
      return context.json(
        {
          ...validationProblem(
            "Valid contact communication preferences are required.",
            context.get("requestId"),
          ),
        },
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      // Normalized email/phone are derived server-side by the Organization
      // store; only display values are accepted here.
      const created = await stub.createContact({
        actorUserId: authorization.userId,
        contactId: crypto.randomUUID(),
        displayName: parsedBody.data.displayName,
        email: parsedBody.data.email,
        firstName: parsedBody.data.firstName,
        lastName: parsedBody.data.lastName,
        organizationId: authorization.organizationId,
        phone: parsedBody.data.phone,
        profileId: parsedBody.data.profileId,
        requestId: context.get("requestId"),
        source: parsedBody.data.source,
        ...preferenceInput(parsedPreferences.data),
      });
      return context.json({ contact: created.contact, requestId: context.get("requestId") }, 201);
    } catch (error: unknown) {
      const result = contactProblem(
        error,
        context.get("requestId"),
        "The contact could not be created.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.get("/api/organization/contacts/:contactId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const contactId = parseRouteUuid(context.req.param("contactId"));
    if (!contactId) {
      return context.json(
        { ...validationProblem("A valid contact is required.", context.get("requestId")) },
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const stored = await stub.getContact({
        contactId,
        organizationId: authorization.organizationId,
      });
      // `listIds` and `preferences` ride the existing typed RPC result; the
      // additive shape stays backward compatible with `contactResponseSchema`
      // parsers, which ignore unknown keys. Phase 10 detail enrichment
      // (activity counts, linked profile, list names, last sent email) rides
      // the same result without touching source-of-truth records.
      return context.json({
        activity: stored.activity,
        contact: stored.contact,
        lastEmailAt: stored.lastEmailAt,
        linkedProfile: stored.linkedProfile,
        listIds: stored.listIds,
        lists: stored.lists,
        preferences: stored.preferences,
        requestId: context.get("requestId"),
      });
    } catch (error: unknown) {
      const result = contactProblem(
        error,
        context.get("requestId"),
        "The contact is temporarily unavailable.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.patch("/api/organization/contacts/:contactId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const contactId = parseRouteUuid(context.req.param("contactId"));
    if (!contactId) {
      return context.json(
        { ...validationProblem("A valid contact is required.", context.get("requestId")) },
        400,
      );
    }
    const raw = await readRequestJson(context);
    const parsedBody = contactUpdateRequestSchema.safeParse(raw);
    const parsedPreferences = contactPreferenceFieldsSchema.safeParse(raw);
    if (!parsedPreferences.success) {
      return context.json(
        {
          ...validationProblem(
            "Valid contact communication preferences are required.",
            context.get("requestId"),
          ),
        },
        400,
      );
    }
    // A status-only update carries no contact keys; malformed contact values
    // are never silently dropped in favor of a preference change.
    if (
      !parsedBody.success &&
      (hasContactFieldKey(raw) || !hasPreferenceUpdate(parsedPreferences.data))
    ) {
      return context.json(
        {
          ...validationProblem(
            "Valid contact update fields are required.",
            context.get("requestId"),
          ),
        },
        400,
      );
    }
    // Normalized email/phone are derived server-side by the Organization
    // store; only display values are accepted here.
    const contactFields = parsedBody.success
      ? {
          displayName: parsedBody.data.displayName,
          email: parsedBody.data.email,
          firstName: parsedBody.data.firstName,
          lastName: parsedBody.data.lastName,
          phone: parsedBody.data.phone,
          profileId: parsedBody.data.profileId,
          source: parsedBody.data.source,
        }
      : {};
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const updated = await stub.updateContact({
        actorUserId: authorization.userId,
        contactId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
        ...contactFields,
        ...preferenceInput(parsedPreferences.data),
      });
      return context.json({ contact: updated.contact, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const result = contactProblem(
        error,
        context.get("requestId"),
        "The contact could not be updated.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.delete("/api/organization/contacts/:contactId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const contactId = parseRouteUuid(context.req.param("contactId"));
    if (!contactId) {
      return context.json(
        { ...validationProblem("A valid contact is required.", context.get("requestId")) },
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const deleted = await stub.deleteContact({
        actorUserId: authorization.userId,
        contactId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json({
        contactId: deleted.contactId,
        requestId: context.get("requestId"),
        status: "deleted" as const,
      });
    } catch (error: unknown) {
      const result = contactProblem(
        error,
        context.get("requestId"),
        "The contact could not be deleted.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.get("/api/organization/contact-lists", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const stored = await stub.listContactLists({
        organizationId: authorization.organizationId,
      });
      return context.json({
        hasMore: false as const,
        lists: stored.lists,
        nextCursor: null,
        requestId: context.get("requestId"),
      });
    } catch (error: unknown) {
      const result = contactProblem(
        error,
        context.get("requestId"),
        "Contact lists are temporarily unavailable.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.post("/api/organization/contact-lists", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const parsedBody = contactListCreateRequestSchema.safeParse(await readRequestJson(context));
    if (!parsedBody.success) {
      return context.json(
        {
          ...validationProblem(
            "A contact list name of 1-200 characters is required.",
            context.get("requestId"),
          ),
        },
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const created = await stub.createContactList({
        actorUserId: authorization.userId,
        description: parsedBody.data.description,
        listId: crypto.randomUUID(),
        name: parsedBody.data.name,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json({ list: created.list, requestId: context.get("requestId") }, 201);
    } catch (error: unknown) {
      const result = contactProblem(
        error,
        context.get("requestId"),
        "The contact list could not be created.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.patch("/api/organization/contact-lists/:listId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const listId = parseRouteUuid(context.req.param("listId"));
    if (!listId) {
      return context.json(
        { ...validationProblem("A valid contact list is required.", context.get("requestId")) },
        400,
      );
    }
    const parsedBody = contactListUpdateRequestSchema.safeParse(await readRequestJson(context));
    if (!parsedBody.success) {
      return context.json(
        {
          ...validationProblem(
            "Valid contact list update fields are required.",
            context.get("requestId"),
          ),
        },
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const updated = await stub.updateContactList({
        actorUserId: authorization.userId,
        description: parsedBody.data.description,
        listId,
        name: parsedBody.data.name,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json({ list: updated.list, requestId: context.get("requestId") });
    } catch (error: unknown) {
      const result = contactProblem(
        error,
        context.get("requestId"),
        "The contact list could not be updated.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.delete("/api/organization/contact-lists/:listId", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const listId = parseRouteUuid(context.req.param("listId"));
    if (!listId) {
      return context.json(
        { ...validationProblem("A valid contact list is required.", context.get("requestId")) },
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const deleted = await stub.deleteContactList({
        actorUserId: authorization.userId,
        listId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json({
        listId: deleted.listId,
        requestId: context.get("requestId"),
        status: "deleted" as const,
      });
    } catch (error: unknown) {
      const result = contactProblem(
        error,
        context.get("requestId"),
        "The contact list could not be deleted.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.post("/api/organization/contact-lists/:listId/members", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const listId = parseRouteUuid(context.req.param("listId"));
    if (!listId) {
      return context.json(
        { ...validationProblem("A valid contact list is required.", context.get("requestId")) },
        400,
      );
    }
    const body = readMembershipBody(await readRequestJson(context));
    if (body.kind === "oversized") {
      return context.json(
        {
          ...validationProblem(
            `Choose between 1 and ${String(CONTACT_BULK_OPERATION_MAX)} contacts per list request.`,
            context.get("requestId"),
          ),
        },
        400,
      );
    }
    if (body.kind === "invalid") {
      return context.json(
        { ...validationProblem("Valid contact IDs are required.", context.get("requestId")) },
        400,
      );
    }
    const parsedBody = addContactsToListRequestSchema.safeParse({
      contactIds: body.contactIds,
      listId,
    });
    if (!parsedBody.success) {
      return context.json(
        { ...validationProblem("Valid contact IDs are required.", context.get("requestId")) },
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const added = await stub.addContactsToList({
        actorUserId: authorization.userId,
        contactIds: parsedBody.data.contactIds,
        listId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json({
        added: added.added,
        listId: added.listId,
        requestId: context.get("requestId"),
      });
    } catch (error: unknown) {
      const result = contactProblem(
        error,
        context.get("requestId"),
        "Contacts could not be added to the list.",
      );
      return context.json(result.problem, result.status);
    }
  });

  router.delete("/api/organization/contact-lists/:listId/members", async (context) => {
    const authorization = await authorizeCalendarRoute(context, true);
    if (!authorization.ok) {
      return context.json(
        { ...authorization, requestId: context.get("requestId") },
        authorization.status,
      );
    }
    const listId = parseRouteUuid(context.req.param("listId"));
    if (!listId) {
      return context.json(
        { ...validationProblem("A valid contact list is required.", context.get("requestId")) },
        400,
      );
    }
    const body = readMembershipBody(await readRequestJson(context));
    if (body.kind === "oversized") {
      return context.json(
        {
          ...validationProblem(
            `Choose between 1 and ${String(CONTACT_BULK_OPERATION_MAX)} contacts per list request.`,
            context.get("requestId"),
          ),
        },
        400,
      );
    }
    if (body.kind === "invalid") {
      return context.json(
        { ...validationProblem("Valid contact IDs are required.", context.get("requestId")) },
        400,
      );
    }
    const parsedBody = removeContactsFromListRequestSchema.safeParse({
      contactIds: body.contactIds,
      listId,
    });
    if (!parsedBody.success) {
      return context.json(
        { ...validationProblem("Valid contact IDs are required.", context.get("requestId")) },
        400,
      );
    }
    try {
      const stub = organizationStoreStub(context.env, authorization.organizationId);
      const removed = await stub.removeContactsFromList({
        actorUserId: authorization.userId,
        contactIds: parsedBody.data.contactIds,
        listId,
        organizationId: authorization.organizationId,
        requestId: context.get("requestId"),
      });
      return context.json({
        listId: removed.listId,
        removed: removed.removed,
        requestId: context.get("requestId"),
      });
    } catch (error: unknown) {
      const result = contactProblem(
        error,
        context.get("requestId"),
        "Contacts could not be removed from the list.",
      );
      return context.json(result.problem, result.status);
    }
  });
}
