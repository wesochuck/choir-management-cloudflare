import type {
  OrganizationEvent,
  OrganizationMusicPiece,
  OrganizationProfile,
  OrganizationVenue,
} from "@choir/contracts";
import { calculateSetListTiming, formatSetListDuration } from "@choir/domain";
import { useState } from "react";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";
import { getLastName } from "../../nameFormatting";
import type { PerformerCredit, SetListItem } from "./types";
import {
  effectiveSetListItemDurationSeconds,
  formatPerformerCredits,
  groupSetListForPresentation,
  printDateOnly,
  printTimeOnly,
  resolveEventVenueName,
  type PresentationGroupEntry,
  type PresentationIntermissionEntry,
  type PresentationStandaloneEntry,
  type SetListPresentationEntry,
} from "./utils";

function renderIntermissionPreview(entry: PresentationIntermissionEntry, showNotes: boolean) {
  return (
    <li className="set-list-preview__intermission" key={`intermission-${String(entry.flatIndex)}`}>
      {entry.item.title}
      {showNotes && entry.notes ? (
        <div className="set-list-preview__note">{entry.notes}</div>
      ) : null}
    </li>
  );
}

function renderStandalonePreview(entry: PresentationStandaloneEntry, showNotes: boolean) {
  const performers = formatPerformerCredits(entry.item);
  return (
    <li className="set-list-preview__song" key={`song-${String(entry.flatIndex)}`}>
      <div className="set-list-preview__song-line">
        <span>
          {String(entry.programNumber)}. {entry.item.title}
        </span>
        {entry.credit ? <span className="set-list-preview__composer">{entry.credit}</span> : null}
      </div>
      {entry.parentPiece ? (
        <div className="set-list-preview__from-parent">from {entry.parentPiece.title}</div>
      ) : null}
      {performers ? <div className="set-list-preview__group">Group — {performers}</div> : null}
      {showNotes && entry.notes ? (
        <div className="set-list-preview__note">{entry.notes}</div>
      ) : null}
    </li>
  );
}

