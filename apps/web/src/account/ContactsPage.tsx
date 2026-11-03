import type { Contact } from "@choir/contracts";
import { deriveDisplayName } from "@choir/domain";
import { DataTable, Tabs, TabsContent, TabsList, TabsTrigger } from "@choir/ui";

import { CONTACTS_BULK_OPERATION_MAX } from "../api";
import {
  useContactsPageController,
  type StatusFilter,
} from "./components/ContactsPage/useContactsPageController";
import { ContactDetailDialog } from "./ContactsPageDetail";
import { ContactEditorDialog } from "./ContactsPageEditor";
import { ContactImportDialog } from "./ContactsImportDialog";
import { ContactsListsTab } from "./ContactsPageLists";
import { InlineContactListCreator } from "./InlineContactListCreator";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";

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

// eslint-disable-next-line complexity -- the contacts page coordinates filters, selection, bulk actions, editing, and export.
export function ContactsPage({ enabled }: { readonly enabled: boolean }) {
  const {
    activeTab,
    allVisibleSelected,
    bulkBusy,
    bulkListId,
    clearFilters,
    closeDetails,
    closeEditor,
    confirmationDialog,
    contacts,
    contactsQuery,
    deleteContact,
    detailQuery,
    editingContactId,
    editorBusy,
    editorError,
    editorInitial,
    editorOpen,
    editorState,
    emailStatusByContactId,
    error,
    expandedContactId,
    exportCsv,
    handleImported,
    handleInlineListCreated,
    hasFilters,
    importOpen,
    listFilter,
    listNamesByContactId,
    lists,
    listsById,
    listsQuery,
    openCreate,
    openDetails,
    openEdit,
    profiles,
    runBulk,
    saveContact,
    searchInput,
    selectAllRef,
    selectedIds,
    setActiveTab,
    setBulkBusy,
    setBulkListId,
    setError,
    setExpandedContactId,
    setImportOpen,
    setListFilter,
    setSearchInput,
    setSourceFilter,
    setStatusFilter,
    setSuccess,
    setTablePage,
    setTablePageSize,
    sourceFilter,
    sourceOptions,
    statusFilter,
    success,
    tablePage,
    tablePageSize,
    toggleSelection,
    toggleVisibleSelection,
    viewQuery,
    viewingContactId,
  } = useContactsPageController({ enabled });

  if (!enabled) {
    return <OrganizationMfaPrompt message="Verify Organization MFA to manage contacts." />;
  }

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
                  <p>
                    {lists.length === 0
                      ? "Create a new list below to add these contacts."
                      : "Choose a contact list to enable Add and Remove."}
                  </p>
                </div>
                <div className="roster-bulk-actions__buttons contacts-bulk-actions">
                  <label className="field">
                    <span>Contact list</span>
                    <select
                      aria-label="Choose a contact list for the bulk action"
                      className="contacts-bulk-select"
                      disabled={bulkBusy || lists.length === 0}
                      onChange={(event) => {
                        setBulkListId(event.target.value);
                      }}
                      value={bulkListId}
                    >
                      <option value="">
                        {lists.length === 0 ? "No contact lists yet" : "Choose a list…"}
                      </option>
                      {lists.map((list) => (
                        <option key={list.id} value={list.id}>
                          {list.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <InlineContactListCreator
                    onBusyChange={setBulkBusy}
                    disabled={bulkBusy || selectedIds.length > CONTACTS_BULK_OPERATION_MAX}
                    onCreated={handleInlineListCreated}
                  />
                  <button
                    className="button button--secondary button--control-height"
                    disabled={bulkBusy || !listsById.has(bulkListId)}
                    onClick={() => {
                      void runBulk("add");
                    }}
                    type="button"
                  >
                    {bulkBusy ? "Updating…" : "Add to list"}
                  </button>
                  <button
                    className="button button--secondary button--control-height"
                    disabled={bulkBusy || !listsById.has(bulkListId)}
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

            <div className="contacts-table">
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
                    className: "contact-table__disclosure",
                    header: "",
                    headerContent: <span className="sr-only">Contact details</span>,
                    id: "disclosure",
                    mobileLabel: "Details",
                    render: (contact, { presentation }) => {
                      const expanded = expandedContactId === contact.id;
                      return (
                        <button
                          aria-controls={
                            expanded ? `contact-details-${contact.id}-${presentation}` : undefined
                          }
                          aria-expanded={expanded}
                          aria-label={`${expanded ? "Hide" : "Show"} details for ${deriveDisplayName(contact)}`}
                          className="contact-table__disclosure-button"
                          onClick={() => {
                            setExpandedContactId((current) =>
                              current === contact.id ? null : contact.id,
                            );
                          }}
                          type="button"
                        >
                          <span aria-hidden="true" className="contact-table__chevron" />
                        </button>
                      );
                    },
                  },
                  {
                    header: "Name",
                    id: "name",
                    className: "contact-table__identity",
                    render: (contact) => (
                      <strong
                        className="contact-table__single-line"
                        title={deriveDisplayName(contact)}
                      >
                        {deriveDisplayName(contact)}
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
                    className: "contact-table__email",
                    render: (contact) =>
                      contact.email ? (
                        <a
                          className="contact-table__single-line"
                          title={contact.email}
                          href={`mailto:${contact.email}`}
                        >
                          {contact.email}
                        </a>
                      ) : (
                        "No email"
                      ),
                    sortValue: (contact) => contact.email ?? "",
                  },
                  {
                    className: "contact-table__phone",
                    header: "Phone",
                    id: "phone",
                    render: (contact) => phoneLabel(contact),
                    sortValue: (contact) => contact.phone ?? "",
                  },
                  {
                    className: "contact-table__status",
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
                    className: "contact-table__actions",
                    header: "Actions",
                    id: "actions",
                    mobileLabel: "Manage",
                    render: (contact) => (
                      <div className="table-actions">
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
                      </div>
                    ),
                  },
                ]}
                emptyMessage={hasFilters ? "No contacts match these filters" : "No contacts yet"}
                initialSort={{ columnId: "name", direction: "asc" }}
                keySelector={(contact) => contact.id}
                expandedRowId={expandedContactId}
                isRowInteractive={(_, context) => context.presentation === "table"}
                onRowClick={(contact) => {
                  setExpandedContactId((current) => (current === contact.id ? null : contact.id));
                }}
                renderExpandedRow={(contact, presentation) => (
                  <div
                    className="contact-details"
                    id={`contact-details-${contact.id}-${presentation}`}
                  >
                    <dl>
                      <dt>Name</dt>
                      <dd>{deriveDisplayName(contact)}</dd>
                    </dl>
                    <dl>
                      <dt>Email</dt>
                      <dd>
                        {contact.email ? (
                          <a href={`mailto:${contact.email}`}>{contact.email}</a>
                        ) : (
                          "No email"
                        )}
                      </dd>
                    </dl>
                    <dl>
                      <dt>Lists</dt>
                      <dd>{listNamesByContactId.formatted.get(contact.id) ?? "No lists"}</dd>
                    </dl>
                    <dl>
                      <dt>Source</dt>
                      <dd>{sourceLabel(contact)}</dd>
                    </dl>
                    <dl>
                      <dt>Updated</dt>
                      <dd>
                        <time dateTime={contact.updatedAt}>
                          {new Date(contact.updatedAt).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </time>
                      </dd>
                    </dl>
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
                  </div>
                )}
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
                  `${expandedContactId === contact.id ? "Hide" : "Show"} details for ${deriveDisplayName(contact)}`
                }
                rows={contacts}
              />
            </div>
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
