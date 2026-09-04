import { useMemo, useState } from "react";

import {
  Autocomplete,
  Collapsible,
  DataTable,
  Dialog,
  DialogClose,
  DropdownMenu,
  Sheet,
  useConfirmation,
  type AutocompleteOption,
  type DataTableColumn,
} from "@choir/ui";

export interface DesignSystemSection {
  readonly href: string;
  readonly id: string;
  readonly label: string;
}

export const DESIGN_SYSTEM_SECTIONS: readonly DesignSystemSection[] = [
  { href: "#ds-foundations", id: "ds-foundations", label: "Foundations" },
  { href: "#ds-buttons", id: "ds-buttons", label: "Buttons & actions" },
  { href: "#ds-notices", id: "ds-notices", label: "Notices & status" },
  { href: "#ds-forms", id: "ds-forms", label: "Forms" },
  { href: "#ds-primitives", id: "ds-primitives", label: "UI primitives" },
  { href: "#ds-patterns", id: "ds-patterns", label: "Patterns" },
];

export interface DesignSystemToken {
  readonly cssVar: string;
  readonly name: string;
}

export const DESIGN_SYSTEM_COLOR_TOKENS: readonly DesignSystemToken[] = [
  { cssVar: "--color-background", name: "Background" },
  { cssVar: "--color-surface", name: "Surface" },
  { cssVar: "--color-surface-raised", name: "Surface raised" },
  { cssVar: "--color-text", name: "Text" },
  { cssVar: "--color-text-muted", name: "Text muted" },
  { cssVar: "--color-primary", name: "Primary" },
  { cssVar: "--color-primary-strong", name: "Primary strong" },
  { cssVar: "--color-primary-foreground", name: "Primary foreground" },
  { cssVar: "--color-accent", name: "Accent" },
  { cssVar: "--color-border", name: "Border" },
  { cssVar: "--color-danger", name: "Danger" },
  { cssVar: "--color-danger-surface", name: "Danger surface" },
  { cssVar: "--color-danger-foreground", name: "Danger foreground" },
  { cssVar: "--color-info-surface", name: "Info surface" },
  { cssVar: "--color-success", name: "Success" },
];

export const DESIGN_SYSTEM_TYPE_SCALE: readonly DesignSystemToken[] = [
  { cssVar: "--font-size-xs", name: "XS" },
  { cssVar: "--font-size-sm", name: "SM" },
  { cssVar: "--font-size-md", name: "MD" },
  { cssVar: "--font-size-base", name: "Base" },
  { cssVar: "--font-size-body", name: "Body" },
  { cssVar: "--font-size-lg", name: "LG" },
  { cssVar: "--font-size-xl", name: "XL" },
  { cssVar: "--font-size-2xl", name: "2XL" },
  { cssVar: "--font-size-section", name: "Section" },
];

export const DESIGN_SYSTEM_RADII: readonly DesignSystemToken[] = [
  { cssVar: "--radius-sm", name: "SM" },
  { cssVar: "--radius-md", name: "MD" },
  { cssVar: "--radius-lg", name: "LG" },
  { cssVar: "--radius-xl", name: "XL" },
  { cssVar: "--radius-control", name: "Control" },
  { cssVar: "--radius-card", name: "Card" },
];

export const DESIGN_SYSTEM_SHADOWS: readonly DesignSystemToken[] = [
  { cssVar: "--shadow-sm", name: "SM" },
  { cssVar: "--shadow-md", name: "MD" },
  { cssVar: "--shadow-lg", name: "LG" },
  { cssVar: "--shadow-xl", name: "XL" },
];

export const DESIGN_SYSTEM_SPACING: readonly DesignSystemToken[] = [
  { cssVar: "--spacing-3xs", name: "3XS" },
  { cssVar: "--spacing-2xs", name: "2XS" },
  { cssVar: "--spacing-xs", name: "XS" },
  { cssVar: "--spacing-sm", name: "SM" },
  { cssVar: "--spacing-md", name: "MD" },
  { cssVar: "--spacing-lg", name: "LG" },
  { cssVar: "--spacing-xl", name: "XL" },
  { cssVar: "--spacing-2xl", name: "2XL" },
];

