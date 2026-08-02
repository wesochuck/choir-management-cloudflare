import type {
  OrganizationProfile,
  OrganizationRosterConfiguration,
  SeatingConfiguration,
  SeatingFormation,
} from "@choir/contracts";
import { useDraggable } from "@dnd-kit/core";
import { Dialog } from "@choir/ui";
import { useState, type DragEvent } from "react";
import { updateOrganizationSeatingConfiguration } from "../../../auth/api";
import { normalizeFormationOrder, formationOrderOptions, moveFormationOrderItem } from "./utils";
import type { ConfirmState } from "./types";

export function ConfirmDialog({
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

export function FormationOrderEditor({
  formation,
  onChange,
  roster,
}: {
  readonly formation: SeatingFormation;
  readonly onChange: (sectionOrder: readonly string[]) => void;
  readonly roster: OrganizationRosterConfiguration;
}) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const options = formationOrderOptions(formation, roster);
  const optionByValue = new Map(options.map((option) => [option.value, option]));
  const order = formation.sectionOrder;

  function move(from: number, to: number): void {
    onChange(moveFormationOrderItem(order, from, to));
  }

  function dropIndexForPointer(event: DragEvent<HTMLDivElement>, index: number): number {
    const bounds = event.currentTarget.getBoundingClientRect();
    const horizontal = formation.strategy !== "horizontal_row";
    const midpoint = horizontal ? bounds.left + bounds.width / 2 : bounds.top + bounds.height / 2;
    const after = horizontal ? event.clientX >= midpoint : event.clientY >= midpoint;
    return after ? index + 1 : index;
  }

  return (
    <div className="formation-order-editor">
      <div className="formation-order-editor__heading">
        <span>Section or voice-part order</span>
        <small>
          Drag the handles to set the order. The highlighted line shows where it will land.
        </small>
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
              className={`formation-order-item${draggingIndex === index ? " formation-order-item--dragging" : ""}${dropTargetIndex === index ? " formation-order-item--drop-before" : ""}${dropTargetIndex === index + 1 ? " formation-order-item--drop-after" : ""}${option ? "" : " formation-order-item--unknown"}`}
              draggable
              key={`${value}-${String(index)}`}
              onDragEnd={() => {
                setDraggingIndex(null);
                setDropTargetIndex(null);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTargetIndex(dropIndexForPointer(event, index));
              }}
              onDragStart={(event) => {
                setDraggingIndex(index);
                setDropTargetIndex(index);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(index));
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = Number(event.dataTransfer.getData("text/plain"));
                const target = dropTargetIndex ?? dropIndexForPointer(event, index);
                const destination = target > from ? target - 1 : target;
                if (Number.isInteger(from)) move(from, destination);
                setDraggingIndex(null);
                setDropTargetIndex(null);
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

export function FormationEditor({
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

export function UnassignedProfileChip({
  onRemove,
  profile,
}: {
  readonly onRemove: (profile: OrganizationProfile) => void;
  readonly profile: OrganizationProfile;
}) {
  const {
    attributes: dragAttributes,
    isDragging: profileIsDragging,
    listeners: dragListeners,
    setNodeRef: setProfileNodeRef,
  } = useDraggable({ id: `profile:${profile.id}` });
  const attachProfileNode = (node: HTMLElement | null) => {
    setProfileNodeRef(node);
  };
  return (
    <div
      className={`seating-profile-chip${profileIsDragging ? " seating-profile-chip--dragging" : ""}`}
      draggable
      ref={attachProfileNode}
      style={{ opacity: profileIsDragging ? 0.45 : undefined }}
      {...dragAttributes}
      {...dragListeners}
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
