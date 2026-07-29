import {
  publicWebsiteProjectionPayloadSchema,
  publicWebsiteSettingsRequestSchema,
  publicWebsiteSettingsSchema,
} from "@choir/contracts";
import { z } from "zod";

const actorSchema = z.object({
  actorUserId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  requestId: z.uuid(),
});

const operationSchema = z.discriminatedUnion("action", [
  actorSchema.extend({
    action: z.literal("update"),
    settings: publicWebsiteSettingsRequestSchema,
  }),
  actorSchema.extend({ action: z.literal("begin_publication") }),
  actorSchema.extend({
    action: z.literal("complete_publication"),
    publishedAt: z.iso.datetime(),
    version: z.number().int().positive(),
  }),
]);

interface IdentityRow {
  readonly [column: string]: SqlStorageValue;
  readonly name: string;
  readonly organizationId: string;
  readonly timezone: string;
}

interface SettingsRow {
  readonly [column: string]: SqlStorageValue;
  readonly aboutUsText: string;
  readonly bodyFont: string;
  readonly contactEmail: string;
  readonly enabledNavigationJson: string;
  readonly headerFont: string;
  readonly heroFileId: string | null;
  readonly heroHeadline: string;
  readonly heroSubtitle: string;
  readonly historyText: string;
  readonly logoFileId: string | null;
  readonly pendingPublicationVersion: number | null;
  readonly publicationVersion: number;
  readonly publishedAt: string | null;
  readonly showBrandingHeaderFooter: number;
  readonly updatedAt: string;
}

interface PublicEventRow {
  readonly [column: string]: SqlStorageValue;
  readonly advancePriceCents: number;
  readonly dayOfPriceCents: number;
  readonly doorsOpenTime: string;
  readonly graphicFileId: string | null;
  readonly id: string;
  readonly isTicketingEnabled: number;
  readonly location: string;
  readonly publicDetails: string;
  readonly startsAt: string;
  readonly ticketCapacity: number | null;
  readonly title: string;
  readonly venueName: string;
}

interface MediaRow {
  readonly [column: string]: SqlStorageValue;
  readonly contentType: string;
  readonly id: string;
  readonly sizeBytes: number;
}

interface PublicTicketBundleRow {
  readonly [column: string]: SqlStorageValue;
  readonly capacity: number | null;
  readonly id: string;
  readonly priceCents: number;
  readonly saleEndAt: string;
  readonly title: string;
}

function identity(storage: DurableObjectStorage): IdentityRow | undefined {
  return storage.sql
    .exec<IdentityRow>(
      `SELECT organization_id AS organizationId, name, timezone
       FROM organization_metadata LIMIT 1`,
    )
    .toArray()
    .at(0);
}

function settingsRow(storage: DurableObjectStorage): SettingsRow {
  return storage.sql
    .exec<SettingsRow>(
      `SELECT hero_headline AS heroHeadline, hero_subtitle AS heroSubtitle,
        about_us_text AS aboutUsText, history_text AS historyText,
        contact_email AS contactEmail,
        show_branding_header_footer AS showBrandingHeaderFooter,
        header_font AS headerFont, body_font AS bodyFont,
        hero_file_id AS heroFileId, logo_file_id AS logoFileId,
        enabled_navigation_json AS enabledNavigationJson,
        publication_version AS publicationVersion,
        pending_publication_version AS pendingPublicationVersion,
        published_at AS publishedAt, updated_at AS updatedAt
       FROM public_website_settings WHERE singleton = 1`,
    )
    .one();
}

function parsedSettings(row: SettingsRow, organizationName: string) {
  const enabledNavigation: unknown = (() => {
    try {
      return JSON.parse(row.enabledNavigationJson) as unknown;
    } catch {
      return [];
    }
  })();
  return publicWebsiteSettingsSchema.parse({
    aboutUsText: row.aboutUsText,
    bodyFont: row.bodyFont,
    contactEmail: row.contactEmail,
    enabledNavigation,
    headerFont: row.headerFont,
    heroFileId: row.heroFileId,
    heroHeadline: row.heroHeadline,
    heroSubtitle: row.heroSubtitle,
    historyText: row.historyText,
    logoFileId: row.logoFileId,
    organizationName,
    publicationVersion: row.publicationVersion,
    publishedAt: row.publishedAt,
    showBrandingHeaderFooter: row.showBrandingHeaderFooter === 1,
    updatedAt: row.updatedAt,
  });
}

function mediaFile(storage: DurableObjectStorage, fileId: string): MediaRow | undefined {
  return storage.sql
    .exec<MediaRow>(
      `SELECT id, content_type AS contentType, size_bytes AS sizeBytes
       FROM private_files WHERE id = ? AND status = 'ready' LIMIT 1`,
      fileId,
    )
    .toArray()
    .at(0);
}