interface DesignSystemTableRow {
  readonly id: string;
  readonly name: string;
  readonly part: string;
  readonly status: string;
}

const DESIGN_SYSTEM_TABLE_ROWS: readonly DesignSystemTableRow[] = [
  { id: "ds-alto", name: "Ava Alto", part: "Alto", status: "Active" },
  { id: "ds-bass", name: "Ben Bass", part: "Bass", status: "Active" },
  { id: "ds-break", name: "Bo Break", part: "Tenor", status: "On Break" },
  { id: "ds-soprano", name: "Sue Soprano", part: "Soprano", status: "Active" },
  { id: "ds-tenor", name: "Tom Tenor", part: "Tenor", status: "Pending" },
  { id: "ds-pending", name: "Pam Pending", part: "Alto", status: "Pending" },
];

const AUTOCOMPLETE_SOURCE: readonly AutocompleteOption[] = [
  { id: "soprano", label: "Soprano" },
  { id: "alto", label: "Alto" },
  { id: "tenor", label: "Tenor" },
  { id: "bass", label: "Bass" },
  { id: "director", label: "Director" },
  { id: "accompanist", label: "Accompanist" },
];

export function filterAutocompleteOptions(
  query: string,
  source: readonly AutocompleteOption[] = AUTOCOMPLETE_SOURCE,
): readonly AutocompleteOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return source;
  return source.filter((option) => option.label.toLowerCase().includes(normalized));
}

async function copyTokenVar(cssVar: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(`var(${cssVar})`);
    return true;
  } catch {
    return false;
  }
}

