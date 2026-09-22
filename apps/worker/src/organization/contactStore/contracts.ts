import type { ContactCommunicationStatus } from "@choir/contracts";
import type { SqlStorageValue } from "@cloudflare/workers-types";

export interface ContactStoreStorage {
  readonly sql: {
    exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: readonly unknown[]
    ): {
      toArray(): T[];
    };
  };
  transactionSync<T>(fn: () => T): T;
}

export type ContactStoreErrorCode =
  | "organization_identity_conflict"
  | "contact_not_found"
  | "contact_duplicate_email"
  | "contact_missing_identity"
  | "contact_profile_not_found"
  | "contact_list_not_found"
  | "contact_import_not_found"
  | "contact_import_conflict"
  | "validation_failed";

export class ContactStoreError extends Error {
  readonly code: ContactStoreErrorCode;

  constructor(code: ContactStoreErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = "ContactStoreError";
    this.code = code;
  }
}

export interface CreateContactInput {
  readonly actorUserId: string;
  readonly contactId: string;
  readonly displayName?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly emailStatus?: ContactCommunicationStatus | undefined;
  readonly firstName?: string | null | undefined;
  readonly lastName?: string | null | undefined;
  readonly organizationId: string;
  readonly phone?: string | null | undefined;
  readonly preferenceSource?: string | null | undefined;
  readonly profileId?: string | null | undefined;
  readonly requestId: string;
  readonly smsStatus?: ContactCommunicationStatus | undefined;
  readonly source?: string | null | undefined;
}

export interface UpdateContactInput {
  readonly actorUserId: string;
  readonly contactId: string;
  readonly displayName?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly emailStatus?: ContactCommunicationStatus | undefined;
  readonly firstName?: string | null | undefined;
  readonly lastName?: string | null | undefined;
  readonly organizationId: string;
  readonly phone?: string | null | undefined;
  readonly preferenceSource?: string | null | undefined;
  readonly profileId?: string | null | undefined;
  readonly requestId: string;
  readonly smsStatus?: ContactCommunicationStatus | undefined;
  readonly source?: string | null | undefined;
}

export interface ListContactsInput {
  readonly channel?: "email" | "sms" | undefined;
  readonly cursor?: string | null | undefined;
  readonly includeDetails?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly listId?: string | null | undefined;
  readonly organizationId?: string | null | undefined;
  readonly query?: string | null | undefined;
  readonly source?: string | null | undefined;
  readonly status?: ContactCommunicationStatus | undefined;
}

export interface CreateContactListInput {
  readonly actorUserId: string;
  readonly description?: string | null | undefined;
  readonly listId: string;
  readonly name: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export interface UpdateContactListInput {
  readonly actorUserId: string;
  readonly description?: string | null | undefined;
  readonly listId: string;
  readonly name?: string | undefined;
  readonly organizationId: string;
  readonly requestId: string;
}

export interface ContactMutationContext {
  readonly actorUserId: string;
  readonly listId: string;
  readonly organizationId: string;
  readonly requestId: string;
}

export interface BulkMembershipInput extends ContactMutationContext {
  readonly contactIds: readonly string[];
}

export interface ContactDetailList {
  readonly id: string;
  readonly name: string;
}

export interface ContactDetailLinkedProfile {
  readonly displayName: string;
  readonly id: string;
}

export interface ContactDetailActivity {
  readonly donationCount: number;
  readonly ticketPurchaseCount: number;
}