function validPublicImage(file: MediaRow | undefined): file is MediaRow {
  return (
    file !== undefined &&
    ["image/jpeg", "image/png", "image/webp"].includes(file.contentType) &&
    file.sizeBytes <= 5 * 1024 * 1024
  );
}

export function readPublicWebsiteSettingsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  const organization = identity(storage);
  if (organization?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json(parsedSettings(settingsRow(storage), organization.name));
}

export function readPublicCommerceProjectionFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  const organization = identity(storage);
  if (organization?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const performances = storage.sql
    .exec<PublicEventRow>(
      `SELECT e.id, e.title, e.starts_at AS startsAt, e.location,
        e.advance_price_cents AS advancePriceCents,
        e.day_of_price_cents AS dayOfPriceCents, e.doors_open_time AS doorsOpenTime,
        e.is_ticketing_enabled AS isTicketingEnabled, e.ticket_capacity AS ticketCapacity,
        e.public_details AS publicDetails, e.public_graphic_file_id AS graphicFileId,
        COALESCE(v.name, '') AS venueName
       FROM events e LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.is_archived = 0 AND e.type = 'Performance' AND e.is_ticketing_enabled = 1
       ORDER BY e.starts_at DESC, e.id DESC LIMIT 100`,
    )
    .toArray()
    .map((event) => ({ ...event, isTicketingEnabled: event.isTicketingEnabled === 1 }));
  const performanceIds = new Set(performances.map(({ id }) => id));
  const ticketBundles = storage.sql
    .exec<PublicTicketBundleRow>(
      `SELECT id, title, price_cents AS priceCents, capacity, sale_end_at AS saleEndAt
       FROM ticket_bundles WHERE is_active = 1 ORDER BY created_at DESC, id DESC LIMIT 100`,
    )
    .toArray()
    .map((bundle) => ({
      ...bundle,
      eventIds: storage.sql
        .exec<{ readonly [column: string]: SqlStorageValue; readonly eventId: string }>(
          `SELECT event_id AS eventId FROM ticket_bundle_events
           WHERE bundle_id = ? ORDER BY sort_order, event_id`,
          bundle.id,
        )
        .toArray()
        .map(({ eventId }) => eventId),
    }))
    .filter(
      (bundle) =>
        bundle.eventIds.length > 0 &&
        bundle.eventIds.every((eventId) => performanceIds.has(eventId)),
    );
  const payload = publicWebsiteProjectionPayloadSchema.parse({
    mediaFileIds: [],
    organizationName: organization.name,
    performances,
    settings: {
      aboutUsText: "",
      bodyFont: "system",
      contactEmail: "",
      enabledNavigation: ["tickets", "donations"],
      headerFont: "system",
      heroFileId: null,
      heroHeadline: `${organization.name} tickets`,
      heroSubtitle: "Purchase tickets and support our organization.",
      historyText: "",
      logoFileId: null,
      showBrandingHeaderFooter: false,
    },
    ticketBundles,
    timezone: organization.timezone,
  });
  return Response.json({
    generatedAt: new Date().toISOString(),
    organizationId: organization.organizationId,
    payload,
    version: 1,
  });
}

function updateSettings(
  storage: DurableObjectStorage,
  operation: Extract<z.infer<typeof operationSchema>, { readonly action: "update" }>,
  organization: IdentityRow,
): Response {
  for (const fileId of [operation.settings.heroFileId, operation.settings.logoFileId]) {
    if (fileId && !validPublicImage(mediaFile(storage, fileId))) {
      return Response.json({ code: "invalid_public_website_image" }, { status: 409 });
    }
  }
  const updatedAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE public_website_settings SET
        hero_headline = ?, hero_subtitle = ?, about_us_text = ?, history_text = ?,
        contact_email = ?, show_branding_header_footer = ?, header_font = ?, body_font = ?,
        hero_file_id = ?, logo_file_id = ?, enabled_navigation_json = ?, updated_at = ?
       WHERE singleton = 1`,
      operation.settings.heroHeadline,
      operation.settings.heroSubtitle,
      operation.settings.aboutUsText,
      operation.settings.historyText,
      operation.settings.contactEmail,
      operation.settings.showBrandingHeaderFooter ? 1 : 0,
      operation.settings.headerFont,
      operation.settings.bodyFont,
      operation.settings.heroFileId,
      operation.settings.logoFileId,
      JSON.stringify(operation.settings.enabledNavigation),
      updatedAt,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'organization.website.updated',
        'organization', ?, ?, ?, ?)`,
      `organization-website-updated:${operation.requestId}`,
      operation.actorUserId,
      operation.organizationId,
      operation.requestId,
      JSON.stringify({
        enabledNavigation: operation.settings.enabledNavigation,
        hasHero: operation.settings.heroFileId !== null,
        hasLogo: operation.settings.logoFileId !== null,
      }),
      updatedAt,
    );
  });
  return Response.json(parsedSettings(settingsRow(storage), organization.name));
}

