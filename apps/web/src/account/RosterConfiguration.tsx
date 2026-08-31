import type { OrganizationProfile } from "@choir/contracts";
import { Dialog } from "@choir/ui";
import { useMemo, useState } from "react";

import { updateOrganizationProfile } from "../auth/api";
import { useOrganizationTerminology } from "./organizationTerminologyContext";
import { useRosterConfigurationDraft } from "./RosterConfigurationDraftContext";

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

// eslint-disable-next-line complexity -- this editor coordinates sections, part assignments, and reassignment dialogs.
export function RosterConfiguration({ enabled }: Props) {
  const { partLabel, partLabelPlural, performerLabel } = useOrganizationTerminology();
  const partTerm = partLabel.toLowerCase();
  const {
    draft: configuration,
    draftReturn,
    error: contextError,
    loading,
    profiles,
    refreshProfiles,
    setProfiles,
  } = useRosterConfigurationDraft();

  const [reassigningLabel, setReassigningLabel] = useState<string | null>(null);
  const [replacementVoicePart, setReplacementVoicePart] = useState("");
  const [reassignmentError, setReassignmentError] = useState<string | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
  const [reassignBusy, setReassignBusy] = useState(false);

  const busy = draftReturn.saving || reassignBusy;
  const error = contextError ?? draftReturn.error;
  const setConfiguration = draftReturn.setDraft;
  const savedConfiguration = draftReturn.persisted;

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
    setReassignBusy(true);
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
          : `Cleared the ${partTerm} assignment for ${String(affectedProfiles.length)} Profiles.`,
      );
      setReassigningLabel(null);
    } catch (caught: unknown) {
      await refreshProfiles();
      setReassignmentError(
        caught instanceof Error
          ? `${caught.message} Some assignments may have changed; the roster was refreshed where possible.`
          : "Some Profile assignments could not be updated. The roster was refreshed where possible.",
      );
    } finally {
      setReassignBusy(false);
    }
  }

  const reassigningProfileCount = reassigningLabel
    ? (assignedProfilesByLabel.get(reassigningLabel)?.length ?? 0)
    : 0;

  if (!enabled) return null;

  return (
    <section
      className="account-section account-section--roster-configuration"
      aria-labelledby="roster-configuration-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Organization setup</p>
          <h2 id="roster-configuration-title">Sections and {partLabelPlural.toLowerCase()}</h2>
        </div>
      </div>
      <p className="section-description">
        Keep the order used by roster exports and seating tools. A {partTerm} assignment used by
        Profiles is protected until those assignments are moved or cleared.
      </p>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {assignmentMessage ? (
        <p className="notice notice--success" role="status">
          {assignmentMessage}
        </p>
      ) : null}
      {loading || !configuration ? (
        <p role="status">Loading roster configuration…</p>
      ) : (
        <div className="settings-stack">
          <fieldset className="surface-card organization-settings-panel" disabled={busy}>
            <legend>{performerLabel} terminology</legend>
            <div className="field">
              <label htmlFor="roster-performer-label">{performerLabel} label</label>
              <input
                id="roster-performer-label"
                maxLength={50}
                required
                value={configuration.performerLabel}
                onChange={(event) => {
                  const performerLabelValue = event.target.value;
                  setConfiguration((current) =>
                    current ? { ...current, performerLabel: performerLabelValue } : current,
                  );
                }}
              />
              <span className="field-help">
                The name used for performing members throughout the Organization. For example:
                Singer, Musician, or Performer.
              </span>
            </div>
          </fieldset>
          <fieldset className="surface-card organization-settings-panel" disabled={busy}>
            <legend>Sections</legend>
            <div className="roster-configuration-list">
              {configuration.sections.map((section, index) => {
                const referenced = configuration.voiceParts.some(
                  ({ sectionCode }) => sectionCode === section.code,
                );
                return (
                  <div className="roster-configuration-row" key={`section-row-${String(index)}`}>
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
                      title={referenced ? `Remove its ${partTerm} assignments first.` : undefined}
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

          <fieldset className="surface-card organization-settings-panel" disabled={busy}>
            <legend>{partLabelPlural}</legend>
            <div className="roster-performer-list">
              {configuration.voiceParts.map((voicePart, index) => {
                const assignedProfiles = assignedProfilesByLabel.get(voicePart.label) ?? [];
                const assigned = assignedProfiles.length > 0;
                return (
                  <fieldset
                    className="roster-performer-card"
                    key={`voice-part-row-${String(index)}`}
                  >
                    <legend className="roster-performer-card__legend">
                      <strong>{voicePart.fullName || voicePart.label}</strong>
                      <span
                        className={`status-pill roster-performer-card__status${assigned ? " roster-performer-card__status--assigned" : ""}`}
                      >
                        {assigned
                          ? `${String(assignedProfiles.length)} Profile${assignedProfiles.length === 1 ? "" : "s"} assigned`
                          : "No Profiles assigned"}
                      </span>
                    </legend>
                    <div className="roster-performer-card__fields">
                      <label>
                        Label
                        <input
                          aria-label={`${partLabel} ${String(index + 1)} label`}
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
                          aria-label={`${partLabel} ${String(index + 1)} full name`}
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
                          aria-label={`${partLabel} ${String(index + 1)} section`}
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
                    </div>
                    <div className="roster-performer-card__footer">
                      <p>
                        {assigned
                          ? `Move or clear assigned Profiles before removing this ${partTerm}.`
                          : `This ${partTerm} can be removed because it has no assigned Profiles.`}
                      </p>
                      <button
                        className="button button--secondary button--control-height"
                        disabled={!assigned && configuration.voiceParts.length === 1}
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
                        {assigned ? "Manage assignments" : `Remove ${partTerm}`}
                      </button>
                    </div>
                  </fieldset>
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
                      { fullName: `New ${partTerm}`, label, sectionCode: firstSection.code },
                    ],
                  };
                });
              }}
            >
              Add {partTerm}
            </button>
          </fieldset>
        </div>
      )}
      <Dialog
        description={`Choose a new ${partTerm} assignment for these Profiles, or clear their assignments so this assignment can be removed.`}
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
            ? `${String(reassigningProfileCount)} Profile${reassigningProfileCount === 1 ? "" : "s"} currently ${reassigningProfileCount === 1 ? "uses" : "use"} ${reassigningLabel}. This change is saved immediately; the configuration save bar is only for section and ${partTerm} setup.`
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
            <option value="">No {partTerm} (clear assignment)</option>
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
