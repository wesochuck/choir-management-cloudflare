import type {
  OrganizationEvent,
  OrganizationMusicPiece,
  OrganizationProfile,
} from "@choir/contracts";
import { useState } from "react";
import { useOrganizationTerminology } from "../../organizationTerminologyContext";
import type { PerformerCredit, SetListItem } from "./types";
import { printDateLabel, printRowsFor } from "./utils";

export function SetListPrintView({
  event,
  items,
  music,
}: {
  readonly event: OrganizationEvent;
  readonly items: readonly SetListItem[];
  readonly music: readonly OrganizationMusicPiece[];
}) {
  const rows = printRowsFor(items, music);
  return (
    <div aria-hidden="true" className="set-list-print-view">
      <header className="set-list-print-view__header">
        <p className="set-list-print-view__eyebrow">Set list</p>
        <h1>{event.title}</h1>
        <p>{printDateLabel(event.startsAt)}</p>
      </header>
      <table>
        <caption className="sr-only">Set list for {event.title}</caption>
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Composer</th>
            <th scope="col">Arranger</th>
            <th scope="col">Small group / soloists</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ arranger, composer, performers, title }, index) => (
            <tr key={`${title}-${String(index)}`}>
              <td>{title}</td>
              <td>{composer || "—"}</td>
              <td>{arranger || "—"}</td>
              <td>{performers || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
            {profiles.map((profile) => (
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
