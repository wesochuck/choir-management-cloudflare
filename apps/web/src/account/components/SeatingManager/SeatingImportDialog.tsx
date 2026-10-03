import { useRef, useState } from "react";
import {
  seatingTemplateSchema,
  type OrganizationProfile,
  type OrganizationSeatingChart,
  type OrganizationSeatingChartRequest,
  type SeatingConfiguration,
  type SeatingTemplate,
} from "@choir/contracts";
import {
  equivalentSeatingFormation,
  importedSeatingFormation,
  matchSeatingTemplate,
} from "@choir/domain";
import { Dialog, DialogClose } from "@choir/ui";
import {
  getOrganizationSeatingConfiguration,
  updateOrganizationSeatingConfiguration,
} from "../../../api";
import type { SeatingResources } from "./types";

interface Props {
  readonly charts: readonly OrganizationSeatingChart[];
  readonly eligibleProfiles: readonly OrganizationProfile[];
  readonly importChart: (chart: OrganizationSeatingChartRequest) => Promise<void>;
  readonly onClose: () => void;
  readonly onConfigurationSaved: (configuration: SeatingConfiguration) => void;
  readonly performanceName: string;
  readonly resources: SeatingResources;
  readonly venueId: string | null;
}

function useSeatingImport({
  charts,
  eligibleProfiles,
  importChart,
  onClose,
  onConfigurationSaved,
  resources,
  venueId,
}: Props) {
  const [template, setTemplate] = useState<SeatingTemplate | null>(null);
  const [index, setIndex] = useState(0);
  const [name, setName] = useState("");
  const [formationId, setFormationId] = useState("");
  const [allowEmpty, setAllowEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readRevision = useRef(0);
  const submitting = useRef(false);
  const source = template?.charts[index];
  const matching = source
    ? matchSeatingTemplate(
        source,
        resources.profiles,
        new Set(eligibleProfiles.map(({ id }) => id)),
      )
    : null;
  const sectionCodes = new Set(
    resources.roster.sections.filter(({ trackOnly }) => !trackOnly).map(({ code }) => code),
  );
  const allowedParts = source?.formation.isVoicePartLayout
    ? new Set(
        resources.roster.voiceParts
          .filter(({ sectionCode }) => sectionCodes.has(sectionCode))
          .map(({ label }) => label),
      )
    : sectionCodes;
  const issuesBySeat = new Map(matching?.unresolved.map((issue) => [issue.seatKey, issue.reason]));
  const canAddFormation = Boolean(
    source?.formation.sectionOrder.every((part) => allowedParts.has(part)),
  );
  const unresolvedCount = matching?.unresolved.length ?? 0;
  const canImport = Boolean(
    name.trim() &&
    formationId &&
    matching &&
    (unresolvedCount === 0 || allowEmpty) &&
    charts.length < 100 &&
    !busy,
  );

  function selectSource(next: SeatingTemplate, nextIndex: number): void {
    const selected = next.charts[nextIndex];
    if (!selected) return;
    setIndex(nextIndex);
    setName(`${selected.name} (imported)`.slice(0, 200));
    setAllowEmpty(false);
    const existing = equivalentSeatingFormation(selected.formation, resources.seating.formations);
    setFormationId(existing?.id ?? "");
    setError(null);
  }

  async function readFile(file: File | undefined): Promise<void> {
    const revision = ++readRevision.current;
    setTemplate(null);
    setError(null);
    if (!file) return;
    if (file.size > 1_048_576) {
      setError("Choose a seating template smaller than 1 MB.");
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const result = seatingTemplateSchema.safeParse(parsed);
      if (revision !== readRevision.current) return;
      if (!result.success) {
        setError(
          "This file is not a valid seating template. Use a version 1 choir seating template with names and valid seat positions.",
        );
        return;
      }
      setTemplate(result.data);
      selectSource(result.data, 0);
    } catch {
      if (revision === readRevision.current)
        setError("The seating template could not be read. Choose a valid JSON file.");
    } finally {
      if (revision === readRevision.current) setBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (!canImport || !source || !matching || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const latest = await getOrganizationSeatingConfiguration();
      let targetFormationId = formationId;
      if (formationId === "__template__") {
        if (!canAddFormation)
          throw new Error("Choose a formation using this Organization’s sections or voice parts.");
        const imported = importedSeatingFormation(source.formation, latest.formations);
        if (!latest.formations.some(({ id }) => id === imported.id)) {
          if (latest.formations.length >= 50)
            throw new Error(
              "This Organization already has 50 formations. Choose an existing formation.",
            );
          const saved = await updateOrganizationSeatingConfiguration({
            ...latest,
            formations: [...latest.formations, imported],
          });
          onConfigurationSaved(saved);
        }
        targetFormationId = imported.id;
      } else if (!latest.formations.some(({ id }) => id === formationId)) {
        throw new Error(
          "The selected formation no longer exists. Reload seating and choose another formation.",
        );
      }
      await importChart({
        name: name.trim(),
        formationId: targetFormationId,
        rowCounts: source.rowCounts,
        assignments: matching.assignments,
        sectionSuggestions: {},
        venueId,
        sortOrder: Math.min(10_000, Math.max(-1, ...charts.map(({ sortOrder }) => sortOrder)) + 1),
      });
      onClose();
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "The seating chart could not be imported.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return {
    template,
    index,
    name,
    formationId,
    allowEmpty,
    busy,
    error,
    source,
    matching,
    issuesBySeat,
    canAddFormation,
    unresolvedCount,
    canImport,
    selectSource,
    readFile,
    save,
    setName,
    setFormationId,
    setAllowEmpty,
  };
}

export function SeatingImportDialog(props: Props) {
  const { resources, performanceName, onClose } = props;
  const {
    template,
    index,
    name,
    formationId,
    allowEmpty,
    busy,
    error,
    source,
    matching,
    issuesBySeat,
    canAddFormation,
    unresolvedCount,
    canImport,
    selectSource,
    readFile,
    save,
    setName,
    setFormationId,
    setAllowEmpty,
  } = useSeatingImport(props);
  return (
    <Dialog
      description={`Import a new chart into ${performanceName}. Match singers by name against this Organization’s roster, then use Copy to build other charts from it.`}
      dirty={template !== null}
      onClose={() => {
        if (!busy) onClose();
      }}
      open
      title="Import seating chart"
    >
      <div className="form-stack">
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        <label className="field">
          Seating template (JSON)
          <input
            accept=".json,application/json"
            disabled={busy}
            type="file"
            onChange={(event) => {
              void readFile(event.target.files?.[0]);
            }}
          />
        </label>
        {source && matching ? (
          <>
            <label className="field">
              Source chart
              <select
                disabled={busy}
                value={index}
                onChange={(event) => {
                  if (template) selectSource(template, Number(event.target.value));
                }}
              >
                {template?.charts.map((chart, chartIndex) => (
                  <option key={chartIndex} value={chartIndex}>
                    {chart.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              New chart name
              <input
                disabled={busy}
                maxLength={200}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </label>
            <label className="field">
              Formation
              <select
                disabled={busy}
                value={formationId}
                onChange={(event) => {
                  setFormationId(event.target.value);
                }}
              >
                <option value="">Choose a formation</option>
                <option disabled={!canAddFormation} value="__template__">
                  Add template formation: {source.formation.name}
                </option>
                {resources.seating.formations.map((formation) => (
                  <option key={formation.id} value={formation.id}>
                    {formation.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="field-help">
              Template formation: {source.formation.sectionOrder.join(" → ")} ·{" "}
              {source.formation.strategy === "vertical_column" ? "columns" : "rows"}. Adding it
              preserves existing formations.
            </p>
            {!canAddFormation ? (
              <p className="field-help">
                The template uses sections or voice parts absent from this roster. Choose an
                existing formation, or configure those parts before importing.
              </p>
            ) : null}
            <p role="status">
              {source.rowCounts.length} rows ·{" "}
              {source.rowCounts.reduce((sum, count) => sum + count, 0)} seats ·{" "}
              {Object.keys(matching.assignments).length} matched assignments · {unresolvedCount}{" "}
              need review
            </p>
            <details>
              <summary>Review singer matches</summary>
              <ul className="max-h-64 overflow-y-auto">
                {source.assignments.map(({ name: singer, seatKey }) => (
                  <li key={seatKey}>
                    {singer} · seat {seatKey} · {issuesBySeat.get(seatKey) ?? "Matched"}
                  </li>
                ))}
              </ul>
            </details>
            {unresolvedCount > 0 ? (
              <>
                <ul className="max-h-64 overflow-y-auto">
                  {matching.unresolved.map((issue) => (
                    <li key={issue.seatKey}>
                      {issue.name}: {issue.reason}
                    </li>
                  ))}
                </ul>
                <label className="checkbox-row">
                  <input
                    checked={allowEmpty}
                    disabled={busy}
                    onChange={(event) => {
                      setAllowEmpty(event.target.checked);
                    }}
                    type="checkbox"
                  />{" "}
                  Leave these {unresolvedCount} seats empty
                </label>
                <p className="field-help">
                  Resolve names or attendance in the roster to retain those assignments. Importing
                  does not change RSVPs or create Profiles.
                </p>
              </>
            ) : null}
            {props.charts.length >= 100 ? (
              <p role="alert">This Performance already has 100 charts.</p>
            ) : null}
          </>
        ) : null}
        {busy ? <p role="status">Preparing seating chart…</p> : null}
        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" disabled={busy} type="button">
              Cancel
            </button>
          </DialogClose>
          <button
            className="button button--primary"
            disabled={!canImport}
            onClick={() => {
              void save();
            }}
            type="button"
          >
            Import as new chart
          </button>
        </div>
      </div>
    </Dialog>
  );
}
