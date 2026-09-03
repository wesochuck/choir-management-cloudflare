import { formatDate } from "../format";
import type { PlayerDetails } from "../types";

export function PlayerHeader({ details }: { readonly details: PlayerDetails }) {
  return (
    <header className="public-player__header">
      <h1 id="player-title">{details.eventTitle}</h1>
      <p>{formatDate(details.eventStartsAt)}</p>
      {details.profileName ? <p>Welcome, {details.profileName}.</p> : null}
    </header>
  );
}
