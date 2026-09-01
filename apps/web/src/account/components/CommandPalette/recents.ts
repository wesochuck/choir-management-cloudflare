import { searchCategorySchema, type SearchCategory } from "@choir/contracts";
import { z } from "zod";

import type { RecentItem } from "./types";

const MAX_RECENTS = 6;

const recentItemSchema = z.object({
  actionId: z.string().optional(),
  badge: z.string().optional(),
  category: searchCategorySchema,
  href: z.string().optional(),
  id: z.string(),
  subtitle: z.string().optional(),
  timestamp: z.number(),
  title: z.string(),
});

function recentsStorageKey(hostname: string): string {
  return `choir-admin-search-recents:${hostname}`;
}

export function getRecentSearches(hostname: string): readonly RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(recentsStorageKey(hostname));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const validated: RecentItem[] = [];
    for (const item of parsed) {
      const result = recentItemSchema.safeParse(item);
      if (result.success) {
        validated.push({
          actionId: result.data.actionId,
          badge: result.data.badge,
          category: result.data.category,
          href: result.data.href,
          id: result.data.id,
          subtitle: result.data.subtitle,
          timestamp: result.data.timestamp,
          title: result.data.title,
        });
      }
    }
    return validated.slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function addRecentSearch(
  hostname: string,
  item: {
    readonly actionId?: string | undefined;
    readonly badge?: string | undefined;
    readonly category: SearchCategory;
    readonly href?: string | undefined;
    readonly id: string;
    readonly subtitle?: string | undefined;
    readonly title: string;
  },
): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getRecentSearches(hostname);
    const filtered = existing.filter((r) => r.id !== item.id && r.title !== item.title);
    const next: RecentItem[] = [
      {
        actionId: item.actionId,
        badge: item.badge,
        category: item.category,
        href: item.href,
        id: item.id,
        subtitle: item.subtitle,
        timestamp: Date.now(),
        title: item.title,
      },
      ...filtered,
    ].slice(0, MAX_RECENTS);
    window.localStorage.setItem(recentsStorageKey(hostname), JSON.stringify(next));
  } catch {
    // Ignore restricted storage
  }
}

export function clearRecentSearches(hostname: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(recentsStorageKey(hostname));
  } catch {
    // Ignore restricted storage
  }
}
