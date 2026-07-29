import type {
  OrganizationEvent,
  OrganizationProfile,
  OrganizationProfileRequest,
  OrganizationRosterConfiguration,
  OrganizationSeatingChart,
  OrganizationSeatingChartRequest,
  SeatingConfiguration,
  SeatingFormation,
} from "@choir/contracts";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  addRow,
  addSeat,
  calculateSeatingSuggestions,
  isSeatingSectionMismatch,
  moveAssignment,
  removeRow,
  removeSeat,
  swapAssignments,
  unassignProfile,
} from "@choir/domain";
import { Dialog } from "@choir/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  AuthApiError,
  createOrganizationProfile,
  deleteOrganizationSeatingChart,
  getOrganizationRosterConfiguration,
  getOrganizationSeatingConfiguration,
  listOrganizationEventAttendance,
  listOrganizationEvents,
  listOrganizationProfiles,
  listOrganizationSeatingCharts,
  reorderOrganizationSeatingCharts,
  setOrganizationEventRsvp,
  updateOrganizationSeatingChart,
  updateOrganizationSeatingConfiguration,
  createOrganizationSeatingChart,
} from "../auth/api";

interface SeatingResources {
  readonly events: readonly OrganizationEvent[];
  readonly profiles: readonly OrganizationProfile[];
  readonly roster: OrganizationRosterConfiguration;
  readonly seating: SeatingConfiguration;
}

type ViewMode = "grid" | "list";
type SaveState = "idle" | "saving" | "saved" | "error";

const defaultRows = [8, 10, 12];
const emptyChart: OrganizationSeatingChartRequest = {
  assignments: {},
  formationId: "columns-standard",
  name: "Main Seating Chart",
  rowCounts: defaultRows,
  sectionSuggestions: {},
  sortOrder: 0,
  venueId: null,
};

const emptyProfile: OrganizationProfileRequest = {
  displayName: "",
  doNotEmail: false,
  globalStatus: "Active",
  isSectionLeader: false,
  notes: "",
  phone: "",
  receiveAdminNotifications: true,
  receiveAttendanceReports: true,
  receiveFinancialAlerts: false,
  receiveRsvpDeclineNotices: false,
  showInDirectory: true,
  voicePart: "",
};

function chartRequest(chart: OrganizationSeatingChart): OrganizationSeatingChartRequest {
  return {
    assignments: chart.assignments,
    formationId: chart.formationId,
    name: chart.name,
    rowCounts: chart.rowCounts,
    sectionSuggestions: chart.sectionSuggestions,
    sortOrder: chart.sortOrder,
    venueId: chart.venueId,
  };
}

function useIsNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const update = () => {
      setNarrow(media.matches);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);
  return narrow;
}

function formatEventDate(startsAt: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(startsAt));
  } catch {
    return startsAt;
  }
}

function statusLabel(status: OrganizationProfile["globalStatus"]): string {
  return status === "Idle" ? "On Break" : status;
}

interface ConfirmState {
  readonly confirmLabel: string;
  readonly message: string;
  readonly onConfirm: () => void | Promise<void>;
  readonly title: string;
}

