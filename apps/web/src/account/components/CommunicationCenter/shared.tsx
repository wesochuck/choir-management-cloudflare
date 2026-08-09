import type {
  CommunicationAudienceRequest,
  CommunicationChannel,
  CommunicationTemplate,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { useConfirmation } from "@choir/ui";
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

  const visibleTemplates = showAll
    ? templates
    : templates.filter((template) =>
        templateMatchesCommunicationContext(template, audience, channel),
      );

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

  return (
    <div className="form-stack" aria-labelledby="communication-templates-heading">
      <h3 id="communication-templates-heading">Templates</h3>
      <p className="communication-template-help">
        Choose <strong>Edit wording</strong> on any template to customize its name, subject, or
        message. System templates power automated messages for this Organization: they can be
        edited, but not deleted.
      </p>
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
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
        <p>No templates match this channel and audience yet.</p>
      )}
      {editingTemplate ? (
        <fieldset className="form-stack communication-template-editor">
          <legend>Edit template wording</legend>
          <p className="field-help communication-template-editor__intro">
            Updating <strong>{editingTemplate.title}</strong> changes what appears when this
            template is used and, for system templates, what future automated messages contain.
          </p>
          <div className="field">
            <label htmlFor="communication-template-edit-title">Template name</label>
            <input
              id="communication-template-edit-title"
              maxLength={200}
              onChange={(event) => {
                setEditingTitle(event.target.value);
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
                  setEditingSubject(event.target.value);
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
                setEditingContent(event.target.value);
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
          <div className="form-actions">
            <button
              disabled={busy}
              onClick={() => {
                setEditingTemplate(null);
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button--primary"
              disabled={busy || !editingTitle.trim() || !editingContent.trim()}
              onClick={() => void saveEdit()}
              type="button"
            >
              {busy ? "Saving…" : "Save template"}
            </button>
          </div>
        </fieldset>
      ) : null}
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
