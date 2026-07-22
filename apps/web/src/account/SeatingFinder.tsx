import type { OrganizationSeatingChart, SingerEvent, SingerSeatingProfile } from "@choir/contracts";
import { useEffect, useState } from "react";

import { getMyEventSeating, getMySchedule } from "../auth/api";

function seatDetail(
  profile: SingerSeatingProfile | null | undefined,
  suggestion: string | undefined,
  seat: number,
): string {
  if (profile && profile.voicePart !== "") return profile.voicePart;
  return suggestion ?? `Seat ${String(seat + 1)}`;
}

export function SeatingFinder({ enabled }: { readonly enabled: boolean }) {
  const [events, setEvents] = useState<readonly SingerEvent[]>([]);
  const [eventId, setEventId] = useState("");
  const [charts, setCharts] = useState<readonly OrganizationSeatingChart[]>([]);
  const [chartId, setChartId] = useState("");
  const [profiles, setProfiles] = useState<readonly SingerSeatingProfile[]>([]);
  const [selfProfileId, setSelfProfileId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getMySchedule(controller.signal)
      .then(({ events: schedule }) => {
        const performances = schedule.filter(({ type }) => type === "Performance");
        setEvents(performances);
        const first = performances[0];
        if (first) setEventId(first.id);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Your seating schedule could not be loaded.");
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !eventId) return;
    const controller = new AbortController();
    getMyEventSeating(eventId, controller.signal)
      .then((result) => {
        setCharts(result.charts);
        setProfiles(result.profiles);
        setSelfProfileId(result.selfProfileId);
        setChartId(result.charts[0]?.id ?? "");
        setError(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCharts([]);
          setProfiles([]);
          setError("Seating is available only after you are added to this performance roster.");
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled, eventId]);

  if (!enabled) return null;
  const chart = charts.find(({ id }) => id === chartId) ?? charts[0] ?? null;
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

  return (
    <section
      className="account-section account-section--seating"
      aria-labelledby="seating-finder-title"
    >
      <p className="eyebrow">Your place</p>
      <h2 id="seating-finder-title">Seating finder</h2>
      <p className="section-description">
        Charts are shown from the director’s perspective, with the back row first.
      </p>
      {error ? (
        <p className="notice notice--warning" role="status">
          {error}
        </p>
      ) : null}
      {events.length === 0 ? (
        <p className="empty-state">No upcoming performance seating is available.</p>
      ) : (
        <>
          <div className="seating-finder-controls">
            <label className="field">
              Performance
              <select
                aria-label="Seating finder performance"
                value={eventId}
                onChange={(event) => {
                  setEventId(event.target.value);
                }}
              >
                {events.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            {charts.length > 1 ? (
              <label className="field">
                Chart
                <select
                  aria-label="Seating finder chart"
                  value={chartId}
                  onChange={(event) => {
                    setChartId(event.target.value);
                  }}
                >
                  {charts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {!chart ? (
            <p className="empty-state">No seating chart has been published for this performance.</p>
          ) : (
            <div className="seating-grid seating-grid--finder" aria-label={chart.name}>
              {[...chart.rowCounts]
                .map((_, offset) => chart.rowCounts.length - offset - 1)
                .map((row) => (
                  <div className="seating-row" key={String(row)}>
                    <span className="seating-row-label">Row {String(row + 1)}</span>
                    {Array.from({ length: chart.rowCounts[row] ?? 0 }, (_, seat) => {
                      const key = `${String(row)}-${String(seat)}`;
                      const profileId = chart.assignments[key];
                      const profile = profileId ? profilesById.get(profileId) : null;
                      const self = profileId === selfProfileId;
                      return (
                        <div
                          className={self ? "seating-seat seating-seat--self" : "seating-seat"}
                          key={key}
                          aria-label={
                            self
                              ? `Your seat, row ${String(row + 1)} seat ${String(seat + 1)}`
                              : undefined
                          }
                        >
                          <strong>{profile?.displayName ?? "Empty"}</strong>
                          <span>{seatDetail(profile, chart.sectionSuggestions[key], seat)}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