function ConfirmDialog({
  state,
  onClose,
}: {
  readonly onClose: () => void;
  readonly state: ConfirmState | null;
}) {
  if (!state) return null;
  return (
    <Dialog onClose={onClose} open title={state.title} description="This action cannot be undone.">
      <div className="form-stack">
        <p>{state.message}</p>
        <div className="form-actions">
          <button className="button button--secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="button button--danger"
            onClick={() => {
              void state.onConfirm();
            }}
            type="button"
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

interface FormationOrderOption {
  readonly label: string;
  readonly value: string;
}

function formationOrderOptions(
  formation: SeatingFormation,
  roster: OrganizationRosterConfiguration,
): readonly FormationOrderOption[] {
  if (formation.isVoicePartLayout) {
    return roster.voiceParts.map(({ fullName, label }) => ({
      label: `${fullName} (${label})`,
      value: label,
    }));
  }
  return roster.sections
    .filter(({ trackOnly }) => !trackOnly)
    .map(({ code, name }) => ({ label: `${name} (${code})`, value: code }));
}

function normalizeFormationOrder(
  formation: SeatingFormation,
  roster: OrganizationRosterConfiguration,
): string[] {
  const options = formationOrderOptions(formation, roster);
  const allowed = new Set(options.map(({ value }) => value));
  const current = formation.sectionOrder.filter((value) => allowed.has(value));
  const present = new Set(current);
  return [...current, ...options.map(({ value }) => value).filter((value) => !present.has(value))];
}

function moveFormationOrderItem(order: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= order.length || to >= order.length) {
    return [...order];
  }
  const next = [...order];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

function FormationOrderEditor({
  formation,
  onChange,
  roster,
}: {
  readonly formation: SeatingFormation;
  readonly onChange: (sectionOrder: readonly string[]) => void;
  readonly roster: OrganizationRosterConfiguration;
}) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const options = formationOrderOptions(formation, roster);
  const optionByValue = new Map(options.map((option) => [option.value, option]));
  const order = formation.sectionOrder;

  function move(from: number, to: number): void {
    onChange(moveFormationOrderItem(order, from, to));
  }

  return (
    <div className="formation-order-editor">
      <div className="formation-order-editor__heading">
        <span>Section or voice-part order</span>
        <small>Drag the handles to set the order used by this formation.</small>
      </div>
      <div
        aria-label={`${formation.isVoicePartLayout ? "Voice-part" : "Section"} order`}
        className={`formation-order-list${formation.strategy === "horizontal_row" ? " formation-order-list--rows" : ""}`}
        role="list"
      >
        {order.map((value, index) => {
          const option = optionByValue.get(value);
          return (
            <div
              aria-label={`${option?.label ?? `Unknown item ${value}`}, position ${String(index + 1)}`}
              className={`formation-order-item${draggingIndex === index ? " formation-order-item--dragging" : ""}${option ? "" : " formation-order-item--unknown"}`}
              draggable
              key={`${value}-${String(index)}`}
              onDragEnd={() => {
                setDraggingIndex(null);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDragStart={(event) => {
                setDraggingIndex(index);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(index));
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = Number(event.dataTransfer.getData("text/plain"));
                if (Number.isInteger(from)) move(from, index);
                setDraggingIndex(null);
              }}
              onKeyDown={(event) => {
                const previous = event.key === "ArrowLeft" || event.key === "ArrowUp";
                const next = event.key === "ArrowRight" || event.key === "ArrowDown";
                if (!previous && !next) return;
                event.preventDefault();
                const target = previous ? index - 1 : index + 1;
                if (target >= 0 && target < order.length) move(index, target);
              }}
              role="listitem"
              tabIndex={0}
              title="Drag to reorder, or use the arrow keys"
            >
              <span aria-hidden="true" className="formation-order-item__handle">
                ⠿
              </span>
              <span className="formation-order-item__label">
                {option?.label ?? `Unknown item (${value})`}
              </span>
              <button
                aria-label={`Remove ${option?.label ?? value} from order`}
                className="formation-order-item__remove"
                disabled={order.length <= 1}
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(order.filter((_, itemIndex) => itemIndex !== index));
                }}
                title={order.length <= 1 ? "A formation needs at least one item" : "Remove"}
                type="button"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      {options.some(({ value }) => !order.includes(value)) ? (
        <label className="formation-order-editor__add">
          <span>Add {formation.isVoicePartLayout ? "voice part" : "section"}</span>
          <select
            value=""
            onChange={(event) => {
              if (!event.target.value) return;
              onChange([...order, event.target.value]);
            }}
          >
            <option value="">Choose an item…</option>
            {options
              .filter(({ value }) => !order.includes(value))
              .map(({ label, value }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function FormationEditor({
  initial,
  roster,
  onSaved,
}: {
  readonly initial: SeatingConfiguration;
  readonly onSaved: (next: SeatingConfiguration) => void;
  readonly roster: OrganizationRosterConfiguration;
}) {
  const [configuration, setConfiguration] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function updateFormation(index: number, formation: SeatingFormation): void {
    setConfiguration((current) => ({
      ...current,
      formations: current.formations.map((candidate, candidateIndex) =>
        candidateIndex === index ? formation : candidate,
      ),
    }));
  }

  async function save(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await updateOrganizationSeatingConfiguration(configuration);
      setConfiguration(saved);
      onSaved(saved);
      setMessage("Reusable formations saved.");
    } catch (caught: unknown) {
      setMessage(caught instanceof Error ? caught.message : "Formations could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="seating-formations seating-formations--focused"
      aria-labelledby="formation-title"
    >
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Seating</p>
        <h2 id="formation-title">Reusable formations</h2>
        <p>Choose the section order and placement strategy used by new charts.</p>
      </div>
      <div className="form-stack">
        <label className="field">
          Default formation
          <select
            value={configuration.defaultFormationId}
            onChange={(event) => {
              setConfiguration((current) => ({
                ...current,
                defaultFormationId: event.target.value,
              }));
            }}
          >
            {configuration.formations.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {configuration.formations.map((formation, index) => (
          <fieldset className="seating-formation" disabled={busy} key={formation.id}>
            <legend>{formation.name}</legend>
            <label className="field">
              Name
              <input
                maxLength={200}
                required
                value={formation.name}
                onChange={(event) => {
                  updateFormation(index, { ...formation, name: event.target.value });
                }}
              />
            </label>
            <label className="field">
              Strategy
              <select
                value={formation.strategy}
                onChange={(event) => {
                  updateFormation(index, {
                    ...formation,
                    strategy:
                      event.target.value === "horizontal_row"
                        ? "horizontal_row"
                        : "vertical_column",
                  });
                }}
              >
                <option value="vertical_column">Vertical columns</option>
                <option value="horizontal_row">Horizontal rows</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input
                checked={formation.isVoicePartLayout}
                type="checkbox"
                onChange={(event) => {
                  const nextFormation = {
                    ...formation,
                    isVoicePartLayout: event.target.checked,
                  };
                  updateFormation(index, {
                    ...nextFormation,
                    sectionOrder: normalizeFormationOrder(nextFormation, roster),
                  });
                }}
              />
              Arrange individual voice parts
            </label>
            <FormationOrderEditor
              formation={formation}
              onChange={(sectionOrder) => {
                updateFormation(index, { ...formation, sectionOrder: [...sectionOrder] });
              }}
              roster={roster}
            />
          </fieldset>
        ))}
        <div className="form-actions">
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={() => {
              const id = `formation-${String(configuration.formations.length + 1)}`;
              setConfiguration((current) => ({
                ...current,
                formations: [
                  ...current.formations,
                  {
                    id,
                    isVoicePartLayout: false,
                    name: "New formation",
                    sectionOrder: roster.sections
                      .filter(({ trackOnly }) => !trackOnly)
                      .map(({ code }) => code),
                    strategy: "vertical_column",
                  },
                ],
              }));
            }}
            type="button"
          >
            Add formation
          </button>
          <button
            className="button button--primary"
            disabled={busy}
            onClick={() => void save()}
            type="button"
          >
            {busy ? "Saving…" : "Save formations"}
          </button>
        </div>
        {message ? (
          <p className="notice notice--success" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}

interface SeatTileProps {
  readonly assigned: OrganizationProfile | undefined;
  readonly label: string;
  readonly mismatch: boolean;
  readonly onActivate: () => void;
  readonly onDrop: (token: string) => void;
  readonly onRemove: () => void;
  readonly seatKey: string;
  readonly suggestion: string | undefined;
}

/* eslint-disable react-hooks/refs -- @dnd-kit exposes callback refs and event bindings for JSX wiring. */
function UnassignedProfileChip({
  onRemove,
  profile,
}: {
  readonly onRemove: (profile: OrganizationProfile) => void;
  readonly profile: OrganizationProfile;
}) {
  const draggable = useDraggable({ id: `profile:${profile.id}` });
  return (
    <div
      className={`seating-profile-chip${draggable.isDragging ? " seating-profile-chip--dragging" : ""}`}
      draggable
      ref={draggable.setNodeRef}
      style={{ opacity: draggable.isDragging ? 0.45 : undefined }}
      {...draggable.attributes}
      {...draggable.listeners}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", `profile:${profile.id}`);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <span>{profile.displayName}</span>
      <button
        aria-label={`Mark ${profile.displayName} not attending`}
        onClick={() => {
          onRemove(profile);
        }}
        type="button"
      >
        ×
      </button>
    </div>
  );
}

function SeatTile({
  assigned,
  label,
  mismatch,
  onActivate,
  onDrop,
  onRemove,
  seatKey,
  suggestion,
}: SeatTileProps) {
  const draggable = useDraggable({ id: `seat:${seatKey}`, disabled: !assigned });
  const droppable = useDroppable({ id: `seat:${seatKey}` });
  return (
    <div
      aria-label={`${label}${assigned ? `, assigned to ${assigned.displayName}` : ", empty"}`}
      className={`seating-seat seating-seat--canvas${assigned ? " seating-seat--assigned" : " seating-seat--empty"}${mismatch ? " seating-seat--mismatch" : ""}${draggable.isDragging ? " seating-seat--dragging" : ""}${droppable.isOver ? " seating-seat--drop-target" : ""}`}
      draggable={Boolean(assigned)}
      ref={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      style={{ opacity: draggable.isDragging ? 0.45 : undefined }}
      {...draggable.attributes}
      {...draggable.listeners}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", `seat:${seatKey}`);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(event.dataTransfer.getData("text/plain"));
      }}
      onClick={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest("button")) return;
        onActivate();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onActivate();
      }}
      tabIndex={0}
    >
      <span className="seating-seat__number">{label}</span>
      <span className="seating-seat__suggestion">{suggestion ?? "Open"}</span>
      <strong>{assigned?.displayName ?? "Empty"}</strong>
      {assigned ? <span className="seating-seat__voice">{assigned.voicePart}</span> : null}
      {mismatch ? <span className="seating-seat__warning">Voice part mismatch</span> : null}
      <button
        aria-label={
          assigned ? `Remove ${assigned.displayName} from ${label}` : `Delete empty ${label}`
        }
        className="seating-seat__remove"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
        title="Delete seat"
        type="button"
      >
        ×
      </button>
    </div>
  );
}

function UnassignedTray({
  profiles,
  onAdd,
  onLookup,
  onRemoveRsvp,
  onDrop,
  query,
  setQuery,
}: {
  readonly onAdd: () => void;
  readonly onLookup: () => void;
  readonly onRemoveRsvp: (profile: OrganizationProfile) => void;
  readonly onDrop: (token: string) => void;
  readonly profiles: readonly OrganizationProfile[];
  readonly query: string;
  readonly setQuery: (value: string) => void;
}) {
  const droppable = useDroppable({ id: "tray" });
  const groups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = normalized
      ? profiles.filter(({ displayName, voicePart }) =>
          `${displayName} ${voicePart}`.toLocaleLowerCase().includes(normalized),
        )
      : profiles;
    const grouped = new Map<string, OrganizationProfile[]>();
    filtered.forEach((profile) => {
      const key = profile.voicePart || "Other";
      const list = grouped.get(key) ?? [];
      list.push(profile);
      grouped.set(key, list);
    });
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [profiles, query]);
  return (
    <section
      className={`seating-tray${droppable.isOver ? " seating-tray--drop-target" : ""}`}
      aria-labelledby="unassigned-title"
      ref={droppable.setNodeRef}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(event.dataTransfer.getData("text/plain"));
      }}
    >
      <div className="seating-tray__header">
        <div>
          <h2 id="unassigned-title">Unassigned Profiles</h2>
          <p>Drag a Profile to a seat, or drop a seat here to clear it.</p>
        </div>
        <span className="status-pill">{profiles.length}</span>
      </div>
      <div className="seating-tray__actions">
        <input
          aria-label="Search unassigned Profiles"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search Profiles"
          type="search"
          value={query}
        />
        <button className="button button--secondary button--small" onClick={onLookup} type="button">
          Lookup
        </button>
        <button className="button button--secondary button--small" onClick={onAdd} type="button">
          Add Profile
        </button>
      </div>
      <div className="seating-tray__groups">
        {groups.map(([group, groupProfiles]) => (
          <div className="seating-tray__group" key={group}>
            <h3>
              {group} <span>{groupProfiles.length}</span>
            </h3>
            <div className="seating-tray__profiles">
              {groupProfiles.map((profile) => (
                <UnassignedProfileChip key={profile.id} onRemove={onRemoveRsvp} profile={profile} />
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 ? (
          <p className="empty-state">All eligible Profiles are assigned.</p>
        ) : null}
      </div>
    </section>
  );
}
/* eslint-enable react-hooks/refs */

function ChartList({
  chart,
  profilesById,
  showVoiceParts,
}: {
  readonly chart: OrganizationSeatingChartRequest;
  readonly profilesById: ReadonlyMap<string, OrganizationProfile>;
  readonly showVoiceParts: boolean;
}) {
  return (
    <div className="seating-list-view" aria-label="Text seating list">
      {[...chart.rowCounts.keys()].reverse().map((rowIndex) => (
        <section className="seating-list-row" key={rowIndex}>
          <h3>Row {rowIndex + 1}</h3>
          <ol>
            {Array.from({ length: chart.rowCounts[rowIndex] ?? 0 }, (_, seatIndex) => {
              const profile = profilesById.get(
                chart.assignments[`${String(rowIndex)}-${String(seatIndex)}`] ?? "",
              );
              return (
                <li key={`${String(rowIndex)}-${String(seatIndex)}`}>
                  <span>Seat {seatIndex + 1}</span>
                  <strong>{profile?.displayName ?? "Empty"}</strong>
                  {showVoiceParts && profile ? <em>{profile.voicePart}</em> : null}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

// eslint-disable-next-line complexity -- this coordinator owns independent chart, focus, autosave, and dialog workflows; visual primitives are extracted below.
export function SeatingManager({ enabled }: { readonly enabled: boolean }) {
  const isNarrow = useIsNarrowScreen();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const queuedRevisionRef = useRef(0);
  const saveRevisionRef = useRef(0);
  const unsavedChangesRef = useRef(false);
  const nativeDropHandledRef = useRef(false);
  const chartRef = useRef<OrganizationSeatingChartRequest | null>(null);
  const editingIdRef = useRef<string | null>(null);
  const eventIdRef = useRef("");
  const [resources, setResources] = useState<SeatingResources | null>(null);
  const [eventId, setEventId] = useState("");
  const [charts, setCharts] = useState<readonly OrganizationSeatingChart[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [chart, setChart] = useState<OrganizationSeatingChartRequest>(emptyChart);
  const [attendance, setAttendance] = useState<
    readonly { readonly profileId: string; readonly rsvp: "No" | "Pending" | "Yes" }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [showVoiceParts, setShowVoiceParts] = useState(true);
  const [mobileEditing, setMobileEditing] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [fallbackFocus, setFallbackFocus] = useState(false);
  const [formationTab, setFormationTab] = useState<"chart" | "formations">("chart");
  const [query, setQuery] = useState("");
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);
  const [dragMessage, setDragMessage] = useState("");
  const [draggingToken, setDraggingToken] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [chartDialog, setChartDialog] = useState<"create" | "rename" | null>(null);
  const [chartName, setChartName] = useState("");
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyPerformanceId, setCopyPerformanceId] = useState("");
  const [copyCharts, setCopyCharts] = useState<readonly OrganizationSeatingChart[]>([]);
  const [copyChartId, setCopyChartId] = useState("");
  const [copyBusy, setCopyBusy] = useState(false);
  const [profileDialog, setProfileDialog] = useState<"add" | "lookup" | null>(null);
  const [profileForm, setProfileForm] = useState<OrganizationProfileRequest>(emptyProfile);
  const [lookupQuery, setLookupQuery] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const updateUrl = useCallback((nextEventId: string, nextChartId: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (nextEventId) params.set("eventId", nextEventId);
    else params.delete("eventId");
    if (nextChartId) params.set("chartId", nextChartId);
    else params.delete("chartId");
    const queryString = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${queryString ? `?${queryString}` : ""}`,
    );
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationEvents(controller.signal),
      listOrganizationProfiles(controller.signal),
      getOrganizationRosterConfiguration(controller.signal),
      getOrganizationSeatingConfiguration(controller.signal),
    ])
      .then(([events, profiles, roster, seating]) => {
        const performances = events.filter(({ type }) => type === "Performance");
        setResources({ events: performances, profiles, roster, seating });
        const requested = new URLSearchParams(window.location.search).get("eventId");
        const selected = performances.some(({ id }) => id === requested)
          ? requested
          : (performances[0]?.id ?? "");
        setEventId(selected ?? "");
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError(
            caught instanceof Error ? caught.message : "Seating resources could not be loaded.",
          );
        }
      })
      .finally(() => {
        setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  useEffect(() => {
    eventIdRef.current = eventId;
  }, [eventId]);

  useEffect(() => {
    if (!enabled || !eventId || !resources) return;
    const controller = new AbortController();
    Promise.all([
      listOrganizationSeatingCharts(eventId, controller.signal),
      listOrganizationEventAttendance(eventId, controller.signal),
    ])
      .then(([nextCharts, nextAttendance]) => {
        setCharts(nextCharts);
        setAttendance(nextAttendance);
        const requestedChart = new URLSearchParams(window.location.search).get("chartId");
        const active = nextCharts.find(({ id }) => id === requestedChart) ?? nextCharts[0];
        const nextId = active?.id ?? null;
        const nextChart = active
          ? chartRequest(active)
          : { ...emptyChart, formationId: resources.seating.defaultFormationId, venueId: null };
        setEditingId(nextId);
        editingIdRef.current = nextId;
        setChart(nextChart);
        chartRef.current = nextChart;
        updateUrl(eventId, nextId);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError(
            caught instanceof Error ? caught.message : "Performance seating could not be loaded.",
          );
        }
      })
      .finally(() => {
        setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [enabled, eventId, resources, updateUrl]);

  const eligibleProfiles = useMemo(() => {
    if (!resources) return [];
    const attending = new Set(
      attendance.filter(({ rsvp }) => rsvp === "Yes").map(({ profileId }) => profileId),
    );
    return resources.profiles.filter(
      (profile) =>
        profile.globalStatus === "Active" &&
        Boolean(profile.voicePart.trim()) &&
        attending.has(profile.id),
    );
  }, [attendance, resources]);
  const profilesById = useMemo(
    () => new Map((resources?.profiles ?? []).map((profile) => [profile.id, profile])),
    [resources?.profiles],
  );
  const assignedIds = useMemo(() => new Set(Object.values(chart.assignments)), [chart.assignments]);
  const unassignedProfiles = useMemo(
    () => eligibleProfiles.filter(({ id }) => !assignedIds.has(id)),
    [assignedIds, eligibleProfiles],
  );
  const lookupProfiles = useMemo(() => {
    const presentIds = new Set([...unassignedProfiles.map(({ id }) => id), ...assignedIds]);
    return (resources?.profiles ?? []).filter(({ id }) => !presentIds.has(id));
  }, [assignedIds, resources?.profiles, unassignedProfiles]);
  const currentFormation = useMemo(() => {
    const found = resources?.seating.formations.find(({ id }) => id === chart.formationId);
    return found ?? resources?.seating.formations[0] ?? null;
  }, [chart.formationId, resources?.seating.formations]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const saveChart = useCallback(
    async (payload: OrganizationSeatingChartRequest, revision: number): Promise<boolean> => {
      if (!eventIdRef.current || !editingIdRef.current) return true;
      setSaveState("saving");
      try {
        const saved = await updateOrganizationSeatingChart(
          eventIdRef.current,
          editingIdRef.current,
          payload,
        );
        if (revision === saveRevisionRef.current) {
          setChart(chartRequest(saved));
          chartRef.current = chartRequest(saved);
          setCharts((current) =>
            current.map((candidate) => (candidate.id === saved.id ? saved : candidate)),
          );
          unsavedChangesRef.current = false;
          setSaveState("saved");
        }
        return true;
      } catch (caught: unknown) {
        if (revision === saveRevisionRef.current) {
          queuedRevisionRef.current = revision - 1;
          unsavedChangesRef.current = true;
          setSaveState("error");
        }
        setError(
          caught instanceof Error ? caught.message : "The seating chart could not be saved.",
        );
        return false;
      }
    },
    [],
  );

  const enqueueSave = useCallback(
    (payload: OrganizationSeatingChartRequest, revision: number): Promise<boolean> => {
      if (revision <= queuedRevisionRef.current) return saveQueueRef.current;
      queuedRevisionRef.current = revision;
      const next = saveQueueRef.current.then(() => saveChart(payload, revision));
      saveQueueRef.current = next.catch(() => false);
      return next;
    },
    [saveChart],
  );

  const scheduleSave = useCallback(
    (next: OrganizationSeatingChartRequest): void => {
      chartRef.current = next;
      setChart(next);
      if (!editingIdRef.current) {
        setSaveState("idle");
        return;
      }
      unsavedChangesRef.current = true;
      setSaveState("saving");
      saveRevisionRef.current += 1;
      const revision = saveRevisionRef.current;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void enqueueSave(next, revision);
      }, 750);
    },
    [enqueueSave],
  );

  const flushSave = useCallback(async (): Promise<boolean> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!editingIdRef.current || !chartRef.current || saveState === "idle") return true;
    const revision = saveRevisionRef.current;
    return enqueueSave(chartRef.current, revision);
  }, [enqueueSave, saveState]);

  function applyChart(next: OrganizationSeatingChartRequest): void {
    setError(null);
    scheduleSave(next);
  }

  async function changeEvent(nextEventId: string): Promise<void> {
    if (nextEventId === eventId) return;
    setLoading(true);
    const flushed = await flushSave();
    if (!flushed) {
      setLoading(false);
      setConfirmState({
        title: "Unsaved seating changes",
        message:
          "The current chart could not be saved. Stay here and retry before changing Performance.",
        confirmLabel: "Retry",
        onConfirm: async () => {
          if (await flushSave()) setConfirmState(null);
        },
      });
      return;
    }
    setEventId(nextEventId);
    updateUrl(nextEventId, null);
  }

  async function createChart(): Promise<void> {
    if (!eventId || !resources) return;
    setSaveState("saving");
    try {
      const created = await createOrganizationSeatingChart(eventId, {
        ...chart,
        name: chartName.trim() || "Main Seating Chart",
        formationId: chart.formationId || resources.seating.defaultFormationId,
      });
      setCharts((current) =>
        [...current, created].toSorted((left, right) => left.sortOrder - right.sortOrder),
      );
      setEditingId(created.id);
      editingIdRef.current = created.id;
      const next = chartRequest(created);
      setChart(next);
      chartRef.current = next;
      setChartDialog(null);
      updateUrl(eventId, created.id);
      setSaveState("saved");
    } catch (caught: unknown) {
      setSaveState("error");
      setError(
        caught instanceof Error ? caught.message : "The seating chart could not be created.",
      );
    }
  }

  function renameChart(): void {
    if (!editingId || !chartName.trim()) return;
    const next = { ...chart, name: chartName.trim() };
    applyChart(next);
    setChartDialog(null);
  }

  async function deleteChart(): Promise<void> {
    if (!editingId || !eventId || charts.length <= 1) return;
    try {
      if (!(await flushSave())) return;
      await deleteOrganizationSeatingChart(eventId, editingId);
      const remaining = charts.filter(({ id }) => id !== editingId);
      setCharts(remaining);
      const next = remaining[0];
      const nextId = next?.id ?? null;
      setEditingId(nextId);
      editingIdRef.current = nextId;
      const nextChart = next ? chartRequest(next) : { ...emptyChart };
      setChart(nextChart);
      chartRef.current = nextChart;
      updateUrl(eventId, nextId);
      setSaveState("saved");
    } catch (caught: unknown) {
      setSaveState("error");
      setError(
        caught instanceof Error ? caught.message : "The seating chart could not be deleted.",
      );
    }
  }

  async function reorderCharts(direction: -1 | 1): Promise<void> {
    if (!editingId || !eventId) return;
    const index = charts.findIndex(({ id }) => id === editingId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= charts.length) return;
    const ordered = [...charts];
    const [moved] = ordered.splice(index, 1);
    if (!moved) return;
    ordered.splice(target, 0, moved);
    try {
      const saved = await reorderOrganizationSeatingCharts(
        eventId,
        ordered.map(({ id }) => id),
      );
      setCharts(saved);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Charts could not be reordered.");
    }
  }

  function selectChart(nextId: string): void {
    const nextChart = charts.find(({ id }) => id === nextId);
    if (!nextChart) return;
    void (async () => {
      if (!(await flushSave())) return;
      const next = chartRequest(nextChart);
      setEditingId(nextId);
      editingIdRef.current = nextId;
      setChart(next);
      chartRef.current = next;
      setSaveState("saved");
      updateUrl(eventId, nextId);
    })();
  }

  function handleDropToken(token: string, targetSeatKey?: string): void {
    if (!token) return;
    if (!targetSeatKey) {
      if (!token.startsWith("seat:")) return;
      const seatKey = token.slice("seat:".length);
      applyChart({
        ...chart,
        assignments: Object.fromEntries(
          Object.entries(chart.assignments).filter(([key]) => key !== seatKey),
        ),
      });
      return;
    }
    if (token.startsWith("seat:")) {
      const sourceSeatKey = token.slice("seat:".length);
      const targetOccupied = Boolean(chart.assignments[targetSeatKey]);
      applyChart({
        ...chart,
        assignments: targetOccupied
          ? swapAssignments(chart.assignments, sourceSeatKey, targetSeatKey)
          : moveAssignment(chart.assignments, sourceSeatKey, targetSeatKey),
      });
    } else if (token.startsWith("profile:")) {
      const profileId = token.slice("profile:".length);
      applyChart({
        ...chart,
        assignments: moveAssignment(chart.assignments, "", targetSeatKey, profileId),
      });
    }
  }

  function handleDragStart(event: DragStartEvent): void {
    nativeDropHandledRef.current = false;
    const token = String(event.active.id);
    setDraggingToken(token);
    const profileId = token.startsWith("profile:")
      ? token.slice("profile:".length)
      : token.startsWith("seat:")
        ? chart.assignments[token.slice("seat:".length)]
        : undefined;
    const profileName = profileId ? profilesById.get(profileId)?.displayName : undefined;
    setDragMessage(
      profileName
        ? `Dragging ${profileName}. Choose a seat to assign or move, or the tray to unassign.`
        : token.startsWith("profile:")
          ? "Dragging Profile. Choose an empty or occupied seat to assign or replace."
          : "Dragging assigned seat. Choose another seat to move or swap, or the tray to unassign.",
    );
  }

  function handleDragEnd(event: DragEndEvent): void {
    setDraggingToken(null);
    if (nativeDropHandledRef.current) {
      nativeDropHandledRef.current = false;
      return;
    }
    const token = String(event.active.id);
    const target = event.over ? String(event.over.id) : null;
    if (target === "tray") {
      handleDropToken(token);
      setDragMessage("Profile unassigned and returned to the tray.");
      return;
    }
    if (target?.startsWith("seat:")) {
      handleDropToken(token, target.slice("seat:".length));
      setDragMessage("Seating assignment updated.");
      return;
    }
    setDragMessage("Drag canceled.");
  }

  function handleNativeDrop(token: string, targetSeatKey?: string): void {
    nativeDropHandledRef.current = true;
    setDraggingToken(null);
    handleDropToken(token, targetSeatKey);
    setDragMessage(
      targetSeatKey
        ? "Seating assignment updated."
        : "Profile unassigned and returned to the tray.",
    );
  }

  function updateLayout(nextLayout: ReturnType<typeof addRow>): void {
    applyChart({
      ...chart,
      assignments: nextLayout.assignments,
      rowCounts: nextLayout.rowCounts,
      sectionSuggestions: nextLayout.sectionSuggestions,
    });
  }

  function requestRemoveSeat(rowIndex: number, seatIndex: number): void {
    const key = `${String(rowIndex)}-${String(seatIndex)}`;
    const occupant = profilesById.get(chart.assignments[key] ?? "");
    setConfirmState({
      title: "Delete seat?",
      message: occupant
        ? `Deleting this seat will return ${occupant.displayName} to Unassigned Profiles.`
        : "Delete this seat from the row?",
      confirmLabel: "Delete seat",
      onConfirm: () => {
        updateLayout(removeSeat({ ...chart }, rowIndex, seatIndex));
        setConfirmState(null);
      },
    });
  }

  function requestRemoveRow(rowIndex: number): void {
    const occupied = Object.keys(chart.assignments).filter((key) =>
      key.startsWith(`${String(rowIndex)}-`),
    ).length;
    setConfirmState({
      title: "Delete row?",
      message:
        occupied > 0
          ? `This row has ${String(occupied)} assigned Profile(s). Deleting it will return them to the tray.`
          : "Delete this row?",
      confirmLabel: "Delete row",
      onConfirm: () => {
        updateLayout(removeRow({ ...chart }, rowIndex));
        setConfirmState(null);
      },
    });
  }

  function autoSuggest(): void {
    if (!resources || !currentFormation) return;
    const sectionForVoicePart = new Map(
      resources.roster.voiceParts.map(({ label, sectionCode }) => [label, sectionCode]),
    );
    const counts: Record<string, number> = {};
    eligibleProfiles.forEach((profile) => {
      const key = currentFormation.isVoicePartLayout
        ? profile.voicePart
        : (sectionForVoicePart.get(profile.voicePart) ?? "");
      if (key) counts[key] = (counts[key] ?? 0) + 1;
    });
    applyChart({
      ...chart,
      sectionSuggestions: calculateSeatingSuggestions(
        chart.rowCounts,
        counts,
        currentFormation.sectionOrder,
        currentFormation.strategy,
      ),
    });
  }

  function changeFormation(formationId: string): void {
    if (formationId === chart.formationId) return;
    const nextFormation = resources?.seating.formations.find(({ id }) => id === formationId);
    if (!nextFormation) return;
    if (Object.keys(chart.assignments).length > 0) {
      setConfirmState({
        title: "Change formation?",
        message:
          "Changing the formation clears current assignments so the new section order can be applied.",
        confirmLabel: "Change formation",
        onConfirm: () => {
          applyChart({ ...chart, formationId, assignments: {}, sectionSuggestions: {} });
          setConfirmState(null);
        },
      });
      return;
    }
    applyChart({ ...chart, formationId, sectionSuggestions: {} });
  }

  async function loadCopyCharts(nextPerformanceId: string): Promise<void> {
    setCopyPerformanceId(nextPerformanceId);
    setCopyChartId("");
    setCopyBusy(true);
    try {
      const loaded = await listOrganizationSeatingCharts(nextPerformanceId);
      setCopyCharts(loaded.filter(({ venueId }) => venueId === chart.venueId));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Source charts could not be loaded.");
    } finally {
      setCopyBusy(false);
    }
  }

  function copySelectedChart(): void {
    const source = copyCharts.find(({ id }) => id === copyChartId);
    if (!source) return;
    const eligibleIds = new Set(eligibleProfiles.map(({ id }) => id));
    const assignments = Object.fromEntries(
      Object.entries(source.assignments).filter(([, profileId]) => eligibleIds.has(profileId)),
    );
    const skipped = Object.keys(source.assignments).length - Object.keys(assignments).length;
    setConfirmState({
      title: "Copy seating chart?",
      message: `Copy layout and assignments from “${source.name}”?${skipped > 0 ? ` ${String(skipped)} ineligible assignment(s) will remain unassigned.` : ""}`,
      confirmLabel: "Copy chart",
      onConfirm: () => {
        applyChart({
          ...chart,
          assignments,
          formationId: source.formationId,
          rowCounts: source.rowCounts,
          sectionSuggestions: source.sectionSuggestions,
        });
        setCopyOpen(false);
        setConfirmState(null);
      },
    });
  }

  async function saveProfile(): Promise<void> {
    if (!profileForm.displayName.trim() || !profileForm.voicePart.trim()) return;
    setProfileBusy(true);
    setProfileMessage(null);
    try {
      const created = await createOrganizationProfile(profileForm);
      await setOrganizationEventRsvp(eventId, created.id, "Yes");
      setResources((current) =>
        current ? { ...current, profiles: [...current.profiles, created] } : current,
      );
      setAttendance((current) => [...current, { profileId: created.id, rsvp: "Yes" }]);
      setProfileForm(emptyProfile);
      setProfileDialog(null);
      setProfileMessage("Profile added and marked attending.");
    } catch (caught: unknown) {
      setProfileMessage(
        caught instanceof AuthApiError ? caught.message : "The Profile could not be added.",
      );
    } finally {
      setProfileBusy(false);
    }
  }

  function markNotAttending(profile: OrganizationProfile): void {
    const assignedSeat = Object.entries(chart.assignments).find(
      ([, profileId]) => profileId === profile.id,
    )?.[0];
    setConfirmState({
      title: "Mark Profile not attending?",
      message: assignedSeat
        ? `${profile.displayName} will be unassigned and marked not attending.`
        : `Mark ${profile.displayName} not attending for this Performance?`,
      confirmLabel: "Mark not attending",
      onConfirm: async () => {
        await setOrganizationEventRsvp(eventId, profile.id, "No");
        const assignments = unassignProfile(chart.assignments, profile.id);
        applyChart({ ...chart, assignments });
        setAttendance((current) =>
          current.map((row) => (row.profileId === profile.id ? { ...row, rsvp: "No" } : row)),
        );
        setConfirmState(null);
      },
    });
  }

  async function enterFocus(): Promise<void> {
    if (!workspaceRef.current) return;
    try {
      await workspaceRef.current.requestFullscreen();
      setFocusMode(true);
    } catch {
      setFallbackFocus(true);
      setFocusMode(true);
    }
  }

  async function exitFocus(): Promise<void> {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    setFocusMode(false);
    setFallbackFocus(false);
  }

  useEffect(() => {
    const onFullscreenChange = () => {
      setFocusMode(Boolean(document.fullscreenElement));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && fallbackFocus) void exitFocus();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [fallbackFocus]);

  useEffect(() => {
    if (!fallbackFocus) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [fallbackFocus]);

  useEffect(() => {
    if (saveState !== "error" || !unsavedChangesRef.current) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- Safari still requires returnValue for the native prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [saveState]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  if (!enabled)
    return <p className="notice notice--warning">Verify Organization MFA to manage seating.</p>;
  if (loading && !resources) return <p role="status">Loading seating resources…</p>;
  if (error && !resources)
    return (
      <p className="notice notice--error" role="alert">
        {error}
      </p>
    );
  if (!resources) return null;
  if (resources.events.length === 0) {
    return (
      <div className="empty-state">
        <h2>Create a Performance first</h2>
        <p>Seating charts belong to active Performance events.</p>
      </div>
    );
  }

  const activeEvent = resources.events.find(({ id }) => id === eventId);
  const isEditing = !isNarrow || mobileEditing;
  const profileForSeat = (seatKey: string) => profilesById.get(chart.assignments[seatKey] ?? "");
  const draggingProfileId = draggingToken
    ? draggingToken.startsWith("profile:")
      ? draggingToken.slice("profile:".length)
      : draggingToken.startsWith("seat:")
        ? chart.assignments[draggingToken.slice("seat:".length)]
        : undefined
    : undefined;
  const draggingProfileName = draggingProfileId
    ? profilesById.get(draggingProfileId)?.displayName
    : undefined;
  const rows = chart.rowCounts.map((_count, index) => index).reverse();
  const totalSeats = chart.rowCounts.reduce((sum, count) => sum + count, 0);
  const assignedCount = Object.keys(chart.assignments).length;

  return (
    <div
      className={`seating-workspace${focusMode ? " seating-workspace--focus" : ""}${fallbackFocus ? " seating-workspace--fallback-focus" : ""}`}
      ref={workspaceRef}
    >
      <p aria-live="polite" className={draggingToken ? "seating-drag-status" : "sr-only"}>
        {dragMessage}
      </p>
      <div className="seating-page-heading no-print">
        <div>
          <p className="eyebrow">Seating</p>
          <h1>Performance seating</h1>
          <p>
            {activeEvent?.title ?? "Performance"} ·{" "}
            {activeEvent ? formatEventDate(activeEvent.startsAt) : ""} · {assignedCount}/
            {totalSeats} seats assigned
          </p>
        </div>
        <div className="seating-page-heading__actions">
          {isNarrow && !mobileEditing ? (
            <button
              className="button button--primary"
              onClick={() => {
                setMobileEditing(true);
              }}
              type="button"
            >
              Edit anyway
            </button>
          ) : null}
          <button
            className="button button--secondary"
            onClick={() => void (focusMode ? exitFocus() : enterFocus())}
            type="button"
          >
            {focusMode ? "Exit focus" : "Focus"}
          </button>
        </div>
      </div>

      <div className="seating-tabs no-print" role="tablist" aria-label="Seating tools">
        <button
          aria-selected={formationTab === "chart"}
          className={formationTab === "chart" ? "is-active" : ""}
          onClick={() => {
            setFormationTab("chart");
          }}
          role="tab"
          type="button"
        >
          Chart
        </button>
        <button
          aria-selected={formationTab === "formations"}
          className={formationTab === "formations" ? "is-active" : ""}
          onClick={() => {
            setFormationTab("formations");
          }}
          role="tab"
          type="button"
        >
          Formations
        </button>
      </div>

      {formationTab === "formations" ? (
        <FormationEditor
          key={JSON.stringify(resources.seating)}
          initial={resources.seating}
          onSaved={(seating) => {
            setResources((current) => (current ? { ...current, seating } : current));
          }}
          roster={resources.roster}
        />
      ) : (
        <>
          <div className="seating-toolbar no-print">
            <label className="field field--compact">
              Performance
              <select
                aria-label="Seating Performance"
                onChange={(event) => void changeEvent(event.target.value)}
                value={eventId}
              >
                {resources.events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--compact">
              Formation
              <select
                aria-label="Seating formation"
                onChange={(event) => {
                  changeFormation(event.target.value);
                }}
                value={chart.formationId}
              >
                {resources.seating.formations.map((formation) => (
                  <option key={formation.id} value={formation.id}>
                    {formation.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="seating-chart-control field--compact">
              <span>Chart</span>
              <div className="seating-chart-control__row">
                <select
                  aria-label="Select seating chart"
                  onChange={(event) => {
                    selectChart(event.target.value);
                  }}
                  value={editingId ?? ""}
                >
                  {charts.map((candidate, index) => (
                    <option key={candidate.id} value={candidate.id}>
                      {index + 1}. {candidate.name}
                    </option>
                  ))}
                </select>
                <div className="seating-chart-order-actions">
                  <button
                    aria-label="Move chart earlier"
                    className="button button--secondary button--small"
                    disabled={!editingId || charts.findIndex(({ id }) => id === editingId) <= 0}
                    onClick={() => void reorderCharts(-1)}
                    type="button"
                  >
                    ↑
                  </button>
                  <button
                    aria-label="Move chart later"
                    className="button button--secondary button--small"
                    disabled={
                      !editingId ||
                      charts.findIndex(({ id }) => id === editingId) === charts.length - 1
                    }
                    onClick={() => void reorderCharts(1)}
                    type="button"
                  >
                    ↓
                  </button>
                </div>
              </div>
            </div>
            <div className="seating-toolbar__actions seating-toolbar__actions--chart">
              <button
                className="button button--secondary button--small"
                onClick={() => {
                  setChartName("");
                  setChartDialog("create");
                }}
                type="button"
              >
                New
              </button>
              <button
                className="button button--secondary button--small"
                disabled={!editingId}
                onClick={() => {
                  setChartName(chart.name);
                  setChartDialog("rename");
                }}
                type="button"
              >
                Rename
              </button>
              <button
                className="button button--danger button--small"
                disabled={!editingId || charts.length <= 1}
                onClick={() => {
                  setConfirmState({
                    title: "Delete seating chart?",
                    message: `Delete “${chart.name}”?`,
                    confirmLabel: "Delete chart",
                    onConfirm: () => {
                      void deleteChart();
                      setConfirmState(null);
                    },
                  });
                }}
                type="button"
              >
                Delete
              </button>
            </div>
          </div>

          <div className="seating-toolbar seating-toolbar--secondary no-print">
            <div className="seating-toolbar__actions">
              <button
                className="button button--secondary button--small"
                onClick={() => {
                  setConfirmState({
                    title: "Clear assignments?",
                    message: "Return every assigned Profile to the unassigned tray?",
                    confirmLabel: "Clear assignments",
                    onConfirm: () => {
                      applyChart({ ...chart, assignments: {} });
                      setConfirmState(null);
                    },
                  });
                }}
                type="button"
              >
                Clear
              </button>
              <button
                className="button button--danger button--small"
                onClick={() => {
                  setConfirmState({
                    title: "Reset seating chart?",
                    message: "Reset assignments, rows, and formation to the Organization defaults?",
                    confirmLabel: "Reset chart",
                    onConfirm: () => {
                      applyChart({
                        ...chart,
                        assignments: {},
                        formationId: resources.seating.defaultFormationId,
                        rowCounts: defaultRows,
                        sectionSuggestions: {},
                      });
                      setConfirmState(null);
                    },
                  });
                }}
                type="button"
              >
                Reset
              </button>
              <button
                className="button button--secondary button--small"
                onClick={autoSuggest}
                type="button"
              >
                Auto-suggest sections
              </button>
              <button
                className="button button--secondary button--small"
                onClick={() => {
                  setCopyOpen(true);
                  setCopyPerformanceId("");
                  setCopyCharts([]);
                }}
                type="button"
              >
                Copy
              </button>
              <button
                className="button button--secondary button--small"
                onClick={() => {
                  window.print();
                }}
                type="button"
              >
                Print
              </button>
            </div>
            <div className="seating-toolbar__actions">
              <button
                aria-pressed={viewMode === "grid"}
                className={`button button--small ${viewMode === "grid" ? "button--primary" : "button--secondary"}`}
                onClick={() => {
                  setViewMode("grid");
                }}
                type="button"
              >
                Grid
              </button>
              <button
                aria-pressed={viewMode === "list"}
                className={`button button--small ${viewMode === "list" ? "button--primary" : "button--secondary"}`}
                onClick={() => {
                  setViewMode("list");
                }}
                type="button"
              >
                List
              </button>
              {viewMode === "list" ? (
                <label className="checkbox-row checkbox-row--compact">
                  <input
                    checked={showVoiceParts}
                    onChange={(event) => {
                      setShowVoiceParts(event.target.checked);
                    }}
                    type="checkbox"
                  />{" "}
                  Voice parts
                </label>
              ) : null}
              <span
                className={`seating-save-status seating-save-status--${saveState}`}
                role="status"
              >
                {saveState === "saving"
                  ? "Saving…"
                  : saveState === "error"
                    ? "Couldn’t save — Retry"
                    : saveState === "saved"
                      ? "Saved"
                      : "Ready"}
              </span>
              {saveState === "error" ? (
                <button
                  className="button button--secondary button--small"
                  onClick={() => void flushSave()}
                  type="button"
                >
                  Retry
                </button>
              ) : null}
            </div>
          </div>

          {error ? (
            <p className="notice notice--error no-print" role="alert">
              {error}
            </p>
          ) : null}
          {loading ? (
            <p className="notice notice--info no-print" role="status">
              Loading chart…
            </p>
          ) : null}
          {charts.length === 0 ? (
            <div className="empty-state no-print">
              <h2>Start a seating chart</h2>
              <p>Give this Performance a chart name to begin.</p>
              <button
                className="button button--primary"
                onClick={() => {
                  setChartName("Main Seating Chart");
                  setChartDialog("create");
                }}
                type="button"
              >
                Create chart
              </button>
            </div>
          ) : null}
          {charts.length > 0 && viewMode === "list" ? (
            <ChartList chart={chart} profilesById={profilesById} showVoiceParts={showVoiceParts} />
          ) : null}
          {charts.length > 0 && viewMode === "grid" ? (
            <>
              <DndContext
                collisionDetection={closestCenter}
                onDragCancel={() => {
                  setDraggingToken(null);
                  setDragMessage("Drag canceled.");
                }}
                onDragEnd={handleDragEnd}
                onDragStart={handleDragStart}
                sensors={sensors}
              >
                <div
                  className={`seating-editor-canvas${isEditing ? " seating-editor-canvas--editing" : " seating-editor-canvas--readonly"}`}
                  aria-label="Seating chart assignments"
                >
                  {isEditing ? (
                    <button
                      className="button button--secondary button--small no-print"
                      onClick={() => {
                        updateLayout(addRow({ ...chart }, "back"));
                      }}
                      type="button"
                    >
                      + Add row to back
                    </button>
                  ) : null}
                  <div className="seating-grid seating-grid--canvas">
                    {rows.map((rowIndex) => {
                      const count = chart.rowCounts[rowIndex] ?? 0;
                      const occupied = Array.from(
                        { length: count },
                        (_, seatIndex) =>
                          chart.assignments[`${String(rowIndex)}-${String(seatIndex)}`],
                      ).filter(Boolean).length;
                      return (
                        <div
                          className="seating-row seating-row--canvas"
                          key={rowIndex}
                          style={{ "--seating-seat-count": String(count) } as CSSProperties}
                        >
                          <div className="seating-row-label seating-row-label--canvas">
                            <strong>Row {rowIndex + 1}</strong>
                            <span>
                              {occupied}/{count}
                            </span>
                          </div>
                          {isEditing ? (
                            <button
                              aria-label={`Delete row ${String(rowIndex + 1)}`}
                              className="seating-row-action-btn seating-row-action-btn--delete no-print"
                              disabled={chart.rowCounts.length <= 1}
                              onClick={() => {
                                requestRemoveRow(rowIndex);
                              }}
                              type="button"
                            >
                              ×
                            </button>
                          ) : null}
                          {Array.from({ length: count }, (_, seatIndex) => {
                            const seatKey = `${String(rowIndex)}-${String(seatIndex)}`;
                            const profile = profileForSeat(seatKey);
                            const suggestion = chart.sectionSuggestions[seatKey];
                            const mismatch = currentFormation?.isVoicePartLayout
                              ? Boolean(
                                  profile &&
                                  suggestion &&
                                  profile.voicePart.toUpperCase() !== suggestion.toUpperCase(),
                                )
                              : isSeatingSectionMismatch(
                                  profile?.voicePart,
                                  suggestion,
                                  resources.roster.voiceParts,
                                );
                            return isEditing ? (
                              <SeatTile
                                assigned={profile}
                                key={seatKey}
                                label={`Seat ${String(seatIndex + 1)}`}
                                mismatch={mismatch}
                                onActivate={() => {
                                  setSelectedSeat(seatKey);
                                }}
                                onDrop={(token) => {
                                  handleNativeDrop(token, seatKey);
                                }}
                                onRemove={() => {
                                  requestRemoveSeat(rowIndex, seatIndex);
                                }}
                                seatKey={seatKey}
                                suggestion={suggestion}
                              />
                            ) : (
                              <div
                                className={`seating-seat seating-seat--canvas seating-seat--readonly${mismatch ? " seating-seat--mismatch" : ""}`}
                                key={seatKey}
                              >
                                <span className="seating-seat__number">Seat {seatIndex + 1}</span>
                                <span className="seating-seat__suggestion">
                                  {suggestion ?? "Open"}
                                </span>
                                <strong>{profile?.displayName ?? "Empty"}</strong>
                                {profile ? (
                                  <span className="seating-seat__voice">{profile.voicePart}</span>
                                ) : null}
                              </div>
                            );
                          })}
                          {isEditing ? (
                            <button
                              aria-label={`Add seat to row ${String(rowIndex + 1)}`}
                              className="seating-row-action-btn seating-row-action-btn--add no-print"
                              onClick={() => {
                                updateLayout(addSeat({ ...chart }, rowIndex));
                              }}
                              type="button"
                            >
                              +
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {isEditing ? (
                    <button
                      className="button button--secondary button--small no-print"
                      onClick={() => {
                        updateLayout(addRow({ ...chart }, "front"));
                      }}
                      type="button"
                    >
                      + Add row to front
                    </button>
                  ) : null}
                  <div className="seating-stage-marker">Director</div>
                </div>
                {isEditing ? (
                  <UnassignedTray
                    onAdd={() => {
                      setProfileForm(emptyProfile);
                      setProfileDialog("add");
                    }}
                    onLookup={() => {
                      setLookupQuery("");
                      setProfileDialog("lookup");
                    }}
                    onRemoveRsvp={(profile) => {
                      markNotAttending(profile);
                    }}
                    onDrop={(token) => {
                      handleNativeDrop(token);
                    }}
                    profiles={unassignedProfiles}
                    query={query}
                    setQuery={setQuery}
                  />
                ) : (
                  <button
                    className="button button--secondary no-print"
                    onClick={() => {
                      setMobileEditing(true);
                    }}
                    type="button"
                  >
                    Edit chart
                  </button>
                )}
                <DragOverlay dropAnimation={null}>
                  {draggingToken ? (
                    <div className="seating-drag-overlay">
                      <span>Moving</span>
                      <strong>
                        {draggingProfileName ??
                          (draggingToken.startsWith("profile:") ? "Profile" : "Assigned Profile")}
                      </strong>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </>
          ) : null}
        </>
      )}

      <ConfirmDialog
        onClose={() => {
          setConfirmState(null);
        }}
        state={confirmState}
      />

      <Dialog
        description="Use a short name that identifies this seating arrangement."
        onClose={() => {
          setChartDialog(null);
        }}
        open={chartDialog !== null}
        title={chartDialog === "rename" ? "Rename seating chart" : "New seating chart"}
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (chartDialog === "rename") renameChart();
            else void createChart();
          }}
        >
          <label className="field">
            Chart name
            <input
              autoFocus
              maxLength={200}
              onChange={(event) => {
                setChartName(event.target.value);
              }}
              required
              value={chartName}
            />
          </label>
          <div className="form-actions">
            <button
              className="button button--secondary"
              onClick={() => {
                setChartDialog(null);
              }}
              type="button"
            >
              Cancel
            </button>
            <button className="button button--primary" type="submit">
              {chartDialog === "rename" ? "Save name" : "Create chart"}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        description="Copy layout and eligible assignments from another Performance using the same Venue."
        onClose={() => {
          setCopyOpen(false);
        }}
        open={copyOpen}
        title="Copy seating chart"
      >
        <div className="form-stack">
          <label className="field">
            Source Performance
            <select
              onChange={(event) => void loadCopyCharts(event.target.value)}
              value={copyPerformanceId}
            >
              <option value="">Choose a Performance</option>
              {resources.events
                .filter(({ id }) => id !== eventId)
                .map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Source chart
            <select
              disabled={copyBusy || !copyPerformanceId}
              onChange={(event) => {
                setCopyChartId(event.target.value);
              }}
              value={copyChartId}
            >
              <option value="">Choose a chart</option>
              {copyCharts.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
          {copyBusy ? <p role="status">Loading source charts…</p> : null}
          {!copyBusy && copyPerformanceId && copyCharts.length === 0 ? (
            <p className="empty-state">No charts use this Venue.</p>
          ) : null}
          <div className="form-actions">
            <button
              className="button button--secondary"
              onClick={() => {
                setCopyOpen(false);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button--primary"
              disabled={!copyChartId}
              onClick={copySelectedChart}
              type="button"
            >
              Copy chart
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        description="Add an eligible Profile to this Performance."
        onClose={() => {
          setProfileDialog(null);
        }}
        open={profileDialog === "add"}
        title="Add Profile"
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void saveProfile();
          }}
        >
          {profileMessage ? (
            <p className="notice notice--error" role="alert">
              {profileMessage}
            </p>
          ) : null}
          <label className="field">
            Display name
            <input
              autoFocus
              maxLength={200}
              onChange={(event) => {
                setProfileForm((current) => ({ ...current, displayName: event.target.value }));
              }}
              required
              value={profileForm.displayName}
            />
          </label>
          <label className="field">
            Voice part
            <select
              onChange={(event) => {
                setProfileForm((current) => ({ ...current, voicePart: event.target.value }));
              }}
              required
              value={profileForm.voicePart}
            >
              <option value="">Choose voice part</option>
              {resources.roster.voiceParts.map(({ fullName, label }) => (
                <option key={label} value={label}>
                  {fullName} ({label})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Status
            <select
              onChange={(event) => {
                setProfileForm((current) => ({
                  ...current,
                  globalStatus:
                    event.target.value === "Idle" || event.target.value === "Inactive"
                      ? event.target.value
                      : "Active",
                }));
              }}
              value={profileForm.globalStatus}
            >
              <option value="Active">Active</option>
              <option value="Idle">On Break</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>
          <div className="form-actions">
            <button
              className="button button--secondary"
              onClick={() => {
                setProfileDialog(null);
              }}
              type="button"
            >
              Cancel
            </button>
            <button className="button button--primary" disabled={profileBusy} type="submit">
              {profileBusy ? "Adding…" : "Add and mark attending"}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        description="Choose an existing Organization Profile to mark attending for this Performance."
        onClose={() => {
          setProfileDialog(null);
        }}
        open={profileDialog === "lookup"}
        title="Profile lookup"
      >
        <div className="form-stack">
          <label className="field">
            Search Profiles
            <input
              autoFocus
              onChange={(event) => {
                setLookupQuery(event.target.value);
              }}
              placeholder="Name or voice part"
              type="search"
              value={lookupQuery}
            />
          </label>
          <div className="seating-lookup-list">
            {lookupProfiles
              .filter((profile) => {
                const normalized = lookupQuery.trim().toLocaleLowerCase();
                return (
                  !normalized ||
                  `${profile.displayName} ${profile.voicePart}`
                    .toLocaleLowerCase()
                    .includes(normalized)
                );
              })
              .map((profile) => (
                <button
                  className="seating-lookup-row"
                  key={profile.id}
                  onClick={() => {
                    void setOrganizationEventRsvp(eventId, profile.id, "Yes").then(() => {
                      setAttendance((current) => [
                        ...current.filter(({ profileId }) => profileId !== profile.id),
                        { profileId: profile.id, rsvp: "Yes" },
                      ]);
                      setProfileDialog(null);
                    });
                  }}
                  type="button"
                >
                  <strong>{profile.displayName}</strong>
                  <span>{profile.voicePart || "No voice part"}</span>
                  <em>{statusLabel(profile.globalStatus)}</em>
                </button>
              ))}
          </div>
        </div>
      </Dialog>

      <Dialog
        description="Assign an eligible Profile, unassign the current Profile, or remove this seat."
        onClose={() => {
          setSelectedSeat(null);
        }}
        open={selectedSeat !== null}
        title={selectedSeat ? `Seat ${String(Number(selectedSeat.split("-")[1]) + 1)}` : "Seat"}
      >
        {selectedSeat ? (
          <div className="form-stack">
            <p>
              {chart.assignments[selectedSeat]
                ? `Assigned to ${profilesById.get(chart.assignments[selectedSeat])?.displayName ?? "Profile"}.`
                : "This seat is empty."}
            </p>
            <div className="seating-assignment-picker">
              {eligibleProfiles.map((profile) => (
                <button
                  className="seating-lookup-row"
                  key={profile.id}
                  onClick={() => {
                    applyChart({
                      ...chart,
                      assignments: moveAssignment(chart.assignments, "", selectedSeat, profile.id),
                    });
                    setSelectedSeat(null);
                  }}
                  type="button"
                >
                  <strong>{profile.displayName}</strong>
                  <span>{profile.voicePart}</span>
                </button>
              ))}
            </div>
            <div className="form-actions">
              <button
                className="button button--secondary"
                onClick={() => {
                  setSelectedSeat(null);
                }}
                type="button"
              >
                Cancel
              </button>
              {chart.assignments[selectedSeat] ? (
                <button
                  className="button button--secondary"
                  onClick={() => {
                    applyChart({
                      ...chart,
                      assignments: Object.fromEntries(
                        Object.entries(chart.assignments).filter(([key]) => key !== selectedSeat),
                      ),
                    });
                    setSelectedSeat(null);
                  }}
                  type="button"
                >
                  Unassign
                </button>
              ) : null}
              {(() => {
                const [rowText, seatText] = selectedSeat.split("-");
                const rowIndex = Number(rowText);
                const seatIndex = Number(seatText);
                return (chart.rowCounts[rowIndex] ?? 0) > 1 ? (
                  <button
                    className="button button--danger"
                    onClick={() => {
                      setSelectedSeat(null);
                      requestRemoveSeat(rowIndex, seatIndex);
                    }}
                    type="button"
                  >
                    Delete seat
                  </button>
                ) : null;
              })()}
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
