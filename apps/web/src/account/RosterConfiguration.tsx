import type { OrganizationProfile, OrganizationRosterConfiguration } from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { useEffect, useMemo, useState } from "react";

import {
  getOrganizationRosterConfiguration,
  listOrganizationProfiles,
  updateOrganizationProfile,
  updateOrganizationRosterConfiguration,
} from "../auth/api";
import { useFloatingSaveAction } from "./useFloatingSaveAction";
import { useOrganizationTerminology } from "./organizationTerminologyContext";

interface Props {
  readonly enabled: boolean;
}

function nextUniqueLabel(prefix: string, used: ReadonlySet<string>): string {
  let candidate = prefix;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${prefix}${String(suffix)}`;
    suffix += 1;
  }
  return candidate;
}

function configurationKey(configuration: OrganizationRosterConfiguration | null): string {
  return configuration ? JSON.stringify(configuration) : "";
}

function profileRequestFrom(profile: OrganizationProfile) {
  return {
    displayName: profile.displayName,
    doNotEmail: profile.doNotEmail,
    globalStatus: profile.globalStatus,
    isSectionLeader: profile.isSectionLeader,
    notes: profile.notes,
    phone: profile.phone,
    receiveAdminNotifications: profile.receiveAdminNotifications,
    receiveAttendanceReports: profile.receiveAttendanceReports,
    receiveFinancialAlerts: profile.receiveFinancialAlerts,
    receiveRsvpDeclineNotices: profile.receiveRsvpDeclineNotices,
    showInDirectory: profile.showInDirectory,
    statusIsManual: profile.statusIsManual,
    voicePart: profile.voicePart,
  };
}

// eslint-disable-next-line complexity -- this editor coordinates sections, voice parts, and reassignment dialogs.
export function RosterConfiguration({ enabled }: Props) {
  const { setPerformerLabel } = useOrganizationTerminology();
  const [configuration, setConfiguration] = useState<OrganizationRosterConfiguration | null>(null);
  const [savedConfiguration, setSavedConfiguration] =
    useState<OrganizationRosterConfiguration | null>(null);
  const [profiles, setProfiles] = useState<readonly OrganizationProfile[]>([]);
  const [reassigningLabel, setReassigningLabel] = useState<string | null>(null);
  const [replacementVoicePart, setReplacementVoicePart] = useState("");
  const [reassignmentError, setReassignmentError] = useState<string | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    Promise.all([
      getOrganizationRosterConfiguration(controller.signal),
      listOrganizationProfiles(controller.signal),
    ])
      .then(([nextConfiguration, nextProfiles]) => {
        setConfiguration(nextConfiguration);
        setSavedConfiguration(nextConfiguration);
        setPerformerLabel(nextConfiguration.performerLabel);
        setProfiles(nextProfiles);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Roster configuration could not be loaded.");
      });
    return () => {
      controller.abort();
    };
  }, [enabled, setPerformerLabel]);

  async function save(): Promise<void> {
    if (!configuration) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const latest = await getOrganizationRosterConfiguration();
      const nextConfiguration = await updateOrganizationRosterConfiguration({
        ...latest,
        performerLabel: configuration.performerLabel,
        sections: configuration.sections,
        voiceParts: configuration.voiceParts,
      });
      setConfiguration(nextConfiguration);
      setSavedConfiguration(nextConfiguration);
      setPerformerLabel(nextConfiguration.performerLabel);
      setSaved(true);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Roster configuration could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  const assignedProfilesByLabel = useMemo(() => {
    const grouped = new Map<string, OrganizationProfile[]>();
    profiles.forEach((profile) => {
      if (!profile.voicePart) return;
      const current = grouped.get(profile.voicePart) ?? [];
      current.push(profile);
      grouped.set(profile.voicePart, current);
    });
    return grouped;
  }, [profiles]);

  function openReassignment(label: string): void {
    setReassignmentError(null);
    setReplacementVoicePart("");
    setReassigningLabel(label);
  }

  async function reassignProfiles(): Promise<void> {
    if (!reassigningLabel) return;
    const affectedProfiles = assignedProfilesByLabel.get(reassigningLabel) ?? [];
    if (affectedProfiles.length === 0) {
      setReassigningLabel(null);
      return;
    }
    setBusy(true);
    setReassignmentError(null);
    try {
      const updatedProfiles = await Promise.all(
        affectedProfiles.map((profile) =>
          updateOrganizationProfile(profile.id, {
            ...profileRequestFrom(profile),
            voicePart: replacementVoicePart,
          }),
        ),
      );
      const updatedById = new Map(updatedProfiles.map((profile) => [profile.id, profile]));
      setProfiles((current) => current.map((profile) => updatedById.get(profile.id) ?? profile));
      setAssignmentMessage(
        replacementVoicePart
          ? `Updated ${String(affectedProfiles.length)} profiles to ${replacementVoicePart}.`
          : `Cleared the voice-part assignment for ${String(affectedProfiles.length)} profiles.`,
      );
      setReassigningLabel(null);
    } catch (caught: unknown) {
      try {
        setProfiles(await listOrganizationProfiles());
      } catch {
        // Keep the existing list if the recovery refresh is unavailable.
      }
      setReassignmentError(
        caught instanceof Error
          ? `${caught.message} Some assignments may have changed; the roster was refreshed where possible.`
          : "Some Profile assignments could not be updated. The roster was refreshed where possible.",
      );
    } finally {
      setBusy(false);
    }
  }

  const dirty = configurationKey(configuration) !== configurationKey(savedConfiguration);
  useFloatingSaveAction({
    busy,
    dirty,
    id: "organization-roster-configuration",
    onDiscard: () => {
      setConfiguration(savedConfiguration);
      setSaved(false);
    },
    onSave: save,
  });

  if (!enabled) return null;

  return (
    <section
      className="account-section account-section--roster-configuration"
      aria-labelledby="roster-configuration-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Organization setup</p>
          <h2 id="roster-configuration-title">Sections and voice parts</h2>
        </div>
      </div>
      <p className="section-description">
        Keep the order used by roster exports and seating tools. A voice part used by Profiles is
        protected until those assignments are moved or cleared.
      </p>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {saved && !dirty ? (
        <p className="notice notice--success" role="status">
          Roster configuration saved.
        </p>
      ) : null}
      {assignmentMessage ? (
        <p className="notice notice--success" role="status">
          {assignmentMessage}
        </p>
      ) : null}
      {!configuration ? (
        <p role="status">Loading roster configuration…</p>
      ) : (
        <div className="form-stack">
          <fieldset disabled={busy}>
            <legend>Performer terminology</legend>
            <div className="field">
              <label htmlFor="roster-performer-label">Performer label</label>
              <input
                id="roster-performer-label"
                maxLength={50}
                required
                value={configuration.performerLabel}
                onChange={(event) => {
                  const performerLabel = event.target.value;
                  setConfiguration((current) =>
                    current ? { ...current, performerLabel } : current,
                  );
                }}
              />
              <span className="field-help">
                The name used for performing members throughout the Organization. For example:
                Singer, Musician, or Performer.
              </span>
            </div>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Sections</legend>
            <div className="roster-configuration-list">
              {configuration.sections.map((section, index) => {
                const referenced = configuration.voiceParts.some(
                  ({ sectionCode }) => sectionCode === section.code,
                );
                return (
                  <div
                    className="roster-configuration-row"
                    key={`${section.code}-${String(index)}`}
                  >
                    <label>
                      Code
                      <input
                        aria-label={`Section ${String(index + 1)} code`}
                        maxLength={20}
                        required
                        value={section.code}
                        onChange={(event) => {
                          const previousCode = section.code;
                          const code = event.target.value;
                          setConfiguration(
                            (current) =>
                              current && {
                                ...current,
                                sections: current.sections.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, code } : item,
                                ),
                                voiceParts: current.voiceParts.map((item) =>
                                  item.sectionCode === previousCode
                                    ? { ...item, sectionCode: code }
                                    : item,
                                ),
                              },
                          );
                        }}
                      />
                    </label>
                    <label>
                      Name
                      <input
                        aria-label={`Section ${String(index + 1)} name`}
                        maxLength={100}
                        required
                        value={section.name}
                        onChange={(event) => {
                          const name = event.target.value;
                          setConfiguration(
                            (current) =>
                              current && {
                                ...current,
                                sections: current.sections.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, name } : item,
                                ),
                              },
                          );
                        }}
                      />
                    </label>
                    <label>
                      Color
                      <input
                        aria-label={`Section ${String(index + 1)} color`}
                        type="color"
                        value={section.color}
                        onChange={(event) => {
                          const color = event.target.value;
                          setConfiguration(
                            (current) =>
                              current && {
                                ...current,
                                sections: current.sections.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, color } : item,
                                ),
                              },
                          );
                        }}
                      />
                    </label>
                    <label className="checkbox-row">
                      <input
                        checked={section.trackOnly}
                        type="checkbox"
                        onChange={(event) => {
                          const trackOnly = event.target.checked;
                          setConfiguration(
                            (current) =>
                              current && {
                                ...current,
                                sections: current.sections.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, trackOnly } : item,
                                ),
                              },
                          );
                        }}
                      />
                      Track only
                    </label>
                    <button
                      className="button button--secondary"
                      disabled={configuration.sections.length === 1 || referenced}
                      title={referenced ? "Remove its voice parts first." : undefined}
                      type="button"
                      onClick={() => {
                        setConfiguration(
                          (current) =>
                            current && {
                              ...current,
                              sections: current.sections.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            },
                        );
                      }}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                setConfiguration((current) => {
                  if (!current) return current;
                  const code = nextUniqueLabel(
                    "NEW",
                    new Set(current.sections.map((section) => section.code)),
                  );
                  return {
                    ...current,
                    sections: [
                      ...current.sections,
                      { code, color: "#475569", name: "New section", trackOnly: false },
                    ],
                  };
                });
              }}
            >
              Add section
            </button>
          </fieldset>

          <fieldset disabled={busy}>
            <legend>Voice parts</legend>
            <div className="roster-configuration-list">
              {configuration.voiceParts.map((voicePart, index) => {
                const assignedProfiles = assignedProfilesByLabel.get(voicePart.label) ?? [];
                const assigned = assignedProfiles.length > 0;
                return (
                  <div
                    className="roster-configuration-row"
                    key={`${voicePart.label}-${String(index)}`}
                  >
                    <label>
                      Label
                      <input
                        aria-label={`Voice part ${String(index + 1)} label`}
                        disabled={assigned}
                        maxLength={50}
                        required
                        value={voicePart.label}
                        onChange={(event) => {
                          const label = event.target.value;
                          setConfiguration(
                            (current) =>
                              current && {
                                ...current,
                                voiceParts: current.voiceParts.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, label } : item,
                                ),
                              },
                          );
                        }}
                      />
                    </label>
                    <label>
                      Full name
                      <input
                        aria-label={`Voice part ${String(index + 1)} full name`}
                        maxLength={100}
                        required
                        value={voicePart.fullName}
                        onChange={(event) => {
                          const fullName = event.target.value;
                          setConfiguration(
                            (current) =>
                              current && {
                                ...current,
                                voiceParts: current.voiceParts.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, fullName } : item,
                                ),
                              },
                          );
                        }}
                      />
                    </label>
                    <label>
                      Section
                      <select
                        aria-label={`Voice part ${String(index + 1)} section`}
                        value={voicePart.sectionCode}
                        onChange={(event) => {
                          const sectionCode = event.target.value;
                          setConfiguration(
                            (current) =>
                              current && {
                                ...current,
                                voiceParts: current.voiceParts.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, sectionCode } : item,
                                ),
                              },
                          );
                        }}
                      >
                        {configuration.sections.map(({ code, name }) => (
                          <option key={code} value={code}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="roster-configuration-assignment">
                      <button
                        className="button button--secondary"
                        disabled={configuration.voiceParts.length === 1}
                        type="button"
                        onClick={() => {
                          if (assigned) {
                            openReassignment(voicePart.label);
                            return;
                          }
                          setConfiguration(
                            (current) =>
                              current && {
                                ...current,
                                voiceParts: current.voiceParts.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              },
                          );
                        }}
                      >
                        {assigned ? "Review assignments" : "Remove"}
                      </button>
                      {assigned ? (
                        <span className="field-help">
                          Used by {String(assignedProfiles.length)} Profile
                          {assignedProfiles.length === 1 ? "" : "s"}. Move or clear these
                          assignments before removing this part.
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                const firstSection = configuration.sections[0];
                if (!firstSection) return;
                setConfiguration((current) => {
                  if (!current) return current;
                  const label = nextUniqueLabel(
                    "NEW",
                    new Set(current.voiceParts.map((voicePart) => voicePart.label)),
                  );
                  return {
                    ...current,
                    voiceParts: [
                      ...current.voiceParts,
                      { fullName: "New voice part", label, sectionCode: firstSection.code },
                    ],
                  };
                });
              }}
            >
              Add voice part
            </button>
          </fieldset>
        </div>
      )}
      <Dialog
        description="Choose a new voice part for these Profiles, or clear their assignments so this part can be removed."
        onClose={() => {
          if (!busy) setReassigningLabel(null);
        }}
        open={reassigningLabel !== null}
        title={reassigningLabel ? `Review ${reassigningLabel} assignments` : "Review assignments"}
      >
        {reassignmentError ? (
          <p className="notice notice--error" role="alert">
            {reassignmentError}
          </p>
        ) : null}
        <p>
          {reassigningLabel
            ? `${String(assignedProfilesByLabel.get(reassigningLabel)?.length ?? 0)} Profiles currently use ${reassigningLabel}. This change is saved immediately; the configuration save bar is only for section and voice-part setup.`
            : "Review the affected Profiles before changing their assignments."}
        </p>
        <div className="field">
          <label htmlFor="roster-replacement-voice-part">Move assignments to</label>
          <select
            disabled={busy}
            id="roster-replacement-voice-part"
            value={replacementVoicePart}
            onChange={(event) => {
              setReplacementVoicePart(event.target.value);
            }}
          >
            <option value="">No voice part (clear assignment)</option>
            {(savedConfiguration?.voiceParts ?? configuration?.voiceParts ?? [])
              .filter(({ label }) => label !== reassigningLabel)
              .map(({ label, fullName }) => (
                <option key={label} value={label}>
                  {label} — {fullName}
                </option>
              ))}
          </select>
        </div>
        <ul className="account-list">
          {(reassigningLabel ? (assignedProfilesByLabel.get(reassigningLabel) ?? []) : []).map(
            (profile) => (
              <li key={profile.id}>
                <strong>{profile.displayName}</strong>
                <span>{profile.globalStatus === "Idle" ? "On Break" : profile.globalStatus}</span>
              </li>
            ),
          )}
        </ul>
        <div className="dialog__actions">
          <button
            className="button button--secondary"
            disabled={busy}
            onClick={() => {
              setReassigningLabel(null);
            }}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={busy || reassigningLabel === null}
            onClick={() => void reassignProfiles()}
            type="button"
          >
            {busy ? "Updating…" : "Apply assignments"}
          </button>
        </div>
      </Dialog>
    </section>
  );
}
