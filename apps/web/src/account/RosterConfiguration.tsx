import type { OrganizationRosterConfiguration } from "@choir/contracts";
import { useEffect, useState } from "react";

import {
  getOrganizationRosterConfiguration,
  listOrganizationProfiles,
  updateOrganizationRosterConfiguration,
} from "../auth/api";

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

export function RosterConfiguration({ enabled }: Props) {
  const [configuration, setConfiguration] = useState<OrganizationRosterConfiguration | null>(null);
  const [assignedLabels, setAssignedLabels] = useState<ReadonlySet<string>>(new Set());
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
      .then(([nextConfiguration, profiles]) => {
        setConfiguration(nextConfiguration);
        setAssignedLabels(new Set(profiles.map(({ voicePart }) => voicePart).filter(Boolean)));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Roster configuration could not be loaded.");
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  if (!enabled) return null;

  async function save(): Promise<void> {
    if (!configuration) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setConfiguration(await updateOrganizationRosterConfiguration(configuration));
      setSaved(true);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "Roster configuration could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

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
        Keep the order used by roster exports and seating tools. Assigned voice-part labels cannot
        be removed or renamed.
      </p>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="notice notice--success" role="status">
          Roster configuration saved.
        </p>
      ) : null}
      {!configuration ? (
        <p role="status">Loading roster configuration…</p>
      ) : (
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
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
                const assigned = assignedLabels.has(voicePart.label);
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
                    <button
                      className="button button--secondary"
                      disabled={assigned || configuration.voiceParts.length === 1}
                      title={assigned ? "This voice part is assigned to a Profile." : undefined}
                      type="button"
                      onClick={() => {
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
          <button className="button button--primary" disabled={busy} type="submit">
            {busy ? "Saving…" : "Save sections and voice parts"}
          </button>
        </form>
      )}
    </section>
  );
}