function renderGroupPreview(entry: PresentationGroupEntry, showNotes: boolean) {
  const parentTitle = entry.parentItem?.title ?? entry.parentPiece.title;
  const parentPerformers = entry.parentItem ? formatPerformerCredits(entry.parentItem) : "";
  const groupKey = `group-${entry.parentPiece.id}-${String(entry.parentFlatIndex ?? entry.movements[0]?.flatIndex)}`;
  return (
    <li className="set-list-preview__song set-list-preview__song--group" key={groupKey}>
      <div className="set-list-preview__song-line">
        <span>
          {String(entry.programNumber)}. {parentTitle}
        </span>
        {entry.credit ? <span className="set-list-preview__composer">{entry.credit}</span> : null}
      </div>
      {parentPerformers ? (
        <div className="set-list-preview__group">Group — {parentPerformers}</div>
      ) : null}
      {showNotes && entry.notes ? (
        <div className="set-list-preview__note">{entry.notes}</div>
      ) : null}
      <ul aria-label={`Movements of ${parentTitle}`} className="set-list-preview__movements">
        {entry.movements.map((movement) => {
          const mPerformers = formatPerformerCredits(movement.item);
          return (
            <li
              className="set-list-preview__movement"
              key={`movement-${String(movement.flatIndex)}`}
            >
              <div className="set-list-preview__song-line">
                <span className="set-list-preview__movement-title">{movement.item.title}</span>
                {movement.credit ? (
                  <span className="set-list-preview__composer">{movement.credit}</span>
                ) : null}
              </div>
              {mPerformers ? (
                <div className="set-list-preview__group">Group — {mPerformers}</div>
              ) : null}
              {showNotes && movement.notes ? (
                <div className="set-list-preview__note">{movement.notes}</div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

function renderPreviewEntry(entry: SetListPresentationEntry, showNotes: boolean) {
  if (entry.kind === "intermission") {
    return renderIntermissionPreview(entry, showNotes);
  }
  if (entry.kind === "standalone") {
    return renderStandalonePreview(entry, showNotes);
  }
  return renderGroupPreview(entry, showNotes);
}

export function SetListPreview({
  defaultTransitionSeconds,
  event,
  items,
  music,
  showNotes = false,
  venues,
}: {
  readonly defaultTransitionSeconds?: number | undefined;
  readonly event: OrganizationEvent;
  readonly items: readonly SetListItem[];
  readonly music: readonly OrganizationMusicPiece[];
  readonly showNotes?: boolean;
  readonly venues?: readonly OrganizationVenue[] | string | undefined;
}) {
  const transitionSeconds = defaultTransitionSeconds ?? event.setListDefaultTransitionSeconds;
  const timing = calculateSetListTiming(items, transitionSeconds, (item) =>
    effectiveSetListItemDurationSeconds(item, music),
  );
  const entries = groupSetListForPresentation(items, music);
  const venue = resolveEventVenueName(event, venues);
  return (
    <div className="set-list-preview">
      <header className="set-list-preview__header">
        <h1>{event.title}</h1>
        <p>
          {printDateOnly(event.startsAt)} at {printTimeOnly(event.startsAt)}
          {venue ? ` | ${venue}` : ""}
        </p>
        <div className="set-list-preview__timing">
          <span>Estimated runtime: {formatSetListDuration(timing.estimatedRuntime)}</span>
          {transitionSeconds > 0 ? (
            <span>Default between-song time: {formatSetListDuration(transitionSeconds)}</span>
          ) : null}
        </div>
      </header>
      <ol className="set-list-preview__items">
        {entries.map((entry) => renderPreviewEntry(entry, showNotes))}
      </ol>
    </div>
  );
}

export function SetListPrintView({
  defaultTransitionSeconds,
  event,
  items,
  music,
  showNotes = false,
  venues,
}: {
  readonly defaultTransitionSeconds?: number | undefined;
  readonly event: OrganizationEvent;
  readonly items: readonly SetListItem[];
  readonly music: readonly OrganizationMusicPiece[];
  readonly showNotes?: boolean;
  readonly venues?: readonly OrganizationVenue[] | string | undefined;
}) {
  return (
    <div aria-hidden="true" className="set-list-print-view">
      <SetListPreview
        defaultTransitionSeconds={defaultTransitionSeconds}
        event={event}
        items={items}
        music={music}
        showNotes={showNotes}
        venues={venues}
      />
    </div>
  );
}

export function SetListCreditEditor({
  item,
  onChange,
  profiles,
}: {
  readonly item: SetListItem;
  readonly onChange: (item: SetListItem) => void;
  readonly profiles: readonly OrganizationProfile[];
}) {
  const { performerLabel } = useOrganizationTerminology();
  const [guestName, setGuestName] = useState("");
  const credits = item.performerCredits ?? [];
  const sortedProfiles = [...profiles].sort((left, right) => {
    const byLastName = getLastName(left.displayName).localeCompare(
      getLastName(right.displayName),
      undefined,
      { sensitivity: "base" },
    );
    return byLastName !== 0
      ? byLastName
      : left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
  });

  function addCredit(credit: PerformerCredit): void {
    if (
      credit.kind === "profile" &&
      credits.some(
        (candidate) => candidate.kind === "profile" && candidate.profileId === credit.profileId,
      )
    ) {
      return;
    }
    onChange({ ...item, performerCredits: [...credits, credit] });
  }

  return (
    <div className="set-list-credits">
      <p className="field-help">{performerLabel} credits are saved as display-name snapshots.</p>
      <div className="set-list-credit-controls">
        <label className="field">
          Add Organization Profile
          <select
            value=""
            onChange={(event) => {
              const profile = profiles.find(({ id }) => id === event.target.value);
              if (profile) {
                addCredit({
                  displayName: profile.displayName,
                  kind: "profile",
                  profileId: profile.id,
                });
              }
            }}
          >
            <option value="">Choose a Profile…</option>
            {sortedProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Add guest {performerLabel.toLowerCase()}
          <span className="set-list-inline-control">
            <input
              maxLength={200}
              value={guestName}
              onChange={(event) => {
                setGuestName(event.target.value);
              }}
            />
            <button
              className="button button--secondary"
              disabled={!guestName.trim()}
              type="button"
              onClick={() => {
                addCredit({ displayName: guestName.trim(), kind: "guest" });
                setGuestName("");
              }}
            >
              Add
            </button>
          </span>
        </label>
      </div>
      {credits.length > 0 ? (
        <ul className="set-list-credit-list">
          {credits.map((credit, index) => (
            <li key={`${credit.kind}-${credit.displayName}-${String(index)}`}>
              <span>
                {credit.displayName} {credit.kind === "guest" ? "(guest)" : ""}
              </span>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  onChange({
                    ...item,
                    performerCredits: credits.filter(
                      (_, candidateIndex) => candidateIndex !== index,
                    ),
                  });
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