function beginPublication(storage: DurableObjectStorage, organization: IdentityRow): Response {
  const row = settingsRow(storage);
  const version = Math.max(row.publicationVersion, row.pendingPublicationVersion ?? 0) + 1;
  const settings = parsedSettings(row, organization.name);
  const performances = storage.sql
    .exec<PublicEventRow>(
      `SELECT e.id, e.title, e.starts_at AS startsAt, e.location,
        e.advance_price_cents AS advancePriceCents,
        e.day_of_price_cents AS dayOfPriceCents, e.doors_open_time AS doorsOpenTime,
        e.is_ticketing_enabled AS isTicketingEnabled, e.ticket_capacity AS ticketCapacity,
        e.public_details AS publicDetails, e.public_graphic_file_id AS graphicFileId,
        COALESCE(v.name, '') AS venueName
       FROM events e LEFT JOIN venues v ON v.id = e.venue_id
       WHERE e.is_archived = 0 AND e.type = 'Performance' AND e.publish_on_website = 1
       ORDER BY e.starts_at DESC, e.id DESC LIMIT 100`,
    )
    .toArray()
    .map((event) => ({ ...event, isTicketingEnabled: event.isTicketingEnabled === 1 }));
  const publicEventIds = new Set(performances.map(({ id }) => id));
  const ticketBundles = storage.sql
    .exec<PublicTicketBundleRow>(
      `SELECT id, title, price_cents AS priceCents, capacity, sale_end_at AS saleEndAt
       FROM ticket_bundles WHERE is_active = 1 ORDER BY created_at DESC, id DESC LIMIT 100`,
    )
    .toArray()
    .map((bundle) => ({
      ...bundle,
      eventIds: storage.sql
        .exec<{ readonly [column: string]: SqlStorageValue; readonly eventId: string }>(
          `SELECT event_id AS eventId FROM ticket_bundle_events
           WHERE bundle_id = ? ORDER BY sort_order, event_id`,
          bundle.id,
        )
        .toArray()
        .map(({ eventId }) => eventId),
    }))
    .filter(
      (bundle) =>
        bundle.eventIds.length > 0 &&
        bundle.eventIds.every((eventId) => publicEventIds.has(eventId)),
    );
  const mediaIds = new Set(
    [
      settings.heroFileId,
      settings.logoFileId,
      ...performances.map(({ graphicFileId }) => graphicFileId),
    ].filter((fileId): fileId is string => fileId !== null),
  );
  const media = [...mediaIds].map((fileId) => mediaFile(storage, fileId));
  if (media.some((file) => !validPublicImage(file))) {
    return Response.json({ code: "public_website_media_unavailable" }, { status: 409 });
  }
  storage.sql.exec(
    `UPDATE public_website_settings SET pending_publication_version = ? WHERE singleton = 1`,
    version,
  );
  return Response.json({
    media,
    payload: {
      mediaFileIds: [...mediaIds],
      organizationName: organization.name,
      performances,
      settings: {
        aboutUsText: settings.aboutUsText,
        bodyFont: settings.bodyFont,
        contactEmail: settings.contactEmail,
        enabledNavigation: settings.enabledNavigation,
        headerFont: settings.headerFont,
        heroFileId: settings.heroFileId,
        heroHeadline: settings.heroHeadline,
        heroSubtitle: settings.heroSubtitle,
        historyText: settings.historyText,
        logoFileId: settings.logoFileId,
        showBrandingHeaderFooter: settings.showBrandingHeaderFooter,
      },
      ticketBundles,
      timezone: organization.timezone,
    },
    version,
  });
}

function completePublication(
  storage: DurableObjectStorage,
  operation: Extract<z.infer<typeof operationSchema>, { readonly action: "complete_publication" }>,
): Response {
  const row = settingsRow(storage);
  if (row.pendingPublicationVersion !== operation.version) {
    return Response.json({ code: "publication_version_conflict" }, { status: 409 });
  }
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE public_website_settings SET publication_version = ?,
        pending_publication_version = NULL, published_at = ? WHERE singleton = 1`,
      operation.version,
      operation.publishedAt,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'organization.website.published',
        'organization', ?, ?, ?, ?)`,
      `organization-website-published:${operation.requestId}`,
      operation.actorUserId,
      operation.organizationId,
      operation.requestId,
      JSON.stringify({ version: operation.version }),
      operation.publishedAt,
    );
  });
  return Response.json({ publishedAt: operation.publishedAt, version: operation.version });
}

export async function managePublicWebsiteInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = operationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ code: "invalid_public_website_operation" }, { status: 400 });
  }
  const organization = identity(storage);
  if (organization?.organizationId !== parsed.data.organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  if (parsed.data.action === "update") {
    return updateSettings(storage, parsed.data, organization);
  }
  if (parsed.data.action === "begin_publication") {
    return beginPublication(storage, organization);
  }
  return completePublication(storage, parsed.data);
}
