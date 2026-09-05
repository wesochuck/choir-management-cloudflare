import type { DonationLevel } from "@choir/contracts";

import { money, type DonationSettingsState } from "./types";

export function DonationLevelsTab({
  busy,
  deleteLevel,
  editLevel,
  newLevel,
  settingsState,
}: {
  readonly busy: boolean;
  readonly deleteLevel: (levelId: string) => Promise<void>;
  readonly editLevel: (level: DonationLevel) => void;
  readonly newLevel: () => void;
  readonly settingsState: DonationSettingsState;
}) {
  if (settingsState.status === "loading") return <p>Loading donation settings…</p>;
  if (settingsState.status === "error") {
    return <p className="notice notice--error">Donation settings could not be loaded.</p>;
  }
  return (
    <fieldset className="surface-card donation-levels-card">
      <legend>Donor levels</legend>
      <div className="section-heading section-heading--compact donation-levels-heading">
        <button className="button button--primary" onClick={newLevel} type="button">
          Add level
        </button>
      </div>
      <p>Suggested amounts and benefits appear on the public donation page.</p>
      {settingsState.settings.levels.length === 0 ? (
        <div className="empty-state">
          <p>No donor levels configured yet.</p>
          <button className="button button--primary" onClick={newLevel} type="button">
            Create your first level
          </button>
        </div>
      ) : null}
      {settingsState.settings.levels.length > 0 ? (
        <div className="table-scroll donation-level-table-scroll">
          <table className="data-table donation-level-table table--actions">
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Suggested amount</th>
                <th scope="col">Recognition benefit</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {settingsState.settings.levels.map((level) => (
                <tr key={level.id}>
                  <th scope="row">{level.label}</th>
                  <td>{money(level.amountCents)}</td>
                  <td>{level.benefit || "No benefit specified"}</td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          editLevel(level);
                        }}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="text-button text-button--danger"
                        disabled={busy}
                        onClick={() => {
                          void deleteLevel(level.id);
                        }}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </fieldset>
  );
}
