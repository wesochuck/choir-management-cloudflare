import { useEffect, useRef, useState } from "react";
import type { MessageOriginFilter, MessageStatusFilter } from "./types";

const statuses: readonly (readonly [MessageStatusFilter, string])[] = [
  ["all", "All statuses"],
  ["draft", "Drafts"],
  ["scheduled", "Scheduled"],
  ["queued", "Queued"],
  ["sent", "Sent"],
  ["failed", "Failed"],
  ["skipped", "Skipped"],
];
const types: readonly (readonly [MessageOriginFilter, string])[] = [
  ["all", "All types"],
  ["manual", "Manual"],
  ["automated", "Automated"],
];
export function MessageFilters({
  search,
  status,
  origin,
  onChange,
}: {
  readonly search: string;
  readonly status: MessageStatusFilter;
  readonly origin: MessageOriginFilter;
  readonly onChange: (
    status: MessageStatusFilter,
    origin: MessageOriginFilter,
    search: string,
  ) => void;
}) {
  const [input, setInput] = useState(search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let active = true;
    if (timer.current) clearTimeout(timer.current);
    void Promise.resolve().then(() => {
      if (active) setInput(search);
    });
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [search, status, origin]);
  function apply(nextStatus: MessageStatusFilter, nextOrigin: MessageOriginFilter, query: string) {
    if (timer.current) clearTimeout(timer.current);
    setInput(query);
    onChange(nextStatus, nextOrigin, query);
  }
  return (
    <div className="communication-history-filters" aria-label="Message filter options">
      <div className="field communication-history-filters__search">
        <label htmlFor="communication-history-search">Search messages</label>
        <input
          id="communication-history-search"
          type="search"
          placeholder="Search messages…"
          maxLength={200}
          value={input}
          aria-describedby="communication-history-search-help"
          onChange={(event) => {
            const value = event.target.value;
            setInput(value);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              onChange(status, origin, value);
            }, 300);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply(status, origin, input);
            }
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="communication-history-status">Status</label>
        <select
          id="communication-history-status"
          value={status}
          onChange={(event) => {
            const selected = statuses.find(([value]) => value === event.target.value);
            if (selected) apply(selected[0], origin, input);
          }}
        >
          {statuses.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="communication-history-type">Type</label>
        <select
          id="communication-history-type"
          value={origin}
          onChange={(event) => {
            const selected = types.find(([value]) => value === event.target.value);
            if (selected) apply(status, selected[0], input);
          }}
        >
          {types.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <p id="communication-history-search-help" className="field-help">
        Search subject, event, message kind, status, or date.
      </p>
      {input || status !== "all" || origin !== "all" ? (
        <button
          type="button"
          className="text-button communication-history-filters__clear"
          onClick={() => {
            apply("all", "all", "");
          }}
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
