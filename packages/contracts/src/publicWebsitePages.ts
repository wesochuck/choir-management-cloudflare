import { z } from "zod";

// Root ownership includes application, signed-link, platform, API, and asset routes.
export const reservedPublicWebsiteSlugs: ReadonlySet<string> = new Set([
  "cdn-cgi",
  "member",
  "calendar",
  "directory",
  "dues",
  "practice",
  "profile",
  "schedule",
  "seating",
  "resources",
  "internal",
  "sign-in",
  "sw",
  "g",
  "api",
  "assets",
  "account",
  "admin",
  "platform",
  "setup",
  "login",
  "logout",
  "performances",
  "tickets",
  "donate",
  "donations",
  "auditions",
  "join",
  "rsvp",
  "poll",
  "unsubscribe",
  "player",
  "forgot-password",
  "reset-password",
  "confirm-email-change",
  "accept-invitation",
  "join-roster",
  "privacy",
  "terms",
  "members",
  "events",
  "music",
  "communications",
  "settings",
  "dashboard",
  "documents",
  "files",
  "health",
  "ready",
]);

export function isPublicWebsiteSlug(slug: string): boolean {
  return (
    slug.length <= 120 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
    !reservedPublicWebsiteSlugs.has(slug)
  );
}

export function isPublicContentPath(path: string): boolean {
  return path.startsWith("/") && isPublicWebsiteSlug(path.slice(1));
}

export const publicWebsitePageObjectSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .refine((id) => id !== "home", "Home is reserved."),
  title: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(120)
    .refine(
      isPublicWebsiteSlug,
      "Choose a lowercase URL using words separated by hyphens, outside application routes.",
    ),
  body: z.string().max(100_000),
  showInNavigation: z.boolean(),
  // Legacy History may have a distinct menu label. New pages use their title.
  navigationLabel: z.string().trim().min(1).max(60).optional(),
});
export const publicWebsitePagesSchema = z
  .array(publicWebsitePageObjectSchema)
  .max(50)
  .superRefine((pages, ctx) => {
    const ids = new Set<string>();
    const slugs = new Set<string>();
    pages.forEach((page, index) => {
      if (ids.has(page.id))
        ctx.addIssue({ code: "custom", path: [index, "id"], message: "Page IDs must be unique." });
      if (slugs.has(page.slug))
        ctx.addIssue({
          code: "custom",
          path: [index, "slug"],
          message: "Page URLs must be unique.",
        });
      ids.add(page.id);
      slugs.add(page.slug);
    });
  });
export type PublicWebsitePage = z.infer<typeof publicWebsitePageObjectSchema>;

export function normalizedPublicWebsitePages(settings: {
  readonly pages?: readonly PublicWebsitePage[] | undefined;
  readonly historyText: string;
  readonly pageLabels?:
    | {
        readonly history?:
          | { readonly heading?: string | undefined; readonly navigationLabel?: string | undefined }
          | undefined;
      }
    | undefined;
}): PublicWebsitePage[] {
  if (settings.pages !== undefined) return [...settings.pages];
  if (!settings.historyText.trim()) return [];
  return [
    {
      id: "legacy-history",
      slug: "history",
      title: settings.pageLabels?.history?.heading ?? "Our History",
      body: settings.historyText,
      showInNavigation: true,
      navigationLabel:
        settings.pageLabels?.history?.navigationLabel ??
        settings.pageLabels?.history?.heading ??
        "History",
    },
  ];
}

export const publicWebsiteSettingsMaxBytes = 500_000;
export function validatePublicWebsiteSettingsSize(settings: unknown, ctx: z.RefinementCtx): void {
  const metadata = new Set([
    "organizationName",
    "publicationVersion",
    "publishedAt",
    "updatedAt",
    "draftRevision",
    "expectedDraftRevision",
    "requestId",
  ]);
  const content =
    typeof settings === "object" && settings !== null
      ? Object.fromEntries(Object.entries(settings).filter(([key]) => !metadata.has(key)))
      : settings;
  if (
    new TextEncoder().encode(JSON.stringify(content)).byteLength > publicWebsiteSettingsMaxBytes
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Website settings must be 500,000 UTF-8 bytes or smaller.",
    });
  }
}
