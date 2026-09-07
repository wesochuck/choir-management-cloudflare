import type { Contact, ContactCommunicationStatus, OrganizationProfile } from "@choir/contracts";
import { deriveDisplayName } from "@choir/domain";
import { DataTable, Tabs, TabsContent, TabsList, TabsTrigger, useConfirmation } from "@choir/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addContactsToContactList,
  AuthApiError,
  contactErrorMessage,
  CONTACTS_BULK_OPERATION_MAX,
  createOrganizationContact,
  deleteOrganizationContact,
  getOrganizationContactDetail,
  listAllOrganizationContacts,
  listOrganizationContactLists,
  listOrganizationProfiles,
  queryKeys,
  removeContactsFromContactList,
  updateOrganizationContact,
  type ContactDetail,
} from "../api";
import { buildContactsExportCsv, downloadContactsExport } from "./contactsCsv";
import { ContactDetailDialog } from "./ContactsPageDetail";
import { ContactEditorDialog } from "./ContactsPageEditor";
import { ContactImportDialog } from "./ContactsImportDialog";
import {
  EMPTY_CONTACT_EDITOR_VALUES,
  type ContactEditorInitial,
  type ContactEditorValues,
} from "./contactEditorUtils";
import { ContactsListsTab } from "./ContactsPageLists";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";

type EditorState =
  | { readonly kind: "closed" }
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly contactId: string };

type StatusFilter = "" | ContactCommunicationStatus;

const STATUS_FILTER_OPTIONS: readonly { readonly label: string; readonly value: StatusFilter }[] = [
  { label: "All email statuses", value: "" },
  { label: "Subscribed", value: "subscribed" },
  { label: "Unsubscribed", value: "unsubscribed" },
  { label: "Unknown", value: "unknown" },
];

function parseStatusFilter(value: string): StatusFilter {
  return value === "subscribed" || value === "unsubscribed" || value === "unknown" ? value : "";
}

function statusLabel(status: string): string {
  if (status === "subscribed") return "Subscribed";
  if (status === "unsubscribed") return "Unsubscribed";
  return "Unknown";
}

function phoneLabel(contact: Contact): string {
  if (!contact.phone) return "No phone";
  return contact.phone;
}

function sourceLabel(contact: Contact): string {
  if (!contact.source) return "No source";
  return contact.source;
}

function nullIfBlank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function detailToInitial(detail: ContactDetail): ContactEditorInitial {
  const byChannel = new Map(
    detail.preferences.map((preference) => [preference.channel, preference.status]),
  );
  return {
    displayName: detail.contact.displayName ?? "",
    email: detail.contact.email ?? "",
    emailStatus: byChannel.get("email") ?? "unknown",
    firstName: detail.contact.firstName ?? "",
    lastName: detail.contact.lastName ?? "",
    listIds: [...detail.listIds],
    phone: detail.contact.phone ?? "",
    profileId: detail.contact.profileId ?? "",
    smsStatus: byChannel.get("sms") ?? "unknown",
    source: detail.contact.source ?? "",
  };
}

