import type { SearchCategory, SearchResultItem } from "@choir/contracts";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { addRecentSearch } from "./recents";
import type { CommandPaletteProps, RecentItem } from "./types";
import { useAdminSearch } from "./useAdminSearch";

const CATEGORY_LABELS: Record<SearchCategory, string> = {
  actions: "Quick Actions",
  events: "Events & Calendar",
  music: "Music Library",
  navigation: "Pages & Navigation",
  polls: "Engagement Polls",
  roster: "Roster Profiles",
  settings: "Settings & Configuration",
};

const CATEGORY_ORDER: readonly SearchCategory[] = [
  "navigation",
  "settings",
  "roster",
  "events",
  "music",
  "polls",
  "actions",
];

const SEARCH_TIPS: readonly { readonly label: string; readonly prefix: string }[] = [
  { label: "Search members and parts", prefix: "roster:" },
  { label: "Search rehearsals and performances", prefix: "events:" },
  { label: "Search music pieces and arrangements", prefix: "music:" },
  { label: "Jump to configuration sections", prefix: "settings:" },
  { label: "Trigger administrative actions", prefix: "actions:" },
];

export function CommandPaletteModal({
  isOwner,
  modules,
  onClose,
  onNavigate,
  onToggleTheme,
  open,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchId = useId();
  const hostname = typeof window !== "undefined" ? window.location.hostname : "";

  const {
    clearRecents,
    isSearching,
    parsedQuery,
    query,
    recents,
    refreshRecents,
    results,
    setQuery,
  } = useAdminSearch({
    hostname,
    isOwner,
    modules,
  });

  const [selectedIndex, setSelectedIndex] = useState(0);

  // Group results by category
  const groupedResults = useMemo(() => {
    const map = new Map<SearchCategory, SearchResultItem[]>();
    for (const item of results) {
      const existing = map.get(item.category) ?? [];
      existing.push(item);
      map.set(item.category, existing);
    }
    return CATEGORY_ORDER.filter((cat) => map.has(cat)).map((cat) => ({
      category: cat,
      items: map.get(cat) ?? [],
      label: CATEGORY_LABELS[cat],
    }));
  }, [results]);

  // Flattened active list for keyboard navigation
  const flatSelectableItems = useMemo((): readonly (RecentItem | SearchResultItem)[] => {
    if (query.trim() === "") {
      return recents;
    }
    return results;
  }, [query, recents, results]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector<HTMLElement>('[data-selected="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const handleSelectItem = (item: RecentItem | SearchResultItem) => {
    // Save to recents
    addRecentSearch(hostname, {
      actionId: item.actionId,
      badge: item.badge,
      category: item.category,
      href: item.href,
      id: item.id,
      subtitle: item.subtitle,
      title: item.title,
    });

    onClose();

    if (item.actionId === "act-toggle-theme") {
      onToggleTheme();
      return;
    }

    if (item.href) {
      onNavigate(item.href);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (flatSelectableItems.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % flatSelectableItems.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (flatSelectableItems.length > 0) {
        setSelectedIndex(
          (prev) => (prev - 1 + flatSelectableItems.length) % flatSelectableItems.length,
        );
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      const currentItem = flatSelectableItems[selectedIndex];
      if (currentItem) {
        handleSelectItem(currentItem);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  let itemCounter = 0;

  return (
    <DialogPrimitive.Root
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        } else {
          refreshRecents();
          setQuery("");
        }
      }}
      open={open}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="command-palette-overlay" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          aria-label="Command Palette"
          className="command-palette-modal"
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            onClose();
          }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogPrimitive.Title className="sr-only">Admin Command Palette</DialogPrimitive.Title>

          <div className="command-palette-header">
            <span aria-hidden="true" className="command-palette-search-icon">
              <svg
                aria-hidden="true"
                fill="none"
                height="18"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="18"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </span>
            <input
              aria-activedescendant={
                flatSelectableItems.length > 0 && selectedIndex >= 0
                  ? `cmd-option-${String(selectedIndex)}`
                  : undefined
              }
              aria-autocomplete="list"
              aria-controls={searchId}
              aria-expanded="true"
              className="command-palette-input"
              id="admin-command-palette-input"
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search products, pages, and features..."
              ref={inputRef}
              role="combobox"
              type="text"
              value={query}
            />
            {isSearching ? (
              <span aria-label="Searching..." className="command-palette-spinner" role="status">
                <span className="spinner-dot" />
              </span>
            ) : null}
            <button
              aria-label="Close command palette"
              className="command-palette-close-btn"
              onClick={() => {
                onClose();
              }}
              type="button"
            >
              <kbd className="command-palette-kbd">Esc</kbd>
            </button>
          </div>

          <div className="command-palette-body" id={searchId} ref={listRef} role="listbox">
            {query.trim() === "" ? (
              <>
                {recents.length > 0 ? (
                  <div className="command-palette-group">
                    <div className="command-palette-group-header">
                      <span>Recents</span>
                      <button
                        className="command-palette-clear-btn"
                        onClick={() => {
                          clearRecents();
                        }}
                        type="button"
                      >
                        Clear
                      </button>
                    </div>
                    {recents.map((item) => {
                      const currentIndex = itemCounter++;
                      const isSelected = selectedIndex === currentIndex;
                      return (
                        <div
                          aria-selected={isSelected}
                          className={`command-palette-item ${isSelected ? "is-selected" : ""}`}
                          data-selected={isSelected ? "true" : "false"}
                          id={`cmd-option-${String(currentIndex)}`}
                          key={`recent-${item.id}`}
                          onClick={() => {
                            handleSelectItem(item);
                          }}
                          onMouseEnter={() => {
                            setSelectedIndex(currentIndex);
                          }}
                          role="option"
                        >
                          <span aria-hidden="true" className="command-palette-item-icon">
                            <svg
                              aria-hidden="true"
                              fill="none"
                              height="16"
                              stroke="currentColor"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                              width="16"
                            >
                              <circle cx="12" cy="12" r="10" />
                              <polyline points="12 6 12 12 16 14" />
                            </svg>
                          </span>
                          <div className="command-palette-item-text">
                            <div className="command-palette-item-title">{item.title}</div>
                            {item.subtitle ? (
                              <div className="command-palette-item-subtitle">{item.subtitle}</div>
                            ) : null}
                          </div>
                          {item.badge ? (
                            <span className="command-palette-item-badge">{item.badge}</span>
                          ) : null}
                          <span aria-hidden="true" className="command-palette-item-arrow">
                            →
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="command-palette-group">
                  <div className="command-palette-group-header">
                    <span>Search tips</span>
                  </div>
                  <div className="command-palette-tips-list">
                    {SEARCH_TIPS.map((tip) => (
                      <button
                        className="command-palette-tip-item"
                        key={tip.prefix}
                        onClick={() => {
                          setQuery(tip.prefix + " ");
                          inputRef.current?.focus();
                        }}
                        type="button"
                      >
                        <span className="command-palette-tip-prefix">{tip.prefix}</span>
                        <span className="command-palette-tip-desc">{tip.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : results.length > 0 ? (
              groupedResults.map((group) => (
                <div className="command-palette-group" key={group.category}>
                  <div className="command-palette-group-header">
                    <span>{group.label}</span>
                  </div>
                  {group.items.map((item) => {
                    const currentIndex = itemCounter++;
                    const isSelected = selectedIndex === currentIndex;
                    return (
                      <div
                        aria-selected={isSelected}
                        className={`command-palette-item ${isSelected ? "is-selected" : ""}`}
                        data-selected={isSelected ? "true" : "false"}
                        id={`cmd-option-${String(currentIndex)}`}
                        key={item.id}
                        onClick={() => {
                          handleSelectItem(item);
                        }}
                        onMouseEnter={() => {
                          setSelectedIndex(currentIndex);
                        }}
                        role="option"
                      >
                        <span aria-hidden="true" className="command-palette-item-icon">
                          {item.category === "actions" ? (
                            <svg
                              aria-hidden="true"
                              fill="none"
                              height="16"
                              stroke="currentColor"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                              width="16"
                            >
                              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                            </svg>
                          ) : item.category === "roster" ? (
                            <svg
                              aria-hidden="true"
                              fill="none"
                              height="16"
                              stroke="currentColor"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                              width="16"
                            >
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                          ) : item.category === "events" ? (
                            <svg
                              aria-hidden="true"
                              fill="none"
                              height="16"
                              stroke="currentColor"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                              width="16"
                            >
                              <rect height="18" rx="2" ry="2" width="18" x="3" y="4" />
                              <line x1="16" x2="16" y1="2" y2="6" />
                              <line x1="8" x2="8" y1="2" y2="6" />
                              <line x1="3" x2="21" y1="10" y2="10" />
                            </svg>
                          ) : item.category === "music" ? (
                            <svg
                              aria-hidden="true"
                              fill="none"
                              height="16"
                              stroke="currentColor"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                              width="16"
                            >
                              <path d="M9 18V5l12-2v13" />
                              <circle cx="6" cy="18" r="3" />
                              <circle cx="18" cy="16" r="3" />
                            </svg>
                          ) : item.category === "settings" ? (
                            <svg
                              aria-hidden="true"
                              fill="none"
                              height="16"
                              stroke="currentColor"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                              width="16"
                            >
                              <circle cx="12" cy="12" r="3" />
                              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                            </svg>
                          ) : (
                            <svg
                              aria-hidden="true"
                              fill="none"
                              height="16"
                              stroke="currentColor"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                              width="16"
                            >
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                          )}
                        </span>
                        <div className="command-palette-item-text">
                          <div className="command-palette-item-title">{item.title}</div>
                          {item.subtitle ? (
                            <div className="command-palette-item-subtitle">{item.subtitle}</div>
                          ) : null}
                        </div>
                        {item.badge ? (
                          <span className="command-palette-item-badge">{item.badge}</span>
                        ) : null}
                        <span aria-hidden="true" className="command-palette-item-arrow">
                          →
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            ) : !isSearching ? (
              <div className="command-palette-empty">
                <p>No results found for &ldquo;{parsedQuery.cleanTerm}&rdquo;</p>
                <span>
                  Try searching by member name, song title, or a prefix like <code>settings:</code>
                </span>
              </div>
            ) : null}
          </div>

          <div className="command-palette-footer">
            <div className="command-palette-footer-shortcuts">
              <span className="command-palette-shortcut">
                <kbd className="command-palette-kbd">↑</kbd>
                <kbd className="command-palette-kbd">↓</kbd>
                <span>to navigate</span>
              </span>
              <span className="command-palette-shortcut">
                <kbd className="command-palette-kbd">↵</kbd>
                <span>to select</span>
              </span>
              <span className="command-palette-shortcut">
                <kbd className="command-palette-kbd">esc</kbd>
                <span>to close</span>
              </span>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
