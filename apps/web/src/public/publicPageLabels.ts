import type { PublicWebsiteSettingsRequest } from "@choir/contracts";

type PageNames = Pick<PublicWebsiteSettingsRequest, "pageLabels">;
type Page = keyof NonNullable<PublicWebsiteSettingsRequest["pageLabels"]>;
const defaultNavigation = {
  performances: "Performances",
  history: "History",
  tickets: "Tickets",
  donations: "Donate",
  auditions: "Auditions",
} as const;

export function publicPageNavigationLabel(settings: PageNames, page: Page): string {
  const labels = settings.pageLabels?.[page];
  return labels?.navigationLabel ?? labels?.heading ?? defaultNavigation[page];
}
export function publicPageHeading(settings: PageNames, page: Page, fallback: string): string {
  return settings.pageLabels?.[page]?.heading ?? fallback;
}
