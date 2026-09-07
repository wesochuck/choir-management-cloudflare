import {
  CONTACT_EXPORT_SELECTION_MAX,
  contactExportResponseSchema,
  type Contact,
  type ContactCommunicationPreference,
  type ContactExportResponse,
} from "@choir/contracts";
import { deriveDisplayName } from "@choir/domain";

/**
 * Phase 4 browser-side CSV export.
 *
 * The export contract (`contactExportResponseSchema`) is reused as the
 * validation boundary: every export payload is parsed against it, so the
 * `csv` / `downloadName` / `rowCount` shape stays identical to the Phase 1
 * server contract. Selection is capped at CONTACT_EXPORT_SELECTION_MAX rows;
 * callers surface truncation from the returned `truncated` flag.
 */

export interface ContactExportRowInput {
  readonly contact: Contact;
  readonly emailStatus: string;
  readonly listNames: readonly string[];
  readonly smsStatus: string;
}

export interface BuiltContactExport extends ContactExportResponse {
  readonly truncated: boolean;
}

export const CONTACT_EXPORT_COLUMNS = [
  "Display Name",
  "First Name",
  "Last Name",
  "Email",
  "Phone",
  "Source",
  "Email Status",
  "SMS Status",
  "Lists",
  "Updated At",
] as const;

const dangerousFormulaPrefix = /^[=+\-@\t\r]/;

function csvField(value: string): string {
  const safe = dangerousFormulaPrefix.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function statusLabel(status: string): string {
  if (status === "subscribed" || status === "unsubscribed") return status;
  return "unknown";
}

export function contactExportRow(input: ContactExportRowInput): string {
  const { contact } = input;
  return [
    deriveDisplayName({
      displayName: contact.displayName,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
    }),
    contact.firstName ?? "",
    contact.lastName ?? "",
    contact.email ?? "",
    contact.phone ?? "",
    contact.source ?? "",
    statusLabel(input.emailStatus),
    statusLabel(input.smsStatus),
    input.listNames.join("; "),
    contact.updatedAt,
  ]
    .map(csvField)
    .join(",");
}

export function preferenceStatus(
  preferences: readonly ContactCommunicationPreference[],
  contactId: string,
  channel: "email" | "sms",
): string {
  return (
    preferences.find(
      (preference) => preference.contactId === contactId && preference.channel === channel,
    )?.status ?? "unknown"
  );
}

/**
 * Builds a validated CSV export payload for the given contacts. Rows beyond
 * CONTACT_EXPORT_SELECTION_MAX are dropped and reported via `truncated`.
 */
export function buildContactsExportCsv(
  contacts: readonly Contact[],
  resolveRow: (contact: Contact) => Omit<ContactExportRowInput, "contact">,
): BuiltContactExport {
  const truncated = contacts.length > CONTACT_EXPORT_SELECTION_MAX;
  const selected = truncated ? contacts.slice(0, CONTACT_EXPORT_SELECTION_MAX) : contacts;
  const lines = [
    CONTACT_EXPORT_COLUMNS.map(csvField).join(","),
    ...selected.map((contact) => contactExportRow({ ...resolveRow(contact), contact })),
  ];
  const parsed = contactExportResponseSchema.parse({
    csv: lines.join("\n"),
    downloadName: "contacts.csv",
    requestId: crypto.randomUUID(),
    rowCount: selected.length,
  });
  return { ...parsed, truncated };
}

/** Triggers a file download for a validated export payload. No-op without a DOM. */
export function downloadContactsExport(exported: ContactExportResponse): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([exported.csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", exported.downloadName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
