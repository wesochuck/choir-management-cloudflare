/**
 * Backward-compatible facade for contact import persistence.
 *
 * Implementation is modularized under `./contactImportStore/`:
 * - contracts.ts: job status, summary types, batch results, internal row types
 * - shared.ts: schemas, row readers, summaries, validation helpers
 * - staging.ts: staging lifecycle (create, update mapping, confirm, cancel)
 * - readModel.ts: getContactImportFromStore, preview, error CSV
 * - batch.ts: batch processing, contact matching, and finalization
 */

export {
  cancelContactImportInStore,
  confirmContactImportInStore,
  contactImportIdempotencyKey,
  createContactImportInStore,
  getContactImportFromStore,
  previewContactImportFromStore,
  processContactImportBatchInStore,
  readContactImportErrorCsvFromStore,
  updateContactImportMappingInStore,
  type ContactImportBatchResult,
  type ContactImportJobStatus,
  type ContactImportSummary,
} from "./contactImportStore/index";