function DesignSystemSectionHeading({
  description,
  id,
  title,
}: {
  readonly description: string;
  readonly id: string;
  readonly title: string;
}) {
  return (
    <div className="section-heading section-heading--compact">
      <h2 id={id}>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export function DesignSystemView() {
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogDraft, setDialogDraft] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [collapsibleOpen, setCollapsibleOpen] = useState(false);
  const [dropdownMessage, setDropdownMessage] = useState("Choose a menu action.");
  const [autocompleteValue, setAutocompleteValue] = useState("");
  const [autocompleteSelected, setAutocompleteSelected] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const [tableAction, setTableAction] = useState("Select View on any table row.");
  const { confirm, confirmationDialog } = useConfirmation();
  const [confirmMessage, setConfirmMessage] = useState("No confirmation requested yet.");

  const autocompleteOptions = useMemo(
    () => filterAutocompleteOptions(autocompleteValue),
    [autocompleteValue],
  );

  const tableColumns = useMemo<readonly DataTableColumn<DesignSystemTableRow>[]>(
    () => [
      {
        header: "Name",
        id: "name",
        render: (row) => row.name,
        sortValue: (row) => row.name,
      },
      {
        header: "Voice part",
        id: "part",
        render: (row) => row.part,
        sortValue: (row) => row.part,
      },
      {
        header: "Status",
        id: "status",
        render: (row) => row.status,
        sortValue: (row) => row.status,
      },
      {
        header: "Actions",
        id: "actions",
        render: (row) => (
          <button
            className="text-button"
            onClick={() => {
              setTableAction(`Viewing ${row.name}.`);
            }}
            type="button"
          >
            View
          </button>
        ),
      },
    ],
    [],
  );

  function handleCopy(cssVar: string): void {
    void copyTokenVar(cssVar).then((copied) => {
      setCopiedToken(copied ? cssVar : null);
    });
  }

  async function handleDestructiveConfirm(): Promise<void> {
    const confirmed = await confirm({
      confirmLabel: "Archive sample",
      description: "This design-system sample can be restored by reloading the page.",
      destructive: true,
      title: "Archive design-system sample?",
    });
    setConfirmMessage(confirmed ? "Sample archived." : "Archive cancelled.");
  }

  const dialogDirty = dialogDraft.trim().length > 0;

  return (
    <div className="design-system">
      <div className="page-heading">
        <h1>Design system</h1>
        <p className="page-heading__description">
          Live reference for the tokens, buttons, notices, forms, repository-owned primitives, and
          workspace patterns used throughout the app. Examples below use the same classes and
          components as production views and follow the active light or dark theme.
        </p>
      </div>

      <nav aria-label="Design system sections" className="design-system__anchor-nav">
        {DESIGN_SYSTEM_SECTIONS.map((section) => (
          <a key={section.id} href={section.href}>
            {section.label}
          </a>
        ))}
      </nav>

      <section aria-labelledby="ds-foundations" className="surface-card design-system__section">
        <DesignSystemSectionHeading
          description="Colors, type, radii, shadows, and spacing resolve to the same CSS custom properties in both themes. Select a swatch to copy its var() reference."
          id="ds-foundations"
          title="Foundations"
        />
        <h3>Color</h3>
        <ul className="design-system__swatches">
          {DESIGN_SYSTEM_COLOR_TOKENS.map((token) => (
            <li key={token.cssVar} className="design-system__swatch">
              <button
                aria-label={`Copy ${token.cssVar}`}
                className="design-system__swatch-chip"
                onClick={() => {
                  handleCopy(token.cssVar);
                }}
                style={{ backgroundColor: `var(${token.cssVar})` }}
                type="button"
              />
              <strong>{token.name}</strong>
              <code>{`var(${token.cssVar})`}</code>
              {copiedToken === token.cssVar ? (
                <span className="design-system__copied" role="status">
                  Copied
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        <h3>Typography</h3>
        <ul className="design-system__type-list">
          {DESIGN_SYSTEM_TYPE_SCALE.map((token) => (
            <li key={token.cssVar}>
              <p style={{ fontSize: `var(${token.cssVar})` }}>Agile voices keep time together</p>
              <code>
                {token.name} · var({token.cssVar})
              </code>
            </li>
          ))}
        </ul>

        <div className="design-system__token-grid">
          <div>
            <h3>Radii</h3>
            <ul className="design-system__swatches">
              {DESIGN_SYSTEM_RADII.map((token) => (
                <li key={token.cssVar} className="design-system__swatch">
                  <span
                    aria-hidden="true"
                    className="design-system__radius-chip"
                    style={{ borderRadius: `var(${token.cssVar})` }}
                  />
                  <code>var({token.cssVar})</code>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Shadows</h3>
            <ul className="design-system__swatches">
              {DESIGN_SYSTEM_SHADOWS.map((token) => (
                <li key={token.cssVar} className="design-system__swatch">
                  <span
                    aria-hidden="true"
                    className="design-system__shadow-chip"
                    style={{ boxShadow: `var(${token.cssVar})` }}
                  />
                  <code>var({token.cssVar})</code>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Spacing</h3>
            <ul className="design-system__spacing-list">
              {DESIGN_SYSTEM_SPACING.map((token) => (
                <li key={token.cssVar}>
                  <span
                    aria-hidden="true"
                    className="design-system__spacing-bar"
                    style={{ width: `var(${token.cssVar})` }}
                  />
                  <code>
                    {token.name} · var({token.cssVar})
                  </code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="ds-buttons" className="surface-card design-system__section">
        <DesignSystemSectionHeading
          description="Filled variants use .button with one modifier. Ghost row actions use .text-button. Inline search rows match --control-height."
          id="ds-buttons"
          title="Buttons & actions"
        />
        <div className="button-row">
          <button className="button button--primary" type="button">
            Primary
          </button>
          <button className="button button--secondary" type="button">
            Secondary
          </button>
          <button className="button button--danger" type="button">
            Danger
          </button>
          <button className="button button--primary" disabled type="button">
            Disabled
          </button>
        </div>
        <div className="button-row">
          <button className="text-button" type="button">
            Ghost action
          </button>
          <button className="text-button text-button--danger" type="button">
            Ghost danger
          </button>
        </div>
        <form
          className="design-system__inline-row"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <label className="sr-only" htmlFor="ds-inline-search">
            Sample inline search
          </label>
          <input id="ds-inline-search" placeholder="Search the library…" type="search" />
          <button className="button button--primary button--control-height" type="submit">
            Search
          </button>
        </form>
      </section>

      <section aria-labelledby="ds-notices" className="surface-card design-system__section">
        <DesignSystemSectionHeading
          description="Notices use .notice with exactly one severity modifier."
          id="ds-notices"
          title="Notices & status"
        />
        <p className="notice notice--info" role="status">
          Info: rehearsal tracks finished processing.
        </p>
        <p className="notice notice--success" role="status">
          Success: invitations were queued for delivery.
        </p>
        <p className="notice notice--warning" role="status">
          Warning: two events still need venues.
        </p>
        <p className="notice notice--error" role="alert">
          Error: the export could not be generated. Try again.
        </p>
      </section>

      <section aria-labelledby="ds-forms" className="surface-card design-system__section">
        <DesignSystemSectionHeading
          description="Operational forms use .form-stack with .field wrappers and the shared control geometry."
          id="ds-forms"
          title="Forms"
        />
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <div className="field">
            <label htmlFor="ds-sample-name">Organization name</label>
            <input id="ds-sample-name" placeholder="Harborview Chorus" type="text" />
            <p className="field-help">Shown on the public website and receipts.</p>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="ds-sample-voice">Voice part</label>
              <select id="ds-sample-voice">
                <option value="soprano">Soprano</option>
                <option value="alto">Alto</option>
                <option value="tenor">Tenor</option>
                <option value="bass">Bass</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="ds-sample-notes">Director notes</label>
              <textarea id="ds-sample-notes" placeholder="Warm-ups start at 7pm…" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ds-sample-invalid">Season code</label>
            <input aria-describedby="ds-sample-invalid-error" id="ds-sample-invalid" type="text" />
            <p className="notice notice--error" id="ds-sample-invalid-error" role="alert">
              Enter at least 3 characters.
            </p>
          </div>
          <fieldset className="design-system__choices">
            <legend>Notifications</legend>
            <label>
              <input defaultChecked type="checkbox" /> Email reminders
            </label>
            <label>
              <input name="ds-contact" type="radio" /> Email
            </label>
            <label>
              <input name="ds-contact" type="radio" /> SMS
            </label>
          </fieldset>
        </form>
      </section>

      <section aria-labelledby="ds-primitives" className="surface-card design-system__section">
        <DesignSystemSectionHeading
          description="Repository-owned primitives from @choir/ui. All demos are interactive."
          id="ds-primitives"
          title="UI primitives"
        />

        <h3>Dialog</h3>
        <p>Dialog owns dirty tracking. Cancel, Escape, backdrop, and header close all confirm.</p>
        <div className="button-row">
          <button
            className="button button--secondary"
            onClick={() => {
              setDialogOpen(true);
            }}
            type="button"
          >
            Open dialog
          </button>
        </div>
        <Dialog
          description="Type below, then try Cancel, Escape, or the header close control."
          dirty={dialogDirty}
          onClose={() => {
            setDialogOpen(false);
          }}
          open={dialogOpen}
          title="Sample dialog"
        >
          <div className="form-stack">
            <div className="field">
              <label htmlFor="ds-dialog-input">Sample edit</label>
              <input
                id="ds-dialog-input"
                onChange={(event) => {
                  setDialogDraft(event.target.value);
                }}
                placeholder="Make this dirty…"
                value={dialogDraft}
              />
            </div>
            <div className="dialog__actions">
              <DialogClose asChild>
                <button className="button button--secondary" type="button">
                  Cancel
                </button>
              </DialogClose>
              <button
                className="button button--primary"
                onClick={() => {
                  setDialogOpen(false);
                }}
                type="button"
              >
                Save sample
              </button>
            </div>
          </div>
        </Dialog>

        <h3>Confirmation</h3>
        <p role="status">{confirmMessage}</p>
        <div className="button-row">
          <button
            className="button button--danger"
            onClick={() => {
              void handleDestructiveConfirm();
            }}
            type="button"
          >
            Request destructive confirmation
          </button>
        </div>
        {confirmationDialog}

        <h3>Data table</h3>
        <p role="status">{tableAction}</p>
        <DataTable
          columns={tableColumns}
          keySelector={(row) => row.id}
          pagination={{ onPageChange: setTablePage, page: tablePage, pageSize: 4 }}
          rows={DESIGN_SYSTEM_TABLE_ROWS}
        />

        <h3>Dropdown menu</h3>
        <p role="status">{dropdownMessage}</p>
        <DropdownMenu
          accessibleLabel="Sample row actions"
          items={[
            {
              label: "Edit sample",
              onSelect: () => {
                setDropdownMessage("Edit sample selected.");
              },
            },
            {
              label: "Duplicate sample",
              onSelect: () => {
                setDropdownMessage("Duplicate sample selected.");
              },
            },
            {
              disabled: true,
              label: "Archive sample (disabled)",
              onSelect: () => {
                setDropdownMessage("Archive sample selected.");
              },
            },
          ]}
          trigger={
            <button className="button button--secondary" type="button">
              Open menu
            </button>
          }
        />

        <h3>Autocomplete</h3>
        <div className="field">
          <label htmlFor="ds-autocomplete">Voice part</label>
          <Autocomplete
            ariaLabel="Voice part"
            id="ds-autocomplete"
            onSelect={(option) => {
              setAutocompleteSelected(option.label);
              setAutocompleteValue(option.label);
            }}
            onValueChange={(value) => {
              setAutocompleteValue(value);
              setAutocompleteSelected(null);
            }}
            options={autocompleteOptions}
            placeholder="Start typing…"
            value={autocompleteValue}
          />
          <p className="field-help" role="status">
            {autocompleteSelected ? `Selected: ${autocompleteSelected}` : "No selection yet."}
          </p>
        </div>

        <h3>Sheet & collapsible</h3>
        <div className="button-row">
          <button
            className="button button--secondary"
            onClick={() => {
              setSheetOpen(true);
            }}
            type="button"
          >
            Open sheet
          </button>
        </div>
        <Sheet
          onClose={() => {
            setSheetOpen(false);
          }}
          open={sheetOpen}
          title="Sample sheet"
        >
          <div className="sheet__header">
            <h2>Sample navigation sheet</h2>
            <p>Focus returns to the trigger on close.</p>
          </div>
        </Sheet>
        <Collapsible
          label="Sample details"
          onOpenChange={setCollapsibleOpen}
          open={collapsibleOpen}
        >
          <p>Hidden guidance appears here when the trigger is expanded.</p>
        </Collapsible>
      </section>

      <section aria-labelledby="ds-patterns" className="surface-card design-system__section">
        <DesignSystemSectionHeading
          description="Workspace composition uses section headings, cards, and empty states."
          id="ds-patterns"
          title="Patterns"
        />
        <div className="workspace-card-grid">
          <div className="workspace-card">
            <strong>Start with what matters</strong>
            <small>Cards pair a short title with one line of guidance.</small>
          </div>
          <div className="workspace-card">
            <strong>Keep hierarchy flat</strong>
            <small>One primary action per card keeps scanning calm.</small>
          </div>
        </div>
        <p className="empty-state">No results — showcase empty states with one recovery action.</p>
      </section>
    </div>
  );
}
