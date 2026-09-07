import type { ContactCommunicationStatus } from "@choir/contracts";
import { hasAcceptableContactIdentity } from "@choir/domain";

export interface ContactEditorValues {
  readonly displayName: string;
  readonly email: string;
  readonly emailStatus: ContactCommunicationStatus;
  readonly firstName: string;
  readonly lastName: string;
  readonly listIds: readonly string[];
  readonly phone: string;
  readonly profileId: string;
  readonly smsStatus: ContactCommunicationStatus;
  readonly source: string;
}

export interface ContactEditorInitial {
  readonly displayName: string;
  readonly email: string;
  readonly emailStatus: ContactCommunicationStatus;
  readonly firstName: string;
  readonly lastName: string;
  readonly listIds: readonly string[];
  readonly phone: string;
  readonly profileId: string;
  readonly smsStatus: ContactCommunicationStatus;
  readonly source: string;
}

export const EMPTY_CONTACT_EDITOR_VALUES: ContactEditorValues = {
  displayName: "",
  email: "",
  emailStatus: "unknown",
  firstName: "",
  lastName: "",
  listIds: [],
  phone: "",
  profileId: "",
  smsStatus: "unknown",
  source: "",
};

export interface ContactEditorFieldErrors {
  readonly email?: string | undefined;
  readonly identity?: string | undefined;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Client-side affordance validation; the contract/store layers remain the integrity boundary. */
export function validateContactEditorValues(values: ContactEditorValues): ContactEditorFieldErrors {
  const errors: { email?: string; identity?: string } = {};
  const trimmedEmail = values.email.trim();
  if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
    errors.email = "Enter a valid email address.";
  }
  if (
    !hasAcceptableContactIdentity({
      displayName: values.displayName.trim() || null,
      email: trimmedEmail || null,
      firstName: values.firstName.trim() || null,
      lastName: values.lastName.trim() || null,
      phone: values.phone.trim() || null,
      profileId: values.profileId || null,
    })
  ) {
    errors.identity = "A contact needs a name, email, phone, or linked Organization Profile.";
  }
  return errors;
}

export function contactEditorBaselineKey(values: ContactEditorValues): string {
  return JSON.stringify({ ...values, listIds: [...values.listIds].toSorted() });
}
