interface QuickSearchTriggerProps {
  readonly className?: string;
  readonly onClick: () => void;
  readonly placeholder?: string;
  readonly variant?: "header" | "hero" | "sidebar";
}

function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    navigator.platform.includes("Mac") ||
    navigator.platform.includes("iPhone") ||
    navigator.platform.includes("iPad") ||
    navigator.userAgent.includes("Mac")
  );
}

export function QuickSearchTrigger({
  className = "",
  onClick,
  placeholder,
  variant = "sidebar",
}: QuickSearchTriggerProps) {
  const isMac = isApplePlatform();
  const shortcutText = isMac ? "⌘K" : "Ctrl+K";

  if (variant === "hero") {
    return (
      <div className={`quick-search-hero-container ${className}`}>
        <h2 className="quick-search-hero-title">Ready when you are.</h2>
        <button
          aria-keyshortcuts="Control+K Meta+K"
          aria-label="Open command palette"
          className="quick-search-hero-button"
          onClick={onClick}
          type="button"
        >
          <span aria-hidden="true" className="quick-search-hero-icon">
            <svg
              fill="none"
              height="20"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="20"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </span>
          <span className="quick-search-hero-placeholder">
            {placeholder ?? "Search products, pages, and features..."}
          </span>
          <kbd className="quick-search-kbd">{shortcutText}</kbd>
        </button>
      </div>
    );
  }

  if (variant === "header") {
    return (
      <button
        aria-keyshortcuts="Control+K Meta+K"
        aria-label="Quick search (⌘K)"
        className={`quick-search-header-button ${className}`}
        onClick={onClick}
        title={`Search (${shortcutText})`}
        type="button"
      >
        <svg
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
        <span className="sr-only">Search</span>
      </button>
    );
  }

  return (
    <div className={`quick-search-sidebar-wrapper ${className}`}>
      <button
        aria-keyshortcuts="Control+K Meta+K"
        aria-label="Quick search"
        className="quick-search-sidebar-button"
        onClick={onClick}
        type="button"
      >
        <span aria-hidden="true" className="quick-search-sidebar-icon">
          <svg
            fill="none"
            height="16"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="16"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </span>
        <span className="quick-search-sidebar-placeholder">{placeholder ?? "Quick search..."}</span>
        <kbd className="quick-search-kbd">{shortcutText}</kbd>
      </button>
    </div>
  );
}
