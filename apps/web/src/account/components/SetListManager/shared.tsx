import type {
  OrganizationEvent,
  OrganizationMusicPiece,
  OrganizationProfile,
} from "@choir/contracts";
import { useState } from "react";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";
import { getLastName } from "../../nameFormatting";
import type { PerformerCredit, SetListItem } from "./types";
import { printDateOnly, printTimeOnly, setListPreviewRows } from "./utils";

export function SetListPreview({
  event,
  items,
  music,
}: {
  readonly event: OrganizationEvent;
  readonly items: readonly SetListItem[];
  readonly music: readonly OrganizationMusicPiece[];
}) {
  const rows = setListPreviewRows(items, music);
  return (
    <div className="set-list-preview">
      <header className="set-list-preview__header">
        <h1>{event.title}</h1>
        <p>
          {printDateOnly(event.startsAt)} at {printTimeOnly(event.startsAt)}
          {event.location ? ` | ${event.location}` : ""}
        </p>
      </header>
      <ol className="set-list-preview__items">
        {rows.map(({ arranger, composer, kind, number, performers, title }, index) => {
          if (kind === "intermission") {
            return (
              <li className="set-list-preview__intermission" key={`${title}-${String(index)}`}>
                {title}
              </li>
            );
          }
          const credit = composer || arranger;
          return (
            <li className="set-list-preview__song" key={`${title}-${String(index)}`}>
              <div className="set-list-preview__song-line">
                <span>
                  {String(number)}. {title}
                </span>
                {credit ? <span className="set-list-preview__composer">{credit}</span> : null}
              </div>
              {performers ? (
                <div className="set-list-preview__group">Group — {performers}</div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function SetListPrintView({
  event,
  items,
  music,
}: {
  readonly event: OrganizationEvent;
  readonly items: readonly SetListItem[];
  readonly music: readonly OrganizationMusicPiece[];
}) {
  return (
    <div aria-hidden="true" className="set-list-print-view">
      <SetListPreview event={event} items={items} music={music} />
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
