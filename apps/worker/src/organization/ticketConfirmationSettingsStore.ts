import type { DurableObjectStorage } from "@cloudflare/workers-types";
import {
  ticketConfirmationSettingsSchema,
  type TicketConfirmationSettings,
} from "@choir/contracts";

const defaultTicketConfirmationSettings: TicketConfirmationSettings = {
  pendingMessage:
    "We could not load the full ticket details yet. Your purchase may still be processing. Please refresh this page in a moment, or contact the box office if this continues.",
  qrCodeInstructions:
    "Print or screenshot this entire page and bring it with you. We also sent a confirmation email with a link back to this page.",
  successMessage: "Your purchase has been successfully processed.",
  willCallInstructions:
    "A confirmation email has been sent with a link back to this page. Your tickets will be held at Will Call on show day. Please bring a photo ID matching the buyer’s name.",
};

function ticketConfirmationSettingsFromStore(
  storage: DurableObjectStorage,
): TicketConfirmationSettings {
  try {
    const raw = storage.sql
      .exec<{ readonly settings: string }>(
        "SELECT ticket_confirmation_settings_json AS settings FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.settings;
    if (raw) {
      const parsed = ticketConfirmationSettingsSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Keep existing Organizations usable while the setting is unavailable.
  }
  return defaultTicketConfirmationSettings;
}

export function readTicketConfirmationSettingsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (!organizationId || identity?.organizationId !== organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  return Response.json(ticketConfirmationSettingsFromStore(storage));
}

export function updateTicketConfirmationSettingsInStore(
  storage: DurableObjectStorage,
  organizationId: string,
  settings: TicketConfirmationSettings,
  actor: { readonly actorUserId: string; readonly requestId: string },
): Response {
  const identity = storage.sql
    .exec<{ readonly organizationId: string }>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray()
    .at(0);
  if (identity?.organizationId !== organizationId) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE organization_metadata SET ticket_confirmation_settings_json = ?, updated_at = ?",
      JSON.stringify(settings),
      occurredAt,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'ticket_confirmation.settings_updated',
         'organization', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      actor.actorUserId,
      organizationId,
      actor.requestId,
      JSON.stringify(settings),
      occurredAt,
    );
  });
  return Response.json(settings);
}
