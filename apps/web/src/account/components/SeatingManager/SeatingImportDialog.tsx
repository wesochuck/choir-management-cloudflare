import { useRef, useState } from "react";
import {
  seatingTemplateSchema,
  type OrganizationProfile,
  type OrganizationRosterConfiguration,
  type OrganizationSeatingChart,
  type OrganizationSeatingChartRequest,
  type SeatingConfiguration,
  type SeatingTemplate,
} from "@choir/contracts";
import {
  equivalentSeatingFormation,
  importedSeatingFormation,
  matchSeatingTemplate,
  normalizeSeatingName,
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

type SourceChart = SeatingTemplate["charts"][number];
function canUseFormation(
  source: SourceChart | undefined,
  roster: OrganizationRosterConfiguration,
): boolean {
  const sections = new Set(
    roster.sections.filter(({ trackOnly }) => !trackOnly).map(({ code }) => code),
  );
  const allowed = source?.formation.isVoicePartLayout
    ? new Set(
        roster.voiceParts
          .filter(({ sectionCode }) => sections.has(sectionCode))
          .map(({ label }) => label),
      )
    : sections;
  return Boolean(source?.formation.sectionOrder.every((part) => allowed.has(part)));
}
function importIsReady(input: {
  name: string;
  mode: string;
  formationId: string;
  unresolvedCount: number;
  allowEmpty: boolean;
  hasMatches: boolean;
  templateCount: number;
  chartCount: number;
  busy: boolean;
}): boolean {
  if (!input.name.trim() || !input.hasMatches || input.busy) return false;
  if (input.mode === "template") return input.templateCount < 20;
  return (
    Boolean(input.formationId) &&
    (input.unresolvedCount === 0 || input.allowEmpty) &&
    input.chartCount < 100
  );
}
async function saveTemplate(input: {
  latest: SeatingConfiguration;
  id: string;
  name: string;
  source: SourceChart;
  formationId: string;
  assignments: Readonly<Record<string, string>>;
}): Promise<SeatingConfiguration> {
  const templates = input.latest.templates ?? [];
  if (templates.length >= 20 && !templates.some(({ id }) => id === input.id))
    throw new Error("This Organization already has 20 templates.");
  const formation =
    input.latest.formations.find(({ id }) => id === input.formationId) ?? input.source.formation;
  return updateOrganizationSeatingConfiguration({
    ...input.latest,
    templates: [
      ...templates.filter(({ id }) => id !== input.id),
      {
        ...input.source,
        id: input.id,
        name: input.name.trim(),
        formation,
        assignments: input.source.assignments.map((assignment) => ({
          ...assignment,
          ...(input.assignments[assignment.seatKey]
            ? { profileId: input.assignments[assignment.seatKey] }
            : {}),
        })),
      },
    ],
  });
}
async function prepareFormation(
  latest: SeatingConfiguration,
  source: SourceChart,
  formationId: string,
  canAdd: boolean,
  onSaved: Props["onConfigurationSaved"],
): Promise<string> {
  if (formationId !== "__template__") {
    if (!latest.formations.some(({ id }) => id === formationId))
      throw new Error(
        "The selected formation no longer exists. Reload seating and choose another formation.",
      );
    return formationId;
  }
  if (!canAdd)
    throw new Error("Choose a formation using this Organization’s sections or voice parts.");
  const imported = importedSeatingFormation(source.formation, latest.formations);
  if (!latest.formations.some(({ id }) => id === imported.id)) {
    if (latest.formations.length >= 50)
      throw new Error("This Organization already has 50 formations. Choose an existing formation.");
    onSaved(
      await updateOrganizationSeatingConfiguration({
        ...latest,
        formations: [...latest.formations, imported],
      }),
    );
  }
  return imported.id;
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
  const [mode, setMode] = useState("template");
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [allowEmpty, setAllowEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const templateId = useRef("");
  const readRevision = useRef(0);
  const submitting = useRef(false);
  const source = template?.charts[index];
  const matching = source
    ? matchSeatingTemplate(
        source,
        resources.profiles,
        mode === "chart" ? new Set(eligibleProfiles.map(({ id }) => id)) : undefined,
        resolutions,
      )
    : null;
  const candidatesByName = new Map<string, OrganizationProfile[]>();
  for (const profile of resources.profiles) {
    const key = normalizeSeatingName(profile.displayName);
    const candidates = candidatesByName.get(key) ?? [];
    candidates.push(profile);
    candidatesByName.set(key, candidates);
  }
  const issuesBySeat = new Map(matching?.unresolved.map((issue) => [issue.seatKey, issue.reason]));
  const canAddFormation = canUseFormation(source, resources.roster);
  const unresolvedCount = matching?.unresolved.length ?? 0;
  const canImport = importIsReady({
    name,
    mode,
    formationId,
    unresolvedCount,
    allowEmpty,
    hasMatches: Boolean(matching),
    templateCount: resources.seating.templates?.length ?? 0,
    chartCount: charts.length,
    busy,
  });

  function selectSource(next: SeatingTemplate, nextIndex: number): void {
    const selected = next.charts[nextIndex];
    if (!selected) return;
    templateId.current = crypto.randomUUID();
    setIndex(nextIndex);
    setName(`${selected.name} (imported)`.slice(0, 200));
    setAllowEmpty(false);
    setResolutions({});
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
      if (mode === "template") {
        const saved = await saveTemplate({
          latest,
          id: templateId.current,
          name,
          source,
          formationId,
          assignments: matching.assignments,
        });
        onConfigurationSaved(saved);
        onClose();
        return;
      }
      const targetFormationId = await prepareFormation(
        latest,
        source,
        formationId,
        canAddFormation,
        onConfigurationSaved,
      );
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
    mode,
    setMode,
    resolutions,
    setResolutions,
    template,
    index,
    name,
    formationId,
    allowEmpty,
    busy,
    error,
    source,
    matching,
    candidatesByName,
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

type ImportModel = ReturnType<typeof useSeatingImport>;
function TemplateNameMatches({ model }: { readonly model: ImportModel }) {
  const { source, resolutions, setResolutions, issuesBySeat, candidatesByName, busy } = model;
  if (!source) return null;
  return (
    <div className="form-stack">
      {source.assignments
        .filter(
          ({ seatKey, name }) =>
            (candidatesByName.get(normalizeSeatingName(name))?.length ?? 0) > 0 &&
            (issuesBySeat.has(seatKey) || Boolean(resolutions[seatKey])),
        )
        .map((issue) => {
          const candidates = candidatesByName.get(normalizeSeatingName(issue.name)) ?? [];
          return (
            <label className="field" key={issue.seatKey}>
              Match {issue.name} · seat {issue.seatKey}
              <select
                value={resolutions[issue.seatKey] ?? ""}
                disabled={busy}
                onChange={(event) => {
                  const id = event.target.value;
                  setResolutions((current) => ({ ...current, [issue.seatKey]: id }));
                }}
              >
                <option value="">Keep name for later matching</option>
                {candidates.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.displayName} · {profile.voicePart || "No voice part"} ·{" "}
                    {profile.globalStatus} · {profile.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
    </div>
  );
}
function PerformanceNameIssues({ model }: { readonly model: ImportModel }) {
  const { matching, unresolvedCount, allowEmpty, setAllowEmpty, busy } = model;
  if (!matching || unresolvedCount === 0) return null;
  return (
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
        Resolve names or attendance in the roster to retain those assignments. Importing does not
        change RSVPs or create Profiles.
      </p>
    </>
  );
}
function ImportMatches({ model }: { readonly model: ImportModel }) {
  const { source, matching, unresolvedCount, issuesBySeat, mode } = model;
  if (!source || !matching) return null;
  return (
    <>
      <p role="status">
        {source.rowCounts.length} rows · {source.rowCounts.reduce((sum, count) => sum + count, 0)}{" "}
        seats · {Object.keys(matching.assignments).length} matched assignments · {unresolvedCount}{" "}
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
      {mode === "template" ? (
        <>
          <p className="field-help">
            All singer names and seats are retained, including unresolved names. Active status,
            voice parts, and RSVP Yes are checked when copying into a Performance chart.
          </p>
          <TemplateNameMatches model={model} />
        </>
      ) : (
        <PerformanceNameIssues model={model} />
      )}
    </>
  );
}
function ImportSourceFields({
  model,
  resources,
}: {
  readonly model: ImportModel;
  readonly resources: SeatingResources;
}) {
  const {
    source,
    matching,
    mode,
    template,
    index,
    name,
    setName,
    formationId,
    setFormationId,
    busy,
    selectSource,
    canAddFormation,
  } = model;
  if (!source || !matching) return null;
  return (
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
        {mode === "template" ? "Template name" : "New chart name"}
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
          <option value="">
            {mode === "template" ? "Keep template formation" : "Choose a formation"}
          </option>
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
        {source.formation.strategy === "vertical_column" ? "columns" : "rows"}. Adding it preserves
        existing formations.
      </p>
      {mode === "chart" && !canAddFormation ? (
        <p className="field-help">
          The template uses sections or voice parts absent from this roster. Choose an existing
          formation, or configure those parts before importing.
        </p>
      ) : null}
      <ImportMatches model={model} />
    </>
  );
}
function ImportLimits({ model, props }: { readonly model: ImportModel; readonly props: Props }) {
  const { mode, source, formationId } = model;
  if (mode === "template")
    return (props.resources.seating.templates?.length ?? 0) >= 20 ? (
      <p role="alert">This Organization already has 20 templates.</p>
    ) : null;
  return (
    <>
      {props.charts.length >= 100 ? (
        <p role="alert">This Performance already has 100 charts.</p>
      ) : null}
      {source && !formationId ? (
        <p className="field-help">Choose a formation to enable import.</p>
      ) : null}
    </>
  );
}
export function SeatingImportDialog(props: Props) {
  const model = useSeatingImport(props);
  const { busy, error, template, mode, setMode, setAllowEmpty, readFile, canImport, save } = model;
  return (
    <Dialog
      description={`Save a reusable arrangement with singer names, or create a chart for ${props.performanceName}. Use Copy to apply a saved template to a Performance.`}
      dirty={template !== null}
      onClose={() => {
        if (!busy) props.onClose();
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
        <label className="field">
          Import as
          <select
            disabled={busy}
            value={mode}
            onChange={(event) => {
              setMode(event.target.value);
              setAllowEmpty(false);
            }}
          >
            <option value="template">Reusable template</option>
            <option value="chart">Chart for this Performance</option>
          </select>
        </label>
        <ImportSourceFields model={model} resources={props.resources} />
        <ImportLimits model={model} props={props} />
        {busy ? <p role="status">Preparing seating import…</p> : null}
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
            {mode === "template" ? "Save reusable template" : "Import as new chart"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
