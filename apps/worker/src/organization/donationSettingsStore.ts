import type { DurableObjectStorage } from "@cloudflare/workers-types";
import { donationSettingsSchema, type DonationSettings } from "@choir/contracts";

interface DonationSettingsActor {
  readonly actorUserId: string;
  readonly requestId: string;
}

const defaultDonationSettings: DonationSettings = {
  buttonText: "Support our Music",
  description:
    "Your contribution helps us keep the music playing and supports our mission in the community.",
  levels: [
    { amountCents: 2_500, benefit: "Mention in program", id: "level-1", label: "Friend" },
    { amountCents: 5_000, benefit: "Mention in program", id: "level-2", label: "Supporter" },
    { amountCents: 10_000, benefit: "Priority seating", id: "level-3", label: "Patron" },
    {
      amountCents: 25_000,
      benefit: "Invitation to VIP reception",
      id: "level-4",
      label: "Benefactor",
    },
  ],
};

function storedDonationSettings(storage: DurableObjectStorage): DonationSettings {
  try {
    const raw = storage.sql
      .exec<{ readonly settings: string }>(
        "SELECT donation_settings_json AS settings FROM organization_metadata LIMIT 1",
      )
      .toArray()
      .at(0)?.settings;
    if (raw) {
      const parsed = donationSettingsSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Keep existing Organizations usable if the setting predates this feature.
  }
  return defaultDonationSettings;
}

export function readDonationSettingsFromStore(
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
  return Response.json(storedDonationSettings(storage));
}

export function updateDonationSettingsInStore(
  storage: DurableObjectStorage,
  organizationId: string,
  settings: DonationSettings,
  actor: DonationSettingsActor,
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
  const now = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE organization_metadata SET donation_settings_json = ?, updated_at = ?",
      JSON.stringify(settings),
      now,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'donation.settings_updated',
         'organization', ?, ?, ?, ?)`,
      crypto.randomUUID(),
      actor.actorUserId,
      organizationId,
      actor.requestId,
      JSON.stringify({ levelCount: settings.levels.length }),
      now,
    );
  });
  return Response.json(settings);
}