// eslint-disable-next-line complexity -- the contacts page coordinates filters, selection, bulk actions, editing, and export.
export function ContactsPage({ enabled }: { readonly enabled: boolean }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("contacts");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [listFilter, setListFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [bulkListId, setBulkListId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [editorState, setEditorState] = useState<EditorState>({ kind: "closed" });
  const [viewingContactId, setViewingContactId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(50);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const { confirm, confirmationDialog } = useConfirmation();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchInput);
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput]);

  const filters = useMemo(
    () => ({
      ...(listFilter ? { listId: listFilter } : {}),
      ...(debouncedQuery.trim() ? { query: debouncedQuery.trim() } : {}),
      ...(sourceFilter ? { source: sourceFilter } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    }),
    [debouncedQuery, listFilter, sourceFilter, statusFilter],
  );

  const contactsQuery = useQuery({
    enabled,
    queryFn: ({ signal }) => listAllOrganizationContacts(filters, signal),
    queryKey: queryKeys.organization.contacts(filters),
  });
  const listsQuery = useQuery({
    enabled,
    queryFn: ({ signal }) => listOrganizationContactLists(signal),
    queryKey: queryKeys.organization.contactLists,
  });

  const editorOpen = editorState.kind !== "closed";
  const profilesQuery = useQuery({
    enabled: enabled && editorOpen,
    queryFn: ({ signal }) => listOrganizationProfiles(signal),
    queryKey: queryKeys.organization.contactProfiles,
  });

  const editingContactId = editorState.kind === "edit" ? editorState.contactId : null;
  const detailQuery = useQuery({
    enabled: enabled && editingContactId !== null,
    queryFn: ({ signal }) => getOrganizationContactDetail(editingContactId ?? "", signal),
    queryKey:
      editingContactId === null
        ? queryKeys.organization.contactDetail("none")
        : queryKeys.organization.contactDetail(editingContactId),
  });

  // Phase 10 read-only detail view shares the contact-detail query cache with
  // the editor; opening details never duplicates the underlying request.
  const viewQuery = useQuery({
    enabled: enabled && viewingContactId !== null,
    queryFn: ({ signal }) => getOrganizationContactDetail(viewingContactId ?? "", signal),
    queryKey:
      viewingContactId === null
        ? queryKeys.organization.contactDetail("none")
        : queryKeys.organization.contactDetail(viewingContactId),
  });

  const contacts = useMemo(() => contactsQuery.data?.contacts ?? [], [contactsQuery.data]);
  const memberships = useMemo(() => contactsQuery.data?.memberships ?? [], [contactsQuery.data]);
  const preferences = useMemo(() => contactsQuery.data?.preferences ?? [], [contactsQuery.data]);
  const lists = useMemo(() => listsQuery.data ?? [], [listsQuery.data]);
  const listsById = useMemo(() => new Map(lists.map((list) => [list.id, list])), [lists]);
  const profiles: readonly OrganizationProfile[] = useMemo(
    () => profilesQuery.data ?? [],
    [profilesQuery.data],
  );

  const listNamesByContactId = useMemo(() => {
    const namesByContact = new Map<string, string[]>();
    for (const membership of memberships) {
      const listName = listsById.get(membership.listId)?.name ?? "Unknown list";
      const existing = namesByContact.get(membership.contactId);
      if (existing) {
        existing.push(listName);
      } else {
        namesByContact.set(membership.contactId, [listName]);
      }
    }
    const formatted = new Map<string, string>();
    for (const [contactId, names] of namesByContact) {
      names.sort((left, right) => left.localeCompare(right));
      formatted.set(contactId, names.join(", "));
    }
    return { formatted, raw: namesByContact };
  }, [memberships, listsById]);

  const emailStatusByContactId = useMemo(() => {
    const map = new Map<string, string>();
    for (const pref of preferences) {
      if (pref.channel === "email") {
        map.set(pref.contactId, pref.status);
      }
    }
    return map;
  }, [preferences]);

  const smsStatusByContactId = useMemo(() => {
    const map = new Map<string, string>();
    for (const pref of preferences) {
      if (pref.channel === "sms") {
        map.set(pref.contactId, pref.status);
      }
    }
    return map;
  }, [preferences]);

  const sourceOptions = useMemo(() => {
    const distinct = new Set<string>();
    for (const contact of contacts) {
      if (contact.source?.trim()) distinct.add(contact.source);
    }
    return [...distinct].toSorted((left, right) => left.localeCompare(right));
  }, [contacts]);

  const hasFilters = Boolean(debouncedQuery.trim() || listFilter || statusFilter || sourceFilter);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset page on filter change
    setTablePage(1);
  }, [debouncedQuery, listFilter, sourceFilter, statusFilter]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedVisibleCount = contacts.filter((contact) => selectedIdSet.has(contact.id)).length;
  const allVisibleSelected = contacts.length > 0 && selectedVisibleCount === contacts.length;
  const someVisibleSelected = selectedVisibleCount > 0 && !allVisibleSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const handleImported = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["organization", "contacts"] });
  }, [queryClient]);

  if (!enabled) {
    return <OrganizationMfaPrompt message="Verify Organization MFA to manage contacts." />;
  }

  function invalidateContacts(): Promise<unknown> {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["organization", "contacts"] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.organization.contactLists }),
    ]);
  }

  function clearFilters(): void {
    setSearchInput("");
    setDebouncedQuery("");
    setListFilter("");
    setStatusFilter("");
    setSourceFilter("");
  }

  function toggleSelection(contactId: string, selected: boolean): void {
    setSelectedIds((current) =>
      selected
        ? current.includes(contactId)
          ? current
          : [...current, contactId]
        : current.filter((candidate) => candidate !== contactId),
    );
  }

  function toggleVisibleSelection(visibleIds: readonly string[], selected: boolean): void {
    setSelectedIds((current) =>
      selected
        ? [...new Set([...current, ...visibleIds])]
        : current.filter((candidate) => !visibleIds.includes(candidate)),
    );
  }

  function openCreate(): void {
    setError(null);
    setSuccess(null);
    setEditorError(null);
    setEditorState({ kind: "create" });
  }

  function openEdit(contact: Contact): void {
    setError(null);
    setSuccess(null);
    setEditorError(null);
    setEditorState({ kind: "edit", contactId: contact.id });
  }

  function openDetails(contact: Contact): void {
    setError(null);
    setSuccess(null);
    setViewingContactId(contact.id);
  }

  function closeDetails(): void {
    setViewingContactId(null);
  }

  function closeEditor(): void {
    if (editorBusy) return;
    setEditorState({ kind: "closed" });
    setEditorError(null);
  }

  async function syncMemberships(
    contactId: string,
    baselineListIds: readonly string[],
    nextListIds: readonly string[],
  ): Promise<void> {
    const baseline = new Set(baselineListIds);
    const next = new Set(nextListIds);
    const toAdd = [...next].filter((listId) => !baseline.has(listId));
    const toRemove = [...baseline].filter((listId) => !next.has(listId));
    for (const listId of toAdd) {
      await addContactsToContactList(listId, [contactId]);
    }
    for (const listId of toRemove) {
      await removeContactsFromContactList(listId, [contactId]);
    }
  }

  async function saveContact(values: ContactEditorValues): Promise<void> {
    setEditorBusy(true);
    setEditorError(null);
    try {
      if (editorState.kind === "create") {
        const created = await createOrganizationContact({
          displayName: nullIfBlank(values.displayName),
          email: nullIfBlank(values.email),
          emailStatus: values.emailStatus,
          firstName: nullIfBlank(values.firstName),
          lastName: nullIfBlank(values.lastName),
          phone: nullIfBlank(values.phone),
          profileId: values.profileId ? values.profileId : null,
          smsStatus: values.smsStatus,
          source: nullIfBlank(values.source),
        });
        await syncMemberships(created.id, [], values.listIds);
        setSuccess("Contact created.");
      } else if (editorState.kind === "edit") {
        const baseline = detailQuery.data ? detailToInitial(detailQuery.data) : null;
        await updateOrganizationContact(editorState.contactId, {
          displayName: nullIfBlank(values.displayName),
          email: nullIfBlank(values.email),
          ...(baseline?.emailStatus !== values.emailStatus
            ? { emailStatus: values.emailStatus }
            : {}),
          firstName: nullIfBlank(values.firstName),
          lastName: nullIfBlank(values.lastName),
          phone: nullIfBlank(values.phone),
          profileId: values.profileId ? values.profileId : null,
          ...(baseline?.smsStatus !== values.smsStatus ? { smsStatus: values.smsStatus } : {}),
          source: nullIfBlank(values.source),
        });
        await syncMemberships(editorState.contactId, baseline?.listIds ?? [], values.listIds);
        setSuccess("Contact updated.");
      }
      setEditorState({ kind: "closed" });
      await invalidateContacts();
    } catch (saveError: unknown) {
      setEditorError(contactErrorMessage(saveError, "The contact could not be saved. Try again."));
    } finally {
      setEditorBusy(false);
    }
  }

  async function deleteContact(contact: Contact): Promise<void> {
    const label = deriveDisplayName({
      displayName: contact.displayName,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phone,
    });
    const confirmed = await confirm({
      confirmLabel: "Delete contact",
      description: `Delete ${label || "this contact"}? This permanently removes the contact, its communication preferences, and its list memberships. This action cannot be undone.`,
      destructive: true,
      title: "Delete contact?",
    });
    if (!confirmed) return;
    setError(null);
    try {
      await deleteOrganizationContact(contact.id);
      setSelectedIds((current) => current.filter((candidate) => candidate !== contact.id));
      setSuccess("Contact deleted.");
      await invalidateContacts();
    } catch (deleteError: unknown) {
      setError(contactErrorMessage(deleteError, "The contact could not be deleted."));
    }
  }

  async function runBulk(action: "add" | "remove"): Promise<void> {
    if (selectedIds.length === 0) {
      setError("Select at least one contact for the bulk list action.");
      return;
    }
    if (!bulkListId) {
      setError("Choose a contact list for the bulk action.");
      return;
    }
    if (selectedIds.length > CONTACTS_BULK_OPERATION_MAX) {
      setError(`Select at most ${String(CONTACTS_BULK_OPERATION_MAX)} contacts per bulk action.`);
      return;
    }
    setBulkBusy(true);
    setError(null);
    try {
      const listName = listsById.get(bulkListId)?.name ?? "the list";
      if (action === "add") {
        const result = await addContactsToContactList(bulkListId, selectedIds);
        setSuccess(`Added ${String(result.added)} contact(s) to “${listName}”.`);
      } else {
        const result = await removeContactsFromContactList(bulkListId, selectedIds);
        setSuccess(`Removed ${String(result.removed)} contact(s) from “${listName}”.`);
      }
      await invalidateContacts();
    } catch (bulkError: unknown) {
      setError(
        contactErrorMessage(
          bulkError,
          action === "add"
            ? "Contacts could not be added to the list."
            : "Contacts could not be removed from the list.",
        ),
      );
    } finally {
      setBulkBusy(false);
    }
  }

  function exportCsv(): void {
    setError(null);
    try {
      const exported = buildContactsExportCsv(contacts, (contact) => ({
        emailStatus: emailStatusByContactId.get(contact.id) ?? "unknown",
        listNames: listNamesByContactId.raw.get(contact.id) ?? [],
        smsStatus: smsStatusByContactId.get(contact.id) ?? "unknown",
      }));
      downloadContactsExport(exported);
      setSuccess(
        exported.truncated
          ? `Exported the first ${String(exported.rowCount)} of ${String(contacts.length)} contacts to contacts.csv. Narrow the filters to export the rest.`
          : `Exported ${String(exported.rowCount)} contact(s) to contacts.csv.`,
      );
    } catch (exportError: unknown) {
      setError(
        exportError instanceof AuthApiError
          ? exportError.message
          : "Contacts could not be exported to CSV.",
      );
    }
  }

  const editorInitial: ContactEditorInitial | null =
    editorState.kind === "create"
      ? EMPTY_CONTACT_EDITOR_VALUES
      : editorState.kind === "edit" && detailQuery.data
        ? detailToInitial(detailQuery.data)
        : null;

  return (
    <Tabs onValueChange={setActiveTab} value={activeTab}>
      <TabsList aria-label="Contacts sections" as="nav" className="ticketing-tabs roster-page-tabs">
        <TabsTrigger aria-controls="contacts-panel" id="contacts-tab" value="contacts">
          Contacts
        </TabsTrigger>
        <TabsTrigger aria-controls="contact-lists-panel" id="contact-lists-tab" value="lists">
          Contact lists
        </TabsTrigger>
      </TabsList>
      <TabsContent aria-labelledby="contacts-tab" id="contacts-panel" value="contacts">
        <div className="page-toolbar">
          <div className="page-toolbar__actions">
            <button
              className="button button--secondary"
              onClick={() => {
                setError(null);
                setSuccess(null);
                setImportOpen(true);
              }}
              type="button"
            >
              Import CSV
            </button>
            <button
              className="button button--secondary"
              disabled={contacts.length === 0}
              onClick={exportCsv}
              type="button"
            >
              Export CSV
            </button>
            <button className="button button--primary" onClick={openCreate} type="button">
              Add contact
            </button>
          </div>
        </div>

        {error && !editorOpen ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        {success && !editorOpen ? (
          <p className="notice notice--success" role="status">
            {success}
          </p>
        ) : null}
        {contactsQuery.isPending || listsQuery.isPending ? (
          <p role="status">Loading contacts…</p>
        ) : null}
        {contactsQuery.isError ? (
          <p className="notice notice--error" role="alert">
            Contacts could not be loaded.
          </p>
        ) : null}
        {listsQuery.isError ? (
          <p className="notice notice--error" role="alert">
            Contact lists could not be loaded.
          </p>
        ) : null}

        {contactsQuery.isSuccess && listsQuery.isSuccess ? (
          <>
            {contactsQuery.data.truncated ? (
              <p className="notice notice--info" role="status">
                Showing the first {contacts.length.toLocaleString()} contacts. Narrow your search or
                filter to see more specific results.
              </p>
            ) : null}
            <div className="roster-filter-row">
              <label className="search-field">
                <span className="sr-only">Search contacts</span>
                <input
                  onChange={(event) => {
                    setSearchInput(event.target.value);
                  }}
                  placeholder="Search by name, email, or phone"
                  type="search"
                  value={searchInput}
                />
              </label>
              <label className="field roster-filter-row__status">
                <span className="sr-only">Filter by list</span>
                <select
                  aria-label="Filter by list"
                  onChange={(event) => {
                    setListFilter(event.target.value);
                  }}
                  value={listFilter}
                >
                  <option value="">All lists</option>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field roster-filter-row__status">
                <span className="sr-only">Filter by email status</span>
                <select
                  aria-label="Filter by email status"
                  onChange={(event) => {
                    setStatusFilter(parseStatusFilter(event.target.value));
                  }}
                  value={statusFilter}
                >
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field roster-filter-row__status">
                <span className="sr-only">Filter by source</span>
                <select
                  aria-label="Filter by source"
                  onChange={(event) => {
                    setSourceFilter(event.target.value);
                  }}
                  value={sourceFilter}
                >
                  <option value="">All sources</option>
                  {sourceOptions.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              </label>
              {hasFilters ? (
                <button
                  className="button button--secondary button--control-height"
                  onClick={clearFilters}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
            </div>

            <div className="table-heading">
              <h2>Contacts</h2>
              <span>{contacts.length} shown</span>
            </div>

            {selectedIds.length > 0 ? (
              <div aria-label="Bulk contact actions" className="roster-bulk-actions" role="region">
                <div>
                  <strong>{selectedIds.length} selected</strong>
                  <p>
                    Bulk actions change list membership only. Contacts themselves are preserved.
                  </p>
                </div>
                <div className="roster-bulk-actions__buttons">
                  <select
                    aria-label="Choose a contact list for the bulk action"
                    className="contacts-bulk-select"
                    onChange={(event) => {
                      setBulkListId(event.target.value);
                    }}
                    value={bulkListId}
                  >
                    <option value="">Choose a list…</option>
                    {lists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="button button--secondary button--control-height"
                    disabled={bulkBusy}
                    onClick={() => {
                      void runBulk("add");
                    }}
                    type="button"
                  >
                    {bulkBusy ? "Updating…" : "Add to list"}
                  </button>
                  <button
                    className="button button--secondary button--control-height"
                    disabled={bulkBusy}
                    onClick={() => {
                      void runBulk("remove");
                    }}
                    type="button"
                  >
                    {bulkBusy ? "Updating…" : "Remove from list"}
                  </button>
                </div>
              </div>
            ) : null}

            <DataTable
              columns={[
                {
                  header: "Select",
                  headerContent: (
                    <input
                      aria-label="Select all matching contacts"
                      checked={allVisibleSelected}
                      disabled={contacts.length === 0 || bulkBusy}
                      onChange={(event) => {
                        toggleVisibleSelection(
                          contacts.map((contact) => contact.id),
                          event.target.checked,
                        );
                      }}
                      ref={selectAllRef}
                      type="checkbox"
                    />
                  ),
                  id: "selection",
                  mobileLabel: "Select",
                  render: (contact) => (
                    <input
                      aria-label={`Select ${deriveDisplayName({
                        displayName: contact.displayName,
                        email: contact.email,
                        firstName: contact.firstName,
                        lastName: contact.lastName,
                        phone: contact.phone,
                      })}`}
                      checked={selectedIds.includes(contact.id)}
                      disabled={bulkBusy}
                      onChange={(event) => {
                        toggleSelection(contact.id, event.target.checked);
                      }}
                      type="checkbox"
                    />
                  ),
                },
                {
                  header: "Name",
                  id: "name",
                  render: (contact) => (
                    <strong>
                      {deriveDisplayName({
                        displayName: contact.displayName,
                        email: contact.email,
                        firstName: contact.firstName,
                        lastName: contact.lastName,
                        phone: contact.phone,
                      })}
                    </strong>
                  ),
                  sortValue: (contact) =>
                    deriveDisplayName({
                      displayName: contact.displayName,
                      email: contact.email,
                      firstName: contact.firstName,
                      lastName: contact.lastName,
                      phone: contact.phone,
                    }),
                },
                {
                  header: "Email",
                  id: "email",
                  render: (contact) =>
                    contact.email ? (
                      <a href={`mailto:${contact.email}`}>{contact.email}</a>
                    ) : (
                      "No email"
                    ),
                  sortValue: (contact) => contact.email ?? "",
                },
                {
                  header: "Phone",
                  id: "phone",
                  render: (contact) => phoneLabel(contact),
                  sortValue: (contact) => contact.phone ?? "",
                },
                {
                  header: "Lists",
                  id: "lists",
                  render: (contact) => listNamesByContactId.formatted.get(contact.id) ?? "No lists",
                  sortValue: (contact) =>
                    listNamesByContactId.formatted.get(contact.id) ?? "No lists",
                },
                {
                  header: "Email Status",
                  id: "emailStatus",
                  render: (contact) => (
                    <span className="status-pill">
                      {statusLabel(emailStatusByContactId.get(contact.id) ?? "unknown")}
                    </span>
                  ),
                  sortValue: (contact) =>
                    statusLabel(emailStatusByContactId.get(contact.id) ?? "unknown"),
                },
                {
                  header: "Source",
                  id: "source",
                  render: (contact) => sourceLabel(contact),
                  sortValue: (contact) => contact.source ?? "",
                },
                {
                  header: "Updated",
                  id: "updated",
                  render: (contact) =>
                    new Date(contact.updatedAt).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  sortValue: (contact) => contact.updatedAt,
                },
                {
                  header: "Actions",
                  id: "actions",
                  mobileLabel: "Manage",
                  render: (contact) => (
                    <div className="table-actions">
                      <button
                        aria-label={`View details for ${deriveDisplayName({
                          displayName: contact.displayName,
                          email: contact.email,
                          firstName: contact.firstName,
                          lastName: contact.lastName,
                          phone: contact.phone,
                        })}`}
                        className="button button--secondary button--small"
                        onClick={() => {
                          openDetails(contact);
                        }}
                        type="button"
                      >
                        Details
                      </button>
                      <button
                        aria-label={`Edit ${deriveDisplayName({
                          displayName: contact.displayName,
                          email: contact.email,
                          firstName: contact.firstName,
                          lastName: contact.lastName,
                          phone: contact.phone,
                        })}`}
                        className="button button--secondary button--small"
                        onClick={() => {
                          openEdit(contact);
                        }}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        aria-label={`Delete ${deriveDisplayName({
                          displayName: contact.displayName,
                          email: contact.email,
                          firstName: contact.firstName,
                          lastName: contact.lastName,
                          phone: contact.phone,
                        })}`}
                        className="button button--danger button--small"
                        onClick={() => {
                          void deleteContact(contact);
                        }}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  ),
                },
              ]}
              emptyMessage={hasFilters ? "No contacts match these filters" : "No contacts yet"}
              initialSort={{ columnId: "name", direction: "asc" }}
              keySelector={(contact) => contact.id}
              onRowClick={openEdit}
              pagination={{
                onPageChange: setTablePage,
                onPageSizeChange: (nextSize) => {
                  setTablePageSize(nextSize);
                  setTablePage(1);
                },
                page: tablePage,
                pageSize: tablePageSize,
                pageSizeOptions: [25, 50, 100],
              }}
              rowLabel={(contact) =>
                `Edit contact ${deriveDisplayName({
                  displayName: contact.displayName,
                  email: contact.email,
                  firstName: contact.firstName,
                  lastName: contact.lastName,
                  phone: contact.phone,
                })}`
              }
              rows={contacts}
            />
          </>
        ) : null}
      </TabsContent>
      <TabsContent aria-labelledby="contact-lists-tab" id="contact-lists-panel" value="lists">
        <ContactsListsTab enabled={enabled} />
      </TabsContent>

      {editorOpen && editorInitial ? (
        <ContactEditorDialog
          busy={editorBusy}
          error={editorError}
          initial={editorInitial}
          key={editingContactId ?? "create"}
          lists={lists}
          mode={editorState.kind === "edit" ? "edit" : "create"}
          onClose={closeEditor}
          onSubmit={(values) => {
            void saveContact(values);
          }}
          open
          profiles={profiles}
        />
      ) : null}
      {editorOpen && editorState.kind === "edit" && detailQuery.isPending ? (
        <p role="status">Loading contact…</p>
      ) : null}
      {editorOpen && editorState.kind === "edit" && detailQuery.isError ? (
        <p className="notice notice--error" role="alert">
          The contact could not be loaded.
        </p>
      ) : null}
      {viewingContactId !== null && viewQuery.data ? (
        <ContactDetailDialog
          detail={viewQuery.data}
          key={viewingContactId}
          onClose={closeDetails}
          open
        />
      ) : null}
      {viewingContactId !== null && viewQuery.isPending ? (
        <p role="status">Loading contact details…</p>
      ) : null}
      {viewingContactId !== null && viewQuery.isError ? (
        <p className="notice notice--error" role="alert">
          Contact details could not be loaded.
        </p>
      ) : null}
      {importOpen ? (
        <ContactImportDialog
          lists={lists}
          onClose={() => {
            setImportOpen(false);
          }}
          onImported={handleImported}
          open
        />
      ) : null}
      {confirmationDialog}
    </Tabs>
  );
}
