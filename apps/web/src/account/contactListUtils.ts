export interface ContactListFormValues {
  readonly description: string;
  readonly name: string;
}

export const EMPTY_CONTACT_LIST_VALUES: ContactListFormValues = { description: "", name: "" };

export function validateContactListValues(values: ContactListFormValues): string | null {
  if (!values.name.trim()) return "Enter a list name.";
  if (values.name.trim().length > 200) return "List names must be 200 characters or fewer.";
  if (values.description.length > 2000) return "Descriptions must be 2,000 characters or fewer.";
  return null;
}
