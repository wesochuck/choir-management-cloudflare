import type {
  OrganizationProfile,
  OrganizationRosterConfiguration,
  OrganizationRsvp,
} from "@choir/contracts";
import { useMemo, useState } from "react";
import { AuthApiError, setOrganizationEventRsvp } from "../../../auth/api";

import {
  attendanceLabel,
  formatPerformanceDate,
  parseRsvpStatus,
  profileSectionCode,
  reportableSections,
  reportableVoiceParts,
  sectionFilterKey,
  UNASSIGNED_VOICE_FILTER,
  voicePartFilterKey,
} from "./utils";
import type { PerformanceHistoryState, RsvpStatus } from "./types";

export function VoicePartBalance({
  configuration,
  partLabel,
  profiles,
  selectedFilters,
  onToggle,
}: {
  readonly configuration: OrganizationRosterConfiguration;
  readonly onToggle: (filter: string) => void;
  readonly partLabel: string;
  readonly profiles: readonly OrganizationProfile[];
  readonly selectedFilters: readonly string[];
}) {
  const counts = useMemo(() => {
    const sectionsForReporting = reportableSections(configuration);
    const voicePartsForReporting = reportableVoiceParts(configuration);
    const sections = new Map(sectionsForReporting.map(({ code }) => [code, 0]));
    const voiceParts = new Map(voicePartsForReporting.map(({ label }) => [label, 0]));
    const reportableLabels = new Set(voicePartsForReporting.map(({ label }) => label));
    let unassigned = 0;
    profiles.forEach((profile) => {
      if (!profile.voicePart) {
        unassigned += 1;
        return;
      }
      if (!reportableLabels.has(profile.voicePart)) return;
      voiceParts.set(profile.voicePart, (voiceParts.get(profile.voicePart) ?? 0) + 1);
      const sectionCode = profileSectionCode(profile, configuration);
      if (sectionCode) sections.set(sectionCode, (sections.get(sectionCode) ?? 0) + 1);
    });
    return { sections, unassigned, voiceParts };
  }, [configuration, profiles]);

  return (
    <section className="surface-card roster-balance" aria-labelledby="roster-balance-title">
      <div className="roster-balance__header">
        <div>
          <h2 id="roster-balance-title">{partLabel} balance</h2>
          <p className="field-help">
            Select a section or {partLabel.toLowerCase()} to filter the roster below.
          </p>
        </div>

        <div className="roster-balance__meta">
          <span className="status-pill">{profiles.length} profiles</span>
          {counts.unassigned > 0 ? (
            <button
              aria-pressed={selectedFilters.includes(UNASSIGNED_VOICE_FILTER)}
              className={`roster-balance__unassigned${selectedFilters.includes(UNASSIGNED_VOICE_FILTER) ? " roster-balance__unassigned--selected" : ""}`}
              type="button"
              onClick={() => {
                onToggle(UNASSIGNED_VOICE_FILTER);
              }}
            >
              <span>Unassigned</span>
              <strong>{counts.unassigned}</strong>
            </button>
          ) : null}
        </div>
      </div>
      <div className="roster-balance__sections">
        {reportableSections(configuration).map((section) => {
          const filter = sectionFilterKey(section.code);
          const selected = selectedFilters.includes(filter);
          return (
            <button
              aria-pressed={selected}
              className={`roster-balance__section${selected ? " roster-balance__section--selected" : ""}`}
              key={section.code}
              onClick={() => {
                onToggle(filter);
              }}
              type="button"
            >
              <span>{section.name}</span>
              <strong>{counts.sections.get(section.code) ?? 0}</strong>
            </button>
          );
        })}
      </div>
      <div className="roster-balance__parts">
        {reportableVoiceParts(configuration).map((voicePart) => {
          const filter = voicePartFilterKey(voicePart.label);
          const selected = selectedFilters.includes(filter);
          return (
            <button
              aria-pressed={selected}
              className={`roster-balance__part${selected ? " roster-balance__part--selected" : ""}`}
              key={voicePart.label}
              onClick={() => {
                onToggle(filter);
              }}
              type="button"
            >
              <span>{voicePart.label}</span>
              <strong>{counts.voiceParts.get(voicePart.label) ?? 0}</strong>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function PerformanceHistory({
  onRsvpChanged,
  profileId,
  state,
}: {
  readonly onRsvpChanged: (rsvp: OrganizationRsvp) => void;
  readonly profileId: string;
  readonly state: PerformanceHistoryState;
}) {
  const [rsvpUpdateError, setRsvpUpdateError] = useState<string | null>(null);
  const [savingEventId, setSavingEventId] = useState<string | null>(null);

  async function updateRsvp(eventId: string, rsvp: RsvpStatus): Promise<void> {
    setSavingEventId(eventId);
    setRsvpUpdateError(null);
    try {
      const updated = await setOrganizationEventRsvp(eventId, profileId, rsvp);
      onRsvpChanged(updated);
    } catch (error: unknown) {
      setRsvpUpdateError(
        error instanceof AuthApiError
          ? error.message
          : "The performer's RSVP could not be updated.",
      );
    } finally {
      setSavingEventId(null);
    }
  }

  if (state.status === "loading") {
    return <p className="notice notice--info">Loading performance history…</p>;
  }
  if (state.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Performance history could not be loaded. Try again later.
      </p>
    );
  }
  if (state.status !== "ready") return null;

  const sections = [
    { id: "upcoming", label: "Upcoming performances", rows: state.data.upcoming },
    { id: "past", label: "Past performances", rows: state.data.past },
  ] as const;
  return (
    <div className="profile-performance-history">
      {rsvpUpdateError ? (
        <p className="notice notice--error" role="alert">
          {rsvpUpdateError}
        </p>
      ) : null}
      {sections.map(({ id, label, rows }) => (
        <section aria-labelledby={`profile-performance-${id}`} key={id}>
          <div className="profile-performance-history__heading">
            <h3 id={`profile-performance-${id}`}>
              {label} ({rows.length})
            </h3>
          </div>
          {rows.length === 0 ? (
            <p className="profile-performance-history__empty">
              {id === "past" ? "No past performances yet." : "No upcoming performances."}
            </p>
          ) : (
            <div className="profile-performance-history__list">
              {rows.map((performance) => {
                const formatted = formatPerformanceDate(performance.startsAt);
                return (
                  <article className="profile-performance-card" key={performance.id}>
                    <div className="profile-performance-card__date">
                      <strong>{formatted.date}</strong>
                      <span>{formatted.time}</span>
                    </div>
                    <div className="profile-performance-card__event">
                      <strong>{performance.title}</strong>
                      <span>
                        {performance.venueName || performance.location || "Venue not listed"}
                      </span>
                    </div>
                    <div className="profile-performance-card__status">
                      <span className="profile-performance-card__label">Attended</span>
                      <span className="status-pill">{attendanceLabel(performance.attendance)}</span>
                    </div>
                    <div className="profile-performance-card__status">
                      <label
                        className="profile-performance-card__label"
                        htmlFor={`profile-rsvp-${performance.id}`}
                      >
                        RSVP
                      </label>
                      <select
                        aria-label={`RSVP for ${performance.title}`}
                        className="profile-performance-rsvp-select"
                        disabled={savingEventId !== null}
                        id={`profile-rsvp-${performance.id}`}
                        onChange={(event) => {
                          void updateRsvp(performance.id, parseRsvpStatus(event.target.value));
                        }}
                        value={performance.rsvp}
                      >
                        <option value="Pending">Pending</option>
                        <option value="Yes">Yes (Attending)</option>
                        <option value="No">Declined</option>
                      </select>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
