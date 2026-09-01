import type { SearchCategory, SearchResultItem } from "@choir/contracts";
import { useEffect, useMemo, useRef, useState } from "react";

import { searchOrganization } from "../../../api/search";

import { staticNavigationItems } from "./navigationIndex";
import { clearRecentSearches, getRecentSearches } from "./recents";
import type { PrefixKeyword, RecentItem } from "./types";

export interface ParsedSearchQuery {
  readonly cleanTerm: string;
  readonly prefix: PrefixKeyword | null;
  readonly scopedCategory: SearchCategory | null;
}

export function parseQuery(rawQuery: string): ParsedSearchQuery {
  const trimmed = rawQuery.trim();
  const colonIndex = trimmed.indexOf(":");
  if (colonIndex > 0) {
    const potentialPrefix = trimmed.slice(0, colonIndex).toLowerCase();
    const cleanTerm = trimmed.slice(colonIndex + 1).trim();
    switch (potentialPrefix) {
      case "roster":
        return { cleanTerm, prefix: "roster", scopedCategory: "roster" };
      case "event":
      case "events":
        return { cleanTerm, prefix: "events", scopedCategory: "events" };
      case "music":
        return { cleanTerm, prefix: "music", scopedCategory: "music" };
      case "settings":
      case "setting":
        return { cleanTerm, prefix: "settings", scopedCategory: "settings" };
      case "poll":
      case "polls":
        return { cleanTerm, prefix: "polls", scopedCategory: "polls" };
      case "action":
      case "actions":
        return { cleanTerm, prefix: "actions", scopedCategory: "actions" };
      default:
        break;
    }
  }
  return { cleanTerm: trimmed, prefix: null, scopedCategory: null };
}

export function useAdminSearch({
  hostname,
  isOwner,
  modules,
}: {
  readonly hostname: string;
  readonly isOwner: boolean;
  readonly modules: readonly string[];
}) {
  const [query, setQuery] = useState("");
  const [serverResults, setServerResults] = useState<readonly SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [recents, setRecents] = useState<readonly RecentItem[]>(() => getRecentSearches(hostname));

  const parsed = useMemo(() => parseQuery(query), [query]);

  // Refresh recents on mount or when hostname changes
  const refreshRecents = () => {
    setRecents(getRecentSearches(hostname));
  };

  const handleClearRecents = () => {
    clearRecentSearches(hostname);
    setRecents([]);
  };

  // Client-side static navigation filtering
  const clientResults = useMemo(() => {
    if (!parsed.cleanTerm && !parsed.scopedCategory) return [];

    const enabledModules = new Set(modules);
    const searchTerms = parsed.cleanTerm.toLowerCase().split(/\s+/).filter(Boolean);

    return staticNavigationItems
      .filter((item) => {
        if (item.requiredModule && !enabledModules.has(item.requiredModule)) return false;
        if (item.ownerOnly && !isOwner) return false;
        if (parsed.scopedCategory && item.category !== parsed.scopedCategory) return false;
        if (searchTerms.length === 0) return true;

        const targetText = `${item.title} ${item.subtitle ?? ""} ${item.category}`.toLowerCase();
        return searchTerms.every((term) => targetText.includes(term));
      })
      .map((item): SearchResultItem => ({
        actionId: item.id.startsWith("act-") ? item.id : undefined,
        badge: item.badge,
        category: item.category,
        href: item.href,
        id: item.id,
        subtitle: item.subtitle,
        title: item.title,
      }));
  }, [parsed.cleanTerm, parsed.scopedCategory, modules, isOwner]);

  // Server-side debounced entity search
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!parsed.cleanTerm) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear results when query becomes empty
      setServerResults([]);
      setIsSearching(false);
      return;
    }

    // Skip server call if explicitly filtering purely for settings or actions
    if (parsed.scopedCategory === "settings" || parsed.scopedCategory === "actions") {
      setServerResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timeout = setTimeout(() => {
      searchOrganization(
        {
          category: parsed.scopedCategory ?? undefined,
          limit: 15,
          query: parsed.cleanTerm,
        },
        controller.signal,
      )
        .then((items) => {
          if (!controller.signal.aborted) {
            setServerResults(items);
            setIsSearching(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setServerResults([]);
            setIsSearching(false);
          }
        });
    }, 120);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [parsed.cleanTerm, parsed.scopedCategory]);

  const combinedResults = useMemo((): readonly SearchResultItem[] => {
    if (!parsed.cleanTerm && !parsed.scopedCategory) return [];
    return [...clientResults, ...serverResults];
  }, [clientResults, serverResults, parsed.cleanTerm, parsed.scopedCategory]);

  return {
    clearRecents: handleClearRecents,
    isSearching,
    parsedQuery: parsed,
    query,
    recents,
    refreshRecents,
    results: combinedResults,
    setQuery,
  };
}
