import type { CommunicationChannel, CommunicationTemplate } from "@choir/contracts";
import { Dialog, DialogClose, useConfirmation } from "@choir/ui";
import { useEffect, useState } from "react";
import {
  deleteOrganizationCommunicationTemplate,
  listOrganizationCommunicationTemplates,
  saveOrganizationCommunicationTemplate,
  updateOrganizationCommunicationTemplate,
} from "../../../auth/api";
import { channelFromValue, failureMessage } from "./utils";

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

export function TemplatesPanel() {
  const [templates, setTemplates] = useState<readonly CommunicationTemplate[]>([]);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<TemplateChannelFilter>("All");
  const [typeFilter, setTypeFilter] = useState<TemplateTypeFilter>("all");

  // Create new template dialog state
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newChannel, setNewChannel] = useState<CommunicationChannel>("Email");
  const [newSubject, setNewSubject] = useState("");
  const [newContent, setNewContent] = useState("");

  // Edit existing template dialog state
  const [editingTemplate, setEditingTemplate] = useState<CommunicationTemplate | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingSubject, setEditingSubject] = useState("");
  const [editingContent, setEditingContent] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { confirm, confirmationDialog } = useConfirmation();

  useEffect(() => {
    const controller = new AbortController();
    listOrganizationCommunicationTemplates(controller.signal)
      .then(setTemplates)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(failureMessage(err));
      });
    return () => {
      controller.abort();
    };
  }, []);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleTemplates = templates.filter((template) =>
    templateMatchesFilters(template, normalizedSearch, channelFilter, typeFilter),
  );

  async function handleCreateTemplate(event: React.SyntheticEvent) {
    event.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await saveOrganizationCommunicationTemplate({
        channel: newChannel,
        contentMarkdown: newContent,
        subject: newSubject,
        title: newTitle.trim(),
      });
      setTemplates((current) =>
        [...current, created].sort((a, b) => a.title.localeCompare(b.title)),
      );
      setIsCreating(false);
      setNewTitle("");
      setNewSubject("");
      setNewContent("");
      setSuccess(`Template "${created.title}" created.`);
    } catch (err: unknown) {
      setError(failureMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(template: CommunicationTemplate) {
    setEditingTemplate(template);
    setEditingTitle(template.title);
    setEditingSubject(template.subject);
    setEditingContent(template.contentMarkdown);
    setError(null);
  }

  async function handleSaveEdit(event: React.SyntheticEvent) {
    event.preventDefault();
    if (!editingTemplate) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateOrganizationCommunicationTemplate(editingTemplate.id, {
        channel: editingTemplate.channel,
        contentMarkdown: editingContent,
        subject: editingSubject,
        title: editingTitle.trim(),
      });
      setTemplates((current) =>
        current
          .map((t) => (t.id === updated.id ? updated : t))
          .sort((a, b) => a.title.localeCompare(b.title)),
      );
      setEditingTemplate(null);
      setSuccess(`Template "${updated.title}" updated.`);
    } catch (err: unknown) {
      setError(failureMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(template: CommunicationTemplate) {
    const ok = await confirm({
      confirmLabel: "Delete template",
      description: `Permanently delete the template "${template.title}"?`,
      destructive: true,
      title: "Delete template",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrganizationCommunicationTemplate(template.id);
      setTemplates((current) => current.filter((t) => t.id !== template.id));
      setSuccess("Template deleted.");
    } catch (err: unknown) {
      setError(failureMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="communication-templates-panel">
      <div className="communication-templates-panel__header">
        <div>
          <h2>Templates</h2>
          <p className="field-help">
            Manage reusable templates for manual and automated communications.
          </p>
        </div>
        <button
          className="button button--primary"
          onClick={() => {
            setIsCreating(true);
          }}
          type="button"
        >
          New template
        </button>
      </div>

      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}

      {/* Filter Row */}
      <div className="communication-template-filters">
        <div className="field">
          <label htmlFor="communication-template-search">Search templates</label>
          <input
            id="communication-template-search"
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Search by title, subject, or message…"
            type="search"
            value={search}
          />
        </div>
        <div className="field">
          <label htmlFor="communication-template-channel-filter">Channel</label>
          <select
            id="communication-template-channel-filter"
            onChange={(e) => {
              setChannelFilter(templateChannelFilterFromValue(e.target.value));
            }}
            value={channelFilter}
          >
            <option value="All">All channels</option>
            <option value="Email">Email</option>
            <option value="SMS">SMS</option>
            <option value="Both">Both (Email &amp; SMS)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="communication-template-type-filter">Type</label>
          <select
            id="communication-template-type-filter"
            onChange={(e) => {
              setTypeFilter(templateTypeFilterFromValue(e.target.value));
            }}
            value={typeFilter}
          >
            <option value="all">All templates</option>
            <option value="custom">Custom templates</option>
            <option value="system">System templates</option>
          </select>
        </div>
      </div>

      {/* Template List */}
      <div className="communication-templates-list">
        {visibleTemplates.length === 0 ? (
          <div className="notice notice--info" role="status">
            <p>No templates match the current filter criteria.</p>
          </div>
        ) : (
          visibleTemplates.map((template) => (
            <article
              aria-label={template.title}
              className="communication-template-card"
              key={template.id}
            >
              <div className="communication-template-card__header">
                <div>
                  <div className="communication-template-card__title-row">
                    <h3>{template.title}</h3>
                    {template.isSystem ? (
                      <span className="status-pill status-pill--automated">System</span>
                    ) : (
                      <span className="status-pill status-pill--custom">Custom</span>
                    )}
                  </div>
                  <p className="communication-template-card__meta">
                    <span>{template.channel}</span>
                    {template.subject ? <span> · Subject: {template.subject}</span> : null}
                  </p>
                </div>
                <div className="communication-template-card__actions">
                  <button
                    className="button button--secondary button--sm"
                    onClick={() => {
                      startEdit(template);
                    }}
                    type="button"
                  >
                    Edit wording
                  </button>
                  {!template.isSystem ? (
                    <button
                      className="button button--danger button--sm"
                      disabled={busy}
                      onClick={() => void handleDelete(template)}
                      type="button"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="communication-template-card__preview">
                <p>
                  {template.contentMarkdown.slice(0, 180)}
                  {template.contentMarkdown.length > 180 ? "…" : ""}
                </p>
              </div>
            </article>
          ))
        )}
      </div>

      {/* Create New Template Dialog */}
      <Dialog
        description="Create a new reusable communication template."
        onClose={() => {
          if (!busy) setIsCreating(false);
        }}
        open={isCreating}
        title="New template"
      >
        <form onSubmit={(e) => void handleCreateTemplate(e)}>
          <div className="field">
            <label htmlFor="new-template-title">Template name</label>
            <input
              id="new-template-title"
              maxLength={200}
              onChange={(e) => {
                setNewTitle(e.target.value);
              }}
              placeholder="e.g. Audition Callback Invitation"
              required
              value={newTitle}
            />
          </div>
          <div className="field">
            <label htmlFor="new-template-channel">Delivery channel</label>
            <select
              id="new-template-channel"
              onChange={(e) => {
                setNewChannel(channelFromValue(e.target.value));
              }}
              value={newChannel}
            >
              <option value="Email">Email</option>
              <option value="SMS">SMS</option>
              <option value="Both">Both (Email &amp; SMS)</option>
            </select>
          </div>
          {newChannel !== "SMS" ? (
            <div className="field">
              <label htmlFor="new-template-subject">Subject</label>
              <input
                id="new-template-subject"
                maxLength={300}
                onChange={(e) => {
                  setNewSubject(e.target.value);
                }}
                placeholder="Template subject…"
                required
                value={newSubject}
              />
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="new-template-content">Message</label>
            <textarea
              id="new-template-content"
              maxLength={100_000}
              onChange={(e) => {
                setNewContent(e.target.value);
              }}
              placeholder="Template message content with placeholders…"
              required
              rows={8}
              value={newContent}
            />
          </div>
          <div className="dialog-actions">
            <DialogClose asChild>
              <button className="button button--secondary" disabled={busy} type="button">
                Cancel
              </button>
            </DialogClose>
            <button
              className="button button--primary"
              disabled={busy || !newTitle.trim() || !newContent.trim()}
              type="submit"
            >
              {busy ? "Saving…" : "Save template"}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Edit Template Dialog */}
      <Dialog
        description="Customize the name, subject, and message for this template."
        onClose={() => {
          if (!busy) setEditingTemplate(null);
        }}
        open={editingTemplate !== null}
        title="Edit template wording"
      >
        {editingTemplate ? (
          <form onSubmit={(e) => void handleSaveEdit(e)}>
            <div className="field">
              <label htmlFor="edit-template-title">Template name</label>
              <input
                id="edit-template-title"
                maxLength={200}
                onChange={(e) => {
                  setEditingTitle(e.target.value);
                }}
                required
                value={editingTitle}
              />
            </div>
            {editingTemplate.channel !== "SMS" ? (
              <div className="field">
                <label htmlFor="edit-template-subject">Subject</label>
                <input
                  id="edit-template-subject"
                  maxLength={300}
                  onChange={(e) => {
                    setEditingSubject(e.target.value);
                  }}
                  value={editingSubject}
                />
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="edit-template-content">Message</label>
              <textarea
                id="edit-template-content"
                maxLength={100_000}
                onChange={(e) => {
                  setEditingContent(e.target.value);
                }}
                required
                rows={8}
                value={editingContent}
              />
            </div>
            <div className="dialog-actions">
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
          </form>
        ) : null}
      </Dialog>

      {confirmationDialog}
    </div>
  );
}
