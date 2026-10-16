import { type ManagementRequest } from "./contracts";
import { rosterAssignmentConversion } from "@choir/domain";
import { insertAudit, rosterConfigurationFromStore } from "./shared";
import { runRosterAutomations } from "../statusAutomationStore";
import { convertRosterReferences } from "./rosterStructureConversion";

export function updateRosterConfiguration(
  storage: DurableObjectStorage,
  operation: Extract<ManagementRequest, { readonly action: "update_roster_configuration" }>,
  occurredAt: string,
): Response {
  const previous = rosterConfigurationFromStore(storage);
  const conversion = rosterAssignmentConversion(previous, operation.configuration);
  const labels = new Set(operation.configuration.voiceParts.map(({ label }) => label));
  const assignedVoiceParts = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly voicePart: string }>(
      `SELECT DISTINCT voice_part AS voicePart FROM profiles
       WHERE voice_part <> ''`,
    )
    .toArray();
  if (
    assignedVoiceParts.some(({ voicePart }) => !labels.has(conversion.get(voicePart) ?? voicePart))
  ) {
    return Response.json({ code: "voice_part_in_use" }, { status: 409 });
  }
  storage.transactionSync(() => {
    if (conversion.size > 0) {
      convertRosterReferences(storage, conversion, occurredAt);
    }
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
        rosterStructure: operation.configuration.rosterStructure ?? "sections_with_parts",
        convertedLabelCount: assignedVoiceParts.filter(({ voicePart }) => conversion.has(voicePart))
          .length,
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
