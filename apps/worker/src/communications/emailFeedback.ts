export {
  emailProviderSourceKindSchema,
  type EmailProviderSourceKind,
} from "./emailFeedback/contracts";
export { parseCloudflareEmailEvent } from "./emailFeedback/parser";
export {
  assertEmailProviderRecipientAvailable,
  assertEmailProviderRecipientsAvailable,
  attachEmailProviderMessage,
  backfillEmailProviderRoutes,
  EmailRecipientSuppressedError,
  isEmailProviderSuppressed,
  markEmailProviderRouteUnknown,
  prepareEmailProviderRoute,
} from "./emailFeedback/routes";
export {
  acknowledgeEmailProviderDeadLetter,
  acknowledgeEmailProviderEvent,
  processEmailProviderDeadLetterBatch,
  processEmailProviderEventById,
  processEmailProviderQueue,
  reconcileEmailProviderEvents,
  retryEmailProviderEvent,
} from "./emailFeedback/queue";
