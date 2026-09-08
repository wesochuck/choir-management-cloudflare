import type { AutocompleteOption } from "@choir/ui";

export interface DesignSystemSection {
  readonly href: string;
  readonly id: string;
  readonly label: string;
}

export const DESIGN_SYSTEM_SECTIONS: readonly DesignSystemSection[] = [
  { href: "#ds-foundations", id: "ds-foundations", label: "Foundations" },
  { href: "#ds-buttons", id: "ds-buttons", label: "Buttons & actions" },
  { href: "#ds-notices", id: "ds-notices", label: "Notices & status" },
  { href: "#ds-forms", id: "ds-forms", label: "Forms" },
  { href: "#ds-primitives", id: "ds-primitives", label: "UI primitives" },
  { href: "#ds-patterns", id: "ds-patterns", label: "Patterns" },
];

export interface DesignSystemToken {
  readonly cssVar: string;
  readonly name: string;
}

export const DESIGN_SYSTEM_COLOR_TOKENS: readonly DesignSystemToken[] = [
  { cssVar: "--color-background", name: "Background" },
  { cssVar: "--color-surface", name: "Surface" },
  { cssVar: "--color-surface-raised", name: "Surface raised" },
  { cssVar: "--color-text", name: "Text" },
  { cssVar: "--color-text-muted", name: "Text muted" },
  { cssVar: "--color-primary", name: "Primary" },
  { cssVar: "--color-primary-strong", name: "Primary strong" },
  { cssVar: "--color-primary-foreground", name: "Primary foreground" },
  { cssVar: "--color-accent", name: "Accent" },
  { cssVar: "--color-border", name: "Border" },
  { cssVar: "--color-danger", name: "Danger" },
  { cssVar: "--color-danger-surface", name: "Danger surface" },
  { cssVar: "--color-danger-foreground", name: "Danger foreground" },
  { cssVar: "--color-info-surface", name: "Info surface" },
  { cssVar: "--color-success", name: "Success" },
];

export const DESIGN_SYSTEM_TYPE_SCALE: readonly DesignSystemToken[] = [
  { cssVar: "--font-size-xs", name: "XS" },
  { cssVar: "--font-size-sm", name: "SM" },
  { cssVar: "--font-size-md", name: "MD" },
  { cssVar: "--font-size-base", name: "Base" },
  { cssVar: "--font-size-body", name: "Body" },
  { cssVar: "--font-size-lg", name: "LG" },
  { cssVar: "--font-size-xl", name: "XL" },
  { cssVar: "--font-size-2xl", name: "2XL" },
  { cssVar: "--font-size-section", name: "Section" },
];

export const DESIGN_SYSTEM_RADII: readonly DesignSystemToken[] = [
  { cssVar: "--radius-sm", name: "SM" },
  { cssVar: "--radius-md", name: "MD" },
  { cssVar: "--radius-lg", name: "LG" },
  { cssVar: "--radius-xl", name: "XL" },
  { cssVar: "--radius-control", name: "Control" },
  { cssVar: "--radius-card", name: "Card" },
];

export const DESIGN_SYSTEM_SHADOWS: readonly DesignSystemToken[] = [
  { cssVar: "--shadow-sm", name: "SM" },
  { cssVar: "--shadow-md", name: "MD" },
  { cssVar: "--shadow-lg", name: "LG" },
  { cssVar: "--shadow-xl", name: "XL" },
];

export const DESIGN_SYSTEM_SPACING: readonly DesignSystemToken[] = [
  { cssVar: "--spacing-3xs", name: "3XS" },
  { cssVar: "--spacing-2xs", name: "2XS" },
  { cssVar: "--spacing-xs", name: "XS" },
  { cssVar: "--spacing-sm", name: "SM" },
  { cssVar: "--spacing-md", name: "MD" },
  { cssVar: "--spacing-lg", name: "LG" },
  { cssVar: "--spacing-xl", name: "XL" },
  { cssVar: "--spacing-2xl", name: "2XL" },
];

export interface DesignSystemTableRow {
  readonly id: string;
  readonly name: string;
  readonly part: string;
  readonly status: string;
}

export const DESIGN_SYSTEM_TABLE_ROWS: readonly DesignSystemTableRow[] = [
  { id: "ds-alto", name: "Ava Alto", part: "Alto", status: "Active" },
  { id: "ds-bass", name: "Ben Bass", part: "Bass", status: "Active" },
  { id: "ds-break", name: "Bo Break", part: "Tenor", status: "On Break" },
  { id: "ds-soprano", name: "Sue Soprano", part: "Soprano", status: "Active" },
  { id: "ds-tenor", name: "Tom Tenor", part: "Tenor", status: "Pending" },
  { id: "ds-pending", name: "Pam Pending", part: "Alto", status: "Pending" },
];

export const AUTOCOMPLETE_SOURCE: readonly AutocompleteOption[] = [
  { id: "soprano", label: "Soprano" },
  { id: "alto", label: "Alto" },
  { id: "tenor", label: "Tenor" },
  { id: "bass", label: "Bass" },
  { id: "director", label: "Director" },
  { id: "accompanist", label: "Accompanist" },
];

export function filterAutocompleteOptions(
  query: string,
  source: readonly AutocompleteOption[] = AUTOCOMPLETE_SOURCE,
): readonly AutocompleteOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return source;
  return source.filter((option) => option.label.toLowerCase().includes(normalized));
}
