import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  CommunicationTemplate,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { Dialog, DialogClose, useConfirmation } from "@choir/ui";
import { useEffect, useState } from "react";
import {
  deleteOrganizationCommunicationTemplate,
  listOrganizationCommunicationTemplates,
  saveOrganizationCommunicationTemplate,
  updateOrganizationCommunicationTemplate,
} from "../../../auth/api";
import {
  communicationPlaceholderContext,
  templateMatchesCommunicationContext,
} from "../../communicationPlaceholders";
import { failureMessage } from "./utils";

export function CommunicationSectionPicker({
  configuration,
  onChange,
  value,
}: {
  readonly configuration: OrganizationRosterConfiguration;
  readonly onChange: (sections: readonly string[]) => void;
  readonly value: string;
}) {
  const sections = configuration.sections.filter(({ trackOnly }) => !trackOnly);
  const selected = value
    .split(",")
    .map((section) => section.trim())
    .filter((section) => sections.some(({ code }) => code === section));

  function toggle(sectionCode: string, checked: boolean): void {
    const next = checked
      ? [...new Set([...selected, sectionCode])]
      : selected.filter((code) => code !== sectionCode);
    onChange(next);
  }

  const selectedLabel =
    selected.length === 0
      ? "All sections"
      : selected.length === 1
        ? (sections.find(({ code }) => code === selected[0])?.name ?? selected[0])
        : `${String(selected.length)} sections selected`;

  return (
    <div className="field communication-section-picker-field">
      <span className="field-label">Sections (optional)</span>
      <details className="communication-section-picker">
        <summary>
          <span>Member sections</span>
          <span className="communication-section-picker__summary-value">{selectedLabel}</span>
        </summary>
        <div className="communication-section-picker__panel">
          <p className="field-help">Choose one or more sections. Track-only sections are hidden.</p>
          <div className="checkbox-grid">
            {sections.map((section) => (
              <label className="checkbox-row" key={section.code}>
                <input
                  checked={selected.includes(section.code)}
                  type="checkbox"
                  onChange={(event) => {
                    toggle(section.code, event.target.checked);
                  }}
                />
                {section.name}
              </label>
            ))}
          </div>
          {selected.length > 0 ? (
            <button
              className="button button--secondary"
              onClick={() => {
                onChange([]);
              }}
              type="button"
            >
              Clear sections
            </button>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function isAuditionSystemTemplate(template: CommunicationTemplate): boolean {
  const text = `${template.title}\n${template.subject}\n${template.contentMarkdown}`;
  return template.isSystem && communicationPlaceholderContext(text) === "audition";
}

function isDonationSystemTemplate(template: CommunicationTemplate): boolean {
  if (!template.isSystem) return false;
  const text = `${template.title}\n${template.subject}\n${template.contentMarkdown}`.toLowerCase();
  return /\bdonation\b|\bdonor\b/.test(text);
}

type TemplateChannelFilter = CommunicationChannel | "All";
type TemplateTypeFilter = "all" | "custom" | "system";

function templateChannelFilterFromValue(value: string): TemplateChannelFilter {
  return value === "Email" || value === "SMS" || value === "Both" ? value : "All";
}

function templateTypeFilterFromValue(value: string): TemplateTypeFilter {
  return value === "custom" || value === "system" ? value : "all";
}

function templateMatchesFilters(
  template: CommunicationTemplate,
  search: string,
  channelFilter: TemplateChannelFilter,
  typeFilter: TemplateTypeFilter,
): boolean {
  const searchMatches =
    search.length === 0 ||
    `${template.title}\n${template.subject}\n${template.contentMarkdown}`
      .toLowerCase()
      .includes(search);
  const channelMatches = channelFilter === "All" || template.channel === channelFilter;
  const typeMatches =
    typeFilter === "all" || (typeFilter === "system" ? template.isSystem : !template.isSystem);
  return searchMatches && channelMatches && typeMatches;
}

function TemplateFilters({
  channelFilter,
  onChannelFilterChange,
  onClear,
  onSearchChange,
  onTypeFilterChange,
  search,
  totalCount,
  typeFilter,
  visibleCount,
}: {
  readonly channelFilter: TemplateChannelFilter;
  readonly onChannelFilterChange: (value: TemplateChannelFilter) => void;
  readonly onClear: () => void;
  readonly onSearchChange: (value: string) => void;
  readonly onTypeFilterChange: (value: TemplateTypeFilter) => void;
  readonly search: string;
  readonly totalCount: number;
  readonly typeFilter: TemplateTypeFilter;
  readonly visibleCount: number;
}) {
  const hasFilters = search.trim().length > 0 || channelFilter !== "All" || typeFilter !== "all";
  return (
    <div className="communication-template-filters" aria-label="Template filters">
      <div className="field">
        <label htmlFor="communication-template-search">Search templates</label>
        <input
          id="communication-template-search"
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
          placeholder="Name, subject, or message"
          type="search"
          value={search}
        />
      </div>
      <div className="field">
        <label htmlFor="communication-template-channel-filter">Template channel</label>
        <select
          id="communication-template-channel-filter"
          onChange={(event) => {
            onChannelFilterChange(templateChannelFilterFromValue(event.target.value));
          }}
          value={channelFilter}
        >
          <option value="All">All channels</option>
          <option value="Email">Email</option>
          <option value="SMS">SMS</option>
          <option value="Both">Email &amp; SMS</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="communication-template-type-filter">Template type</label>
        <select
          id="communication-template-type-filter"
          onChange={(event) => {
            onTypeFilterChange(templateTypeFilterFromValue(event.target.value));
          }}
          value={typeFilter}
        >
          <option value="all">All templates</option>
          <option value="custom">Custom templates</option>
          <option value="system">System templates</option>
        </select>
      </div>
      <div className="communication-template-filters__actions">
        <p className="communication-template-filter-summary" role="status">
          Showing {String(visibleCount)} of {String(totalCount)}
          {totalCount === 1 ? " template" : " templates"}
        </p>
        {hasFilters ? (
          <button
            className="button button--secondary button--small"
            onClick={onClear}
            type="button"
          >
            Clear template filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TemplateEditorDialog({
  busy,
  dirty,
  editingContent,
  editingSubject,
  editingTemplate,
  editingTitle,
  error,
  onClose,
  onContentChange,
  onSave,
  onSubjectChange,
  onTitleChange,
}: {
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly editingContent: string;
  readonly editingSubject: string;
  readonly editingTemplate: CommunicationTemplate | null;
  readonly editingTitle: string;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onContentChange: (value: string) => void;
  readonly onSave: () => Promise<void>;
  readonly onSubjectChange: (value: string) => void;
  readonly onTitleChange: (value: string) => void;
}) {
  return (
    <Dialog
      description="Customize the name, subject, and message for this template."
      dirty={dirty}
      onClose={onClose}
      open={editingTemplate !== null}
      title="Edit template wording"
    >
      {editingTemplate ? (
        <form
          className="form-stack communication-template-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave();
          }}
        >
          {error ? (
            <p className="notice notice--error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="field-help communication-template-editor__intro">
            Updating <strong>{editingTemplate.title}</strong> changes what appears when this
            template is used and, for system templates, what future automated messages contain.
          </p>
          <div className="field">
            <label htmlFor="communication-template-edit-title">Template name</label>
            <input
              autoFocus
              id="communication-template-edit-title"
              maxLength={200}
              onChange={(event) => {
                onTitleChange(event.target.value);
              }}
              value={editingTitle}
            />
          </div>
          {editingTemplate.channel !== "SMS" ? (
            <div className="field">
              <label htmlFor="communication-template-edit-subject">Subject</label>
              <input
                id="communication-template-edit-subject"
                maxLength={300}
                onChange={(event) => {
                  onSubjectChange(event.target.value);
                }}
                value={editingSubject}
              />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="communication-template-edit-content">Message</label>
            <textarea
              id="communication-template-edit-content"
              maxLength={100_000}
              onChange={(event) => {
                onContentChange(event.target.value);
              }}
              rows={10}
              value={editingContent}
            />
            <p className="field-help">
              Markdown and the placeholders shown in the composer are supported. System templates
              cannot be deleted, but their wording can be customized for this Organization.
            </p>
            {editingTemplate.title.toLowerCase().includes("audition") ? (
              <p className="field-help">
                Audition templates also support {"{auditionDate}"}, {"{auditionTime}"},{" "}
                {"{auditionDateTime}"}, {"{auditionLocation}"}, and {"{{AUDITION_LINK}}"} when the
                message is sent automatically. Scheduling an applicant sends this link
                automatically; no login is required.
              </p>
            ) : null}
          </div>
          {dirty ? (
            <div
              aria-label="Unsaved template changes"
              className="communication-template-editor-save-bar"
              role="region"
            >
              <span className="communication-template-editor-save-bar__message">
                Unsaved changes
              </span>
              <div className="dialog__actions">
                <DialogClose asChild>
                  <button className="button button--secondary" disabled={busy} type="button">
                    Cancel
                  </button>
                </DialogClose>
                <button
                  className="button button--primary"
                  disabled={busy || !editingTitle.trim() || !editingContent.trim()}
                  type="submit"
                >
                  {busy ? "Saving…" : "Save template"}
                </button>
              </div>
            </div>
          ) : null}
        </form>
      ) : null}
    </Dialog>
  );
}

export function CommunicationTemplatePicker({
  audience,
  channel,
  contentMarkdown,
  onApply,
  subject,
}: {
  readonly audience: CommunicationAudienceRequest;
  readonly channel: CommunicationChannel;
  readonly contentMarkdown: string;
  readonly onApply: (template: CommunicationTemplate) => void;
  readonly subject: string;
}) {
  const [templates, setTemplates] = useState<readonly CommunicationTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmationDialog } = useConfirmation();

  useEffect(() => {
    const controller = new AbortController();
    listOrganizationCommunicationTemplates(controller.signal)
      .then(setTemplates)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(failure));
      });
    return () => {
      controller.abort();
    };
  }, []);

  const visibleTemplates = templates
    .filter((template) => !isAuditionSystemTemplate(template))
    .filter((template) => !isDonationSystemTemplate(template))
    .filter((template) => templateMatchesCommunicationContext(template, audience, channel));
  const selectedTemplateIsAvailable = visibleTemplates.some(
    (template) => template.id === selectedTemplateId,
  );

  function selectTemplate(templateId: string): void {
    if (templateId === "") {
      setSelectedTemplateId("");
      return;
    }
    const template = visibleTemplates.find(({ id }) => id === templateId);
    if (!template) return;
    const replacingExistingDraft =
      selectedTemplateIsAvailable || Boolean(contentMarkdown.trim() || subject.trim());
    if (replacingExistingDraft) {
      void confirm({
        confirmLabel: "Replace draft",
        description: "Your current message draft will be replaced by the selected template.",
        title: "Replace current draft?",
      }).then((shouldApply) => {
        if (!shouldApply) return;
        onApply(template);
        setSelectedTemplateId(template.id);
      });
      return;
    }
    onApply(template);
    setSelectedTemplateId(template.id);
  }

  return (
    <div className="communication-template-picker form-stack">
      <h3>Template</h3>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="communication-template-select">Choose a template (optional)</label>
        <select
          aria-describedby="communication-template-select-help"
          id="communication-template-select"
          onChange={(event) => {
            selectTemplate(event.target.value);
          }}
          value={selectedTemplateIsAvailable ? selectedTemplateId : ""}
        >
          <option value="">No template selected</option>
          {visibleTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.title} · {template.channel}
            </option>
          ))}
        </select>
        <p className="field-help" id="communication-template-select-help">
          Selecting a different template replaces the current message draft. Audition and donation
          receipt templates are managed separately because they are used only by automated messages.
        </p>
      </div>
      {!error && visibleTemplates.length === 0 ? (
        <p className="field-help">No templates match this channel and audience yet.</p>
      ) : null}
      {confirmationDialog}
    </div>
  );
}

export function TemplateLibrary({
  audience,
  channel,
  contentMarkdown,
  subject,
  showAll = false,
}: {
  readonly audience: CommunicationAudienceRequest;
  readonly channel: CommunicationChannel;
  readonly contentMarkdown: string;
  readonly showAll?: boolean;
  readonly subject: string;
}) {
  const [templates, setTemplates] = useState<readonly CommunicationTemplate[]>([]);
  const [title, setTitle] = useState("");
  const [editingTemplate, setEditingTemplate] = useState<CommunicationTemplate | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingSubject, setEditingSubject] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateChannelFilter, setTemplateChannelFilter] = useState<TemplateChannelFilter>("All");
  const [templateTypeFilter, setTemplateTypeFilter] = useState<TemplateTypeFilter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmationDialog } = useConfirmation();

  useEffect(() => {
    const controller = new AbortController();
    listOrganizationCommunicationTemplates(controller.signal)
      .then(setTemplates)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(failure));
      });
    return () => {
      controller.abort();
    };
  }, []);

  const availableTemplates = showAll
    ? templates
    : templates.filter((template) =>
        templateMatchesCommunicationContext(template, audience, channel),
      );
  const normalizedTemplateSearch = templateSearch.trim().toLowerCase();
  const visibleTemplates = availableTemplates.filter((template) =>
    templateMatchesFilters(
      template,
      normalizedTemplateSearch,
      templateChannelFilter,
      templateTypeFilter,
    ),
  );

  function clearTemplateFilters(): void {
    setTemplateSearch("");
    setTemplateChannelFilter("All");
    setTemplateTypeFilter("all");
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveOrganizationCommunicationTemplate({
        channel,
        contentMarkdown,
        subject,
        title,
      });
      setTemplates((current) => [...current, saved].sort((a, b) => a.title.localeCompare(b.title)));
      setTitle("");
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(template: CommunicationTemplate) {
    const shouldDelete = await confirm({
      confirmLabel: "Delete template",
      description: `This will permanently remove the “${template.title}” template.`,
      destructive: true,
      title: "Delete template?",
    });
    if (!shouldDelete) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrganizationCommunicationTemplate(template.id);
      setTemplates((current) => current.filter(({ id }) => id !== template.id));
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(template: CommunicationTemplate): void {
    setEditingTemplate(template);
    setEditingTitle(template.title);
    setEditingSubject(template.subject);
    setEditingContent(template.contentMarkdown);
    setError(null);
  }

  async function saveEdit(): Promise<void> {
    if (!editingTemplate) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateOrganizationCommunicationTemplate(editingTemplate.id, {
        channel: editingTemplate.channel,
        contentMarkdown: editingContent,
        subject: editingSubject,
        title: editingTitle,
      });
      setTemplates((current) =>
        current
          .map((template) => (template.id === updated.id ? updated : template))
          .sort((a, b) => a.title.localeCompare(b.title)),
      );
      setEditingTemplate(null);
    } catch (failure: unknown) {
      setError(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  function closeEdit(): void {
    if (busy) return;
    setEditingTemplate(null);
    setEditingTitle("");
    setEditingSubject("");
    setEditingContent("");
  }

  const editingDirty =
    editingTemplate !== null &&
    (editingTitle !== editingTemplate.title ||
      editingSubject !== editingTemplate.subject ||
      editingContent !== editingTemplate.contentMarkdown);

  return (
    <div className="form-stack" aria-labelledby="communication-templates-heading">
      <h3 id="communication-templates-heading">Templates</h3>
      <p className="communication-template-help">
        Choose <strong>Edit wording</strong> on any template to customize its name, subject, or
        message. System templates power automated messages for this Organization: they can be
        edited, but not deleted.
      </p>
      {error && !editingTemplate ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <TemplateFilters
        channelFilter={templateChannelFilter}
        onChannelFilterChange={setTemplateChannelFilter}
        onClear={clearTemplateFilters}
        onSearchChange={setTemplateSearch}
        onTypeFilterChange={setTemplateTypeFilter}
        search={templateSearch}
        totalCount={availableTemplates.length}
        typeFilter={templateTypeFilter}
        visibleCount={visibleTemplates.length}
      />
      {visibleTemplates.length > 0 ? (
        <ul className="account-list">
          {visibleTemplates.map((template) => (
            <li key={template.id}>
              <div>
                <strong>{template.title}</strong>
                <p>
                  {template.channel}
                  {template.isSystem ? " · System template" : ""}
                </p>
              </div>
              <span className="button-row">
                <button
                  className="button button--secondary"
                  disabled={busy}
                  onClick={() => {
                    startEdit(template);
                  }}
                  type="button"
                >
                  Edit wording
                </button>
                {!template.isSystem ? (
                  <button disabled={busy} onClick={() => void remove(template)} type="button">
                    Delete
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No templates match the current search and filters.</p>
      )}
      <TemplateEditorDialog
        busy={busy}
        dirty={editingDirty}
        editingContent={editingContent}
        editingSubject={editingSubject}
        editingTemplate={editingTemplate}
        editingTitle={editingTitle}
        error={error}
        onClose={closeEdit}
        onContentChange={setEditingContent}
        onSave={saveEdit}
        onSubjectChange={setEditingSubject}
        onTitleChange={setEditingTitle}
      />
      <div className="field">
        <label htmlFor="communication-template-title">Save current message as a template</label>
        <input
          id="communication-template-title"
          maxLength={200}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          value={title}
        />
      </div>
      <button
        disabled={busy || !title.trim() || !contentMarkdown.trim()}
        onClick={() => void save()}
        type="button"
      >
        Save template
      </button>
      {confirmationDialog}
    </div>
  );
}
