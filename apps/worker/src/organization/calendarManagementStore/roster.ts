import { type ManagementRequest } from "./contracts";
import { insertAudit } from "./shared";
import { runRosterAutomations } from "../statusAutomationStore";

export function updateRosterConfiguration(
  storage: DurableObjectStorage,
  operation: Extract<ManagementRequest, { readonly action: "update_roster_configuration" }>,
  occurredAt: string,
): Response {
  const labels = new Set(operation.configuration.voiceParts.map(({ label }) => label));
  const assignedVoiceParts = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly voicePart: string }>(
      `SELECT DISTINCT voice_part AS voicePart FROM profiles
       WHERE voice_part <> ''`,
    )
    .toArray();
  if (assignedVoiceParts.some(({ voicePart }) => !labels.has(voicePart))) {
    return Response.json({ code: "voice_part_in_use" }, { status: 409 });
  }
  storage.transactionSync(() => {
    storage.sql.exec(
      "UPDATE organization_metadata SET roster_configuration_json = ?, updated_at = ?",
      JSON.stringify(operation.configuration),
      occurredAt,
    );
    insertAudit(
      storage,
      operation,
      "organization.roster_configuration.updated",
      "organization",
      operation.organizationId,
      {
        sectionCount: operation.configuration.sections.length,
        voicePartCount: operation.configuration.voiceParts.length,
      },
      occurredAt,
    );
  });
  runRosterAutomations(
    storage,
    operation.organizationId,
    new Date(occurredAt),
    operation.requestId,
  );
  return Response.json(operation.configuration);
}
