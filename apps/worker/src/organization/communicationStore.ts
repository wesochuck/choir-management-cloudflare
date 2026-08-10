import { operationSchema } from "./communicationStore/contracts";
import {
  deleteDraft,
  deleteTemplate,
  recordDeliveryResults,
  retryMessage,
  saveDraft,
  saveTemplate,
  sendMessage,
  updateTemplate,
} from "./communicationStore/messages";
import { identityMatches } from "./communicationStore/shared";

export { resolveCommunicationAudienceFromStore } from "./communicationStore/audience";
export {
  listCommunicationMessagesFromStore,
  listCommunicationScheduledMessagesFromStore,
  listCommunicationTemplatesFromStore,
  listMemberBulletinsFromStore,
  listProfileDeliveriesFromStore,
  readCommunicationJobFromStore,
  readCommunicationSummaryFromStore,
  readCommunicationTemplateFromStore,
  unsubscribeCommunicationProfileInStore,
} from "./communicationStore/queries";

export async function manageCommunicationInStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = operationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ code: "invalid_communication_operation" }, { status: 400 });
  const operation = parsed.data;
  if (!identityMatches(storage, operation.organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const now = new Date().toISOString();
  if (operation.action === "send") return sendMessage(storage, operation, now);
  if (operation.action === "save-draft") return saveDraft(storage, operation, now);
  if (operation.action === "retry") return retryMessage(storage, operation, now);
  if (operation.action === "save-template") return saveTemplate(storage, operation, now);
  if (operation.action === "update-template") return updateTemplate(storage, operation, now);
  if (operation.action === "delete-template") return deleteTemplate(storage, operation, now);
  if (operation.action === "delete-draft") return deleteDraft(storage, operation, now);
  return recordDeliveryResults(storage, operation, now);
}
