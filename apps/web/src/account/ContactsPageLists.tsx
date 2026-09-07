import type { Contact, ContactList } from "@choir/contracts";
import { DataTable, Dialog, DialogClose, useConfirmation } from "@choir/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  contactErrorMessage,
  createOrganizationContactList,
  deleteOrganizationContactList,
  listAllOrganizationContacts,
  listOrganizationContactLists,
  queryKeys,
  removeContactsFromContactList,
  updateOrganizationContactList,
  AuthApiError,
} from "../api";
import { OrganizationMfaPrompt } from "./OrganizationMfaPrompt";
import {
  EMPTY_CONTACT_LIST_VALUES,
  validateContactListValues,
  type ContactListFormValues,
} from "./contactListUtils";

function listDescriptionLabel(list: ContactList): string {
  if (!list.description) return "No description";
  return list.description;
}

/** Pure list form fields (no Dialog wrapper) for component-test coverage. */
export function ContactListFields({
  error,
  onChange,
  values,
}: {
  readonly error: string | null;
  readonly onChange: (values: ContactListFormValues) => void;
  readonly values: ContactListFormValues;
}) {
  return (
    <>
      {error ? (
        <p className="notice notice--error" id="contact-list-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="contact-list-name">List name</label>
        <input
          aria-describedby={error ? "contact-list-error" : undefined}
          aria-invalid={Boolean(error)}
          id="contact-list-name"
          maxLength={200}
          onChange={(event) => {
            onChange({ ...values, name: event.target.value });
          }}
          required
          value={values.name}
        />
      </div>
      <div className="field">
        <label htmlFor="contact-list-description">Description</label>
        <textarea
          id="contact-list-description"
          maxLength={2000}
          onChange={(event) => {
            onChange({ ...values, description: event.target.value });
          }}
          rows={3}
          value={values.description}
        />
      </div>
    </>
  );
}

export interface ContactListRow extends ContactList {
  readonly memberCount: number;
}

/** Pure lists table (no dialogs) for component-test coverage. */
export function ContactListsTable({
  onDelete,
  onEdit,
  onViewMembers,
  rows,
}: {
  readonly onDelete: (list: ContactList) => void;
  readonly onEdit: (list: ContactList) => void;
  readonly onViewMembers: (list: ContactList) => void;
  readonly rows: readonly ContactListRow[];
}) {
  return (
    <DataTable
      columns={[
        {
          header: "Name",
          id: "name",
          render: (list) => <strong>{list.name}</strong>,
          sortValue: (list) => list.name,
        },
        {
          header: "Description",
          id: "description",
          render: (list) => listDescriptionLabel(list),
          sortValue: (list) => list.description ?? "",
        },
        {
          header: "Members",
          id: "members",
          render: (list) => String(list.memberCount),
          sortValue: (list) => list.memberCount,
        },
        {
          header: "Updated",
          id: "updated",
          render: (list) =>
            new Date(list.updatedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          sortValue: (list) => list.updatedAt,
        },
        {
          header: "Actions",
          id: "actions",
          mobileLabel: "Manage",
          render: (list) => (
            <div className="table-actions">
              <button
                aria-label={`View members of ${list.name}`}
                className="button button--secondary button--small"
                onClick={() => {
                  onViewMembers(list);
                }}
                type="button"
              >
                View
              </button>
              <button
                aria-label={`Rename ${list.name}`}
                className="button button--secondary button--small"
                onClick={() => {
                  onEdit(list);
                }}
                type="button"
              >
                Edit
              </button>
              <button
                aria-label={`Delete ${list.name}`}
                className="button button--danger button--small"
                onClick={() => {
                  onDelete(list);
                }}
                type="button"
              >
                Delete
              </button>
            </div>
          ),
        },
      ]}
      emptyMessage="No contact lists yet"
      initialSort={{ columnId: "name", direction: "asc" }}
      keySelector={(list) => list.id}
      onRowClick={onViewMembers}
      rowLabel={(list) => `View members of ${list.name}`}
      rows={rows}
    />
  );
}

/** Pure members list (no Dialog wrapper) for component-test coverage. */
export function ContactListMembersList({
  busy,
  members,
  onRemove,
  removingId,
}: {
  readonly busy: boolean;
  readonly members: readonly Contact[];
  readonly onRemove: (contact: Contact) => void;
  readonly removingId: string | null;
}) {
  if (members.length === 0) {
    return <p>No contacts are in this list yet.</p>;
  }
  return (
    <ul className="contacts-member-list">
      {members.map((member) => (
        <li className="contacts-member-row" key={member.id}>
          <span>
            <strong>{member.displayName ?? member.email ?? member.phone ?? "Contact"}</strong>
            {member.email ? <span className="field-help"> · {member.email}</span> : null}
          </span>
          <button
            aria-label={`Remove ${member.displayName ?? member.email ?? "contact"} from list`}
            className="button button--secondary button--small"
            disabled={busy}
            onClick={() => {
              onRemove(member);
            }}
            type="button"
          >
            {removingId === member.id ? "Removing…" : "Remove"}
          </button>
        </li>
      ))}
    </ul>
  );
}

function memberLabel(member: Contact): string {
  return member.displayName ?? member.email ?? member.phone ?? "Contact";
}

// eslint-disable-next-line complexity -- the lists tab coordinates loading, editing, members, and deletion dialogs.
export function ContactsListsTab({ enabled }: { readonly enabled: boolean }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingList, setEditingList] = useState<ContactList | null>(null);
  const [formValues, setFormValues] = useState<ContactListFormValues>(EMPTY_CONTACT_LIST_VALUES);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewingList, setViewingList] = useState<ContactList | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const { confirm, confirmationDialog } = useConfirmation();

  const listsQuery = useQuery({
    enabled,
    queryFn: ({ signal }) => listOrganizationContactLists(signal),
    queryKey: queryKeys.organization.contactLists,
  });
  const allContactsQuery = useQuery({
    enabled,
    queryFn: ({ signal }) => listAllOrganizationContacts({}, signal),
    queryKey: queryKeys.organization.contacts({}),
  });

  const rows: readonly ContactListRow[] = useMemo(() => {
    const lists = listsQuery.data ?? [];
    const membershipCounts = new Map<string, number>();
    for (const membership of allContactsQuery.data?.memberships ?? []) {
      membershipCounts.set(membership.listId, (membershipCounts.get(membership.listId) ?? 0) + 1);
    }
    return lists.map((list) => ({ ...list, memberCount: membershipCounts.get(list.id) ?? 0 }));
  }, [allContactsQuery.data, listsQuery.data]);

  const viewingMembers = useMemo(() => {
    if (!viewingList) return [];
    const contacts = allContactsQuery.data?.contacts ?? [];
    const memberIds = new Set(
      (allContactsQuery.data?.memberships ?? [])
        .filter((membership) => membership.listId === viewingList.id)
        .map((membership) => membership.contactId),
    );
    return contacts.filter((contact) => memberIds.has(contact.id));
  }, [allContactsQuery.data, viewingList]);

  if (!enabled) {
    return <OrganizationMfaPrompt message="Verify Organization MFA to manage contact lists." />;
  }

  function invalidate(): Promise<unknown> {
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.organization.contactLists }),
      queryClient.invalidateQueries({ queryKey: ["organization", "contacts"] }),
    ]);
  }

  function openCreate(): void {
    setError(null);
    setSuccess(null);
    setFormError(null);
    setEditingList(null);
    setFormValues(EMPTY_CONTACT_LIST_VALUES);
    setDialogOpen(true);
  }

  function openEdit(list: ContactList): void {
    setError(null);
    setSuccess(null);
    setFormError(null);
    setEditingList(list);
    setFormValues({ description: list.description ?? "", name: list.name });
    setDialogOpen(true);
  }

  function closeDialog(): void {
    if (busy) return;
    setDialogOpen(false);
    setEditingList(null);
    setFormError(null);
  }

  async function saveList(): Promise<void> {
    const validation = validateContactListValues(formValues);
    if (validation) {
      setFormError(validation);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      if (editingList) {
        await updateOrganizationContactList(editingList.id, {
          description: formValues.description.trim() ? formValues.description.trim() : null,
          name: formValues.name.trim(),
        });
        setSuccess("Contact list updated.");
      } else {
        await createOrganizationContactList({
          description: formValues.description.trim() ? formValues.description.trim() : null,
          name: formValues.name.trim(),
        });
        setSuccess("Contact list created.");
      }
      setDialogOpen(false);
      setEditingList(null);
      await invalidate();
    } catch (saveError: unknown) {
      setFormError(
        contactErrorMessage(
          saveError,
          editingList
            ? "The contact list could not be updated."
            : "The contact list could not be created.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeList(list: ContactList): Promise<void> {
    const confirmed = await confirm({
      confirmLabel: "Delete list",
      description: `Delete “${list.name}”? Contacts in this list are preserved; only the list and its memberships are removed.`,
      destructive: true,
      title: "Delete contact list?",
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await deleteOrganizationContactList(list.id);
      setSuccess("Contact list deleted. Its contacts were preserved.");
      await invalidate();
    } catch (deleteError: unknown) {
      setError(contactErrorMessage(deleteError, "The contact list could not be deleted."));
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(contact: Contact): Promise<void> {
    if (!viewingList) return;
    setRemovingId(contact.id);
    setError(null);
    try {
      await removeContactsFromContactList(viewingList.id, [contact.id]);
      setSuccess(`Removed ${memberLabel(contact)} from “${viewingList.name}”.`);
      await invalidate();
    } catch (removeError: unknown) {
      setError(
        removeError instanceof AuthApiError
          ? removeError.message
          : "The contact could not be removed from the list.",
      );
    } finally {
      setRemovingId(null);
    }
  }

  const baseline = editingList
    ? JSON.stringify({ description: editingList.description ?? "", name: editingList.name })
    : JSON.stringify(EMPTY_CONTACT_LIST_VALUES);
  const dirty = JSON.stringify(formValues) !== baseline;

  return (
    <>
      <div className="page-toolbar page-toolbar--end">
        <button className="button button--primary" onClick={openCreate} type="button">
          Create list
        </button>
      </div>
      {error && !dialogOpen && !viewingList ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      {success && !dialogOpen && !viewingList ? (
        <p className="notice notice--success" role="status">
          {success}
        </p>
      ) : null}
      {listsQuery.isPending || allContactsQuery.isPending ? (
        <p role="status">Loading contact lists…</p>
      ) : null}
      {listsQuery.isError || allContactsQuery.isError ? (
        <p className="notice notice--error" role="alert">
          Contact lists could not be loaded.
        </p>
      ) : null}
      {listsQuery.isSuccess && allContactsQuery.isSuccess ? (
        <>
          <div className="table-heading">
            <h2>Contact lists</h2>
            <span>{rows.length} shown</span>
          </div>
          <ContactListsTable
            onDelete={(list) => {
              void removeList(list);
            }}
            onEdit={openEdit}
            onViewMembers={setViewingList}
            rows={rows}
          />
        </>
      ) : null}

      <Dialog
        description="Group contacts for newsletters, audiences, and community outreach."
        dirty={dirty}
        onClose={closeDialog}
        open={dialogOpen}
        title={editingList ? "Rename contact list" : "Create contact list"}
      >
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void saveList();
          }}
        >
          <ContactListFields error={formError} onChange={setFormValues} values={formValues} />
          <div className="dialog__actions">
            <DialogClose asChild>
              <button className="button button--secondary" disabled={busy} type="button">
                Cancel
              </button>
            </DialogClose>
            <button
              aria-busy={busy}
              className="button button--primary"
              disabled={busy}
              type="submit"
            >
              {busy ? "Saving…" : editingList ? "Save changes" : "Create list"}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        description={
          viewingList
            ? `Contacts belonging to “${viewingList.name}”. Removing a contact keeps the contact itself.`
            : "List members."
        }
        onClose={() => {
          if (!busy && removingId === null) setViewingList(null);
        }}
        open={viewingList !== null}
        title={viewingList ? `Members of ${viewingList.name}` : "List members"}
      >
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
        <ContactListMembersList
          busy={busy || removingId !== null}
          members={viewingMembers}
          onRemove={(contact) => {
            void removeMember(contact);
          }}
          removingId={removingId}
        />
        <div className="dialog__actions">
          <DialogClose asChild>
            <button className="button button--secondary" type="button">
              Close
            </button>
          </DialogClose>
        </div>
      </Dialog>
      {confirmationDialog}
    </>
  );
}
