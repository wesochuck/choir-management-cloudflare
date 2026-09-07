export interface ContactIdentityInput {
  readonly displayName?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly firstName?: string | null | undefined;
  readonly lastName?: string | null | undefined;
  readonly normalizedEmail?: string | null | undefined;
  readonly normalizedPhone?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly profileId?: string | null | undefined;
}

export type ContactConsentStatus = "unknown" | "subscribed" | "unsubscribed";
export type ContactConsentStatusWithSuppression = ContactConsentStatus | "suppressed";

function nonBlank(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Produces the matching key for an email without changing the entered/display
 * value stored on a Contact. Missing values remain null for persistence code.
 */
export function normalizeEmail(value: string): string;
export function normalizeEmail(value: string | null | undefined): string | null;
export function normalizeEmail(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : value.trim().toLowerCase();
}

/**
 * Converts common formatted telephone input to E.164 without calling a
 * provider. Numbers without an international prefix use the supplied country
 * code, which defaults to North America (+1).
 */
export function normalizePhone(
  value: string | null | undefined,
  defaultCountryCode = "+1",
): string | null {
  const input = value?.trim() ?? "";
  if (!input || !/^[+\d().\s-]+$/.test(input)) return null;

  const hasInternationalPrefix = input.startsWith("+");
  if (hasInternationalPrefix && input.slice(1).includes("+")) return null;

  let digits = input.replace(/\D/g, "");
  if (input.startsWith("00")) {
    digits = digits.slice(2);
  } else if (!hasInternationalPrefix) {
    const countryCode = defaultCountryCode.replace(/^\+/, "");
    if (!/^[1-9]\d{0,2}$/.test(countryCode)) return null;
    if (!(digits.length > 10 && digits.startsWith(countryCode))) {
      digits = `${countryCode}${digits}`;
    }
  }

  return /^[1-9]\d{1,14}$/.test(digits) ? `+${digits}` : null;
}

/** Returns true when a Contact has at least one usable identity or method. */
export function hasAcceptableContactIdentity(
  value: ContactIdentityInput | null | undefined,
): boolean {
  if (!value) return false;
  return [
    value.displayName,
    value.email,
    value.firstName,
    value.lastName,
    value.normalizedEmail,
    value.normalizedPhone,
    value.phone,
    value.profileId,
  ].some((candidate) => nonBlank(candidate).length > 0);
}

export function deriveDisplayName(input: ContactIdentityInput): string;
export function deriveDisplayName(
  firstName?: string | null,
  lastName?: string | null,
  displayName?: string | null,
): string;
export function deriveDisplayName(
  inputOrFirstName?: ContactIdentityInput | string | null,
  lastName?: string | null,
  displayName?: string | null,
): string {
  const input =
    typeof inputOrFirstName === "object" && inputOrFirstName !== null
      ? inputOrFirstName
      : {
          displayName,
          email: undefined,
          firstName: inputOrFirstName,
          lastName,
          normalizedEmail: undefined,
          normalizedPhone: undefined,
          phone: undefined,
          profileId: undefined,
        };

  const explicitDisplayName = nonBlank(input.displayName);
  if (explicitDisplayName) return explicitDisplayName;

  const nameParts = [nonBlank(input.firstName), nonBlank(input.lastName)].filter(Boolean);
  if (nameParts.length > 0) return nameParts.join(" ");

  const email = nonBlank(input.email);
  if (email) return email;

  return nonBlank(input.phone);
}

function recognizedConsentStatus(
  value: string | null | undefined,
): ContactConsentStatusWithSuppression | null {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === "unknown" ||
    normalized === "subscribed" ||
    normalized === "unsubscribed" ||
    normalized === "suppressed"
  ) {
    return normalized;
  }
  return null;
}

/**
 * Merges an imported channel status with the existing status. Existing
 * unsubscribe/suppression is irreversible here; a future explicit admin
 * resubscribe workflow must be a separate operation. Blank and unknown input
 * never downgrades an existing status.
 */
export function mergeContactCommunicationStatus(
  existing: string | null | undefined,
  imported: string | null | undefined,
): ContactConsentStatusWithSuppression {
  const current = recognizedConsentStatus(existing) ?? "unknown";
  const incoming = recognizedConsentStatus(imported);

  if (current === "suppressed" || current === "unsubscribed") return current;
  if (incoming === "suppressed" || incoming === "unsubscribed") return incoming;
  if (incoming === "subscribed") return "subscribed";
  return current;
}

export const normalizeContactEmail = normalizeEmail;
export const normalizeContactPhone = normalizePhone;
export const deriveContactDisplayName = deriveDisplayName;
export const mergeContactCommunicationPreferenceStatus = mergeContactCommunicationStatus;
export const mergeContactConsentStatus = mergeContactCommunicationStatus;
