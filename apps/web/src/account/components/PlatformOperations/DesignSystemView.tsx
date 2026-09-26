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
  type DataTableColumn,
} from "@choir/ui";

import {
  DESIGN_SYSTEM_COLOR_TOKENS,
  DESIGN_SYSTEM_RADII,
  DESIGN_SYSTEM_SECTIONS,
  DESIGN_SYSTEM_SHADOWS,
  DESIGN_SYSTEM_SPACING,
  DESIGN_SYSTEM_TABLE_ROWS,
  DESIGN_SYSTEM_TYPE_SCALE,
  filterAutocompleteOptions,
  type DesignSystemSection,
  type DesignSystemTableRow,
  type DesignSystemToken,
} from "./designSystemData";

export type { DesignSystemSection, DesignSystemToken };

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
          description="Filled variants use .button with one modifier. Ghost row actions use .text-button. Form actions use .form-actions with alignment modifiers. Inline search rows match --control-height."
          id="ds-buttons"
          title="Buttons & actions"
        />
        <h3>Button variants & rows</h3>
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

        <h3>Inline form action (--control-height)</h3>
        <p className="field-help">
          Buttons paired directly with an input or select in an inline row use
          .button--control-height to match control geometry.
        </p>
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

        <h3>In-form action rows</h3>
        <p className="field-help">
          Generic form action containers use .form-actions with alignment modifiers
          (.form-actions--start, .form-actions--between, .form-actions--end). Specialized surfaces
          (.dialog__actions for sticky dialog footers, .table-actions for data tables) remain
          distinct.
        </p>
        <div className="form-actions form-actions--start">
          <button className="button button--secondary" type="button">
            Start aligned (Secondary)
          </button>
          <button className="button button--primary" type="button">
            Start aligned (Primary)
          </button>
        </div>
        <div className="form-actions form-actions--between">
          <button className="button button--secondary" type="button">
            Space between (Cancel)
          </button>
          <button className="button button--primary" type="button">
            Space between (Continue)
          </button>
        </div>
        <div className="form-actions form-actions--end">
          <button className="button button--secondary" type="button">
            End aligned (Cancel)
          </button>
          <button className="button button--primary" type="button">
            End aligned (Save)
          </button>
        </div>
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
          description="Canonical field anatomy: label row, control, below-control help, and validation messages. Paired controls align in .form-grid and collapse below 40rem."
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
            <label htmlFor="ds-sample-required">Organization name</label>
            <input id="ds-sample-required" placeholder="Harborview Chorus" required type="text" />
          </div>
          <div className="field">
            <label className="field__label-row" htmlFor="ds-sample-optional">
              <span>Alternate contact</span>
              <span className="field-help field-help--inline">(Optional)</span>
            </label>
            <input id="ds-sample-optional" placeholder="e.g. Stage Manager" type="text" />
          </div>
          <div className="field">
            <label htmlFor="ds-sample-help">Public contact email</label>
            <input
              aria-describedby="ds-sample-help-text"
              id="ds-sample-help"
              placeholder="info@example.test"
              type="email"
            />
            <p className="field-help" id="ds-sample-help-text">
              Shown on public event listings and receipt footers.
            </p>
          </div>
          <div className="field">
            <label htmlFor="ds-sample-invalid">Season code</label>
            <input
              aria-describedby="ds-sample-invalid-error"
              aria-invalid="true"
              defaultValue="S2"
              id="ds-sample-invalid"
              type="text"
            />
            <p className="field-error" id="ds-sample-invalid-error" role="alert">
              Enter at least 3 characters.
            </p>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="ds-sample-paired-select">Voice part</label>
              <select defaultValue="soprano" id="ds-sample-paired-select">
                <option value="soprano">Soprano</option>
                <option value="alto">Alto</option>
                <option value="tenor">Tenor</option>
                <option value="bass">Bass</option>
              </select>
            </div>
            <div className="field">
              <label className="field__label-row" htmlFor="ds-sample-paired-input">
                <span>Section note</span>
                <span className="field-help field-help--inline">(Optional)</span>
              </label>
              <input
                aria-describedby="ds-sample-paired-help"
                id="ds-sample-paired-input"
                placeholder="e.g. Section leader"
                type="text"
              />
              <p className="field-help" id="ds-sample-paired-help">
                Visible only to directors and section leaders.
              </p>
            </div>
          </div>
          <div className="field">
            <label htmlFor="ds-sample-notes">Director notes</label>
            <textarea id="ds-sample-notes" placeholder="Warm-ups start at 7pm…" rows={3} />
          </div>
          <div className="design-system__choices form-stack">
            <fieldset className="choice-group">
              <legend>Choice controls: single-line & multi-line</legend>
              <label className="choice-field">
                <input defaultChecked type="checkbox" />
                <span className="choice-field__content">Email reminders before performances</span>
              </label>
              <label className="choice-field">
                <input aria-describedby="ds-choice-desc-help" type="checkbox" />
                <span className="choice-field__content">
                  <span className="choice-field__title">Automatic attendance follow-up</span>
                  <span className="choice-field__description" id="ds-choice-desc-help">
                    Send an automated email reminder to singers with pending RSVPs 48 hours before
                    the rehearsal call time.
                  </span>
                </span>
              </label>
              <label className="choice-field">
                <input disabled type="checkbox" />
                <span className="choice-field__content">
                  <span className="choice-field__title">Archived season syncing (Disabled)</span>
                  <span className="choice-field__description">
                    This option cannot be enabled while the current season is actively performing.
                  </span>
                </span>
              </label>
              <label className="choice-field">
                <input type="checkbox" />
                <span className="choice-field__content">
                  I agree to the volunteer liability waiver, media release policy, and member code
                  of conduct for all published seasonal events.
                </span>
              </label>
            </fieldset>

            <fieldset className="choice-group">
              <legend>Choice controls: radio group</legend>
              <label className="choice-field">
                <input defaultChecked name="ds-intake-mode" type="radio" value="audition" />
                <span className="choice-field__content">
                  <span className="choice-field__title">Audition required</span>
                  <span className="choice-field__description">
                    Prospective members must schedule a time slot with the artistic director.
                  </span>
                </span>
              </label>
              <label className="choice-field">
                <input name="ds-intake-mode" type="radio" value="open" />
                <span className="choice-field__content">
                  <span className="choice-field__title">Open inquiry</span>
                  <span className="choice-field__description">
                    Accept prospective member contact information without scheduling an audition.
                  </span>
                </span>
              </label>
              <label className="choice-field">
                <input disabled name="ds-intake-mode" type="radio" value="closed" />
                <span className="choice-field__content">
                  <span className="choice-field__title">Roster closed (Disabled)</span>
                  <span className="choice-field__description">
                    No new singer inquiries are being accepted at this time.
                  </span>
                </span>
              </label>
            </fieldset>

            <fieldset className="choice-group">
              <legend>Choice controls: large public / touch variant</legend>
              <label className="choice-field choice-field--large">
                <input defaultChecked type="checkbox" />
                <span className="choice-field__content">
                  Hide my name from public donor recognition
                </span>
              </label>
              <label className="choice-field choice-field--large">
                <input type="checkbox" />
                <span className="choice-field__content">
                  I would like to receive email updates about future concert dates and ticket sales
                </span>
              </label>
            </fieldset>
          </div>
          <div className="form-actions form-actions--end">
            <button className="button button--secondary" type="button">
              Reset
            </button>
            <button className="button button--primary" type="submit">
              Save changes
            </button>
          </div>
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
