import type {
  Contact,
  ContactCommunicationPreference,
  ContactCommunicationStatus,
  ContactList,
  ContactListMembership,
  OrganizationProfile,
} from "@choir/contracts";
import { deriveDisplayName } from "@choir/domain";
import { useConfirmation } from "@choir/ui";
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
  type ContactsListResult,
} from "../../../api";
import {
  EMPTY_CONTACT_EDITOR_VALUES,
  type ContactEditorInitial,
  type ContactEditorValues,
} from "../../contactEditorUtils";
import { buildContactsExportCsv, downloadContactsExport } from "../../contactsCsv";

type EditorState =
  | { readonly kind: "closed" }
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly contactId: string };

export type StatusFilter = "" | ContactCommunicationStatus;

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

export function useContactsPageController({ enabled }: { readonly enabled: boolean }) {
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
  const [expandedContactId, setExpandedContactId] = useState<string | null>(null);
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
    void queryClient.invalidateQueries({
      queryKey: ["organization", "contacts"],
      refetchType: "active",
    });
  }, [queryClient]);

  function invalidateContacts(): Promise<unknown> {
    return Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["organization", "contacts"],
        refetchType: "active",
      }),
      queryClient.invalidateQueries({
        queryKey: queryKeys.organization.contactLists,
        refetchType: "active",
      }),
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
        queryClient.setQueriesData<ContactsListResult>(
          { queryKey: ["organization", "contacts", "list"] },
          (current) => {
            if (!current) return current;
            if (current.contacts.some((candidate) => candidate.id === created.id)) return current;
            const newMemberships: ContactListMembership[] = values.listIds.map((listId) => ({
              contactId: created.id,
              createdAt: created.createdAt,
              listId,
            }));
            const newPrefs: ContactCommunicationPreference[] = [
              {
                channel: "email",
                contactId: created.id,
                observedAt: created.createdAt,
                source: null,
                status: values.emailStatus,
              },
              {
                channel: "sms",
                contactId: created.id,
                observedAt: created.createdAt,
                source: null,
                status: values.smsStatus,
              },
            ];
            return {
              ...current,
              contacts: [created, ...current.contacts],
              memberships: [...current.memberships, ...newMemberships],
              preferences: [...current.preferences, ...newPrefs],
            };
          },
        );
      } else if (editorState.kind === "edit") {
        const baseline = detailQuery.data ? detailToInitial(detailQuery.data) : null;
        const updated = await updateOrganizationContact(editorState.contactId, {
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
        queryClient.setQueriesData<ContactsListResult>(
          { queryKey: ["organization", "contacts", "list"] },
          (current) => {
            if (!current) return current;
            return {
              ...current,
              contacts: current.contacts.map((candidate) =>
                candidate.id === updated.id ? updated : candidate,
              ),
            };
          },
        );
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
      queryClient.setQueriesData<ContactsListResult>(
        { queryKey: ["organization", "contacts", "list"] },
        (current) => {
          if (!current) return current;
          return {
            ...current,
            contacts: current.contacts.filter((candidate) => candidate.id !== contact.id),
            memberships: current.memberships.filter((m) => m.contactId !== contact.id),
            preferences: current.preferences.filter((p) => p.contactId !== contact.id),
          };
        },
      );
      await invalidateContacts();
    } catch (deleteError: unknown) {
      setError(contactErrorMessage(deleteError, "The contact could not be deleted."));
      await invalidateContacts();
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

  async function handleInlineListCreated(list: ContactList): Promise<void> {
    queryClient.setQueryData<readonly ContactList[]>(
      queryKeys.organization.contactLists,
      (current) => [...(current ?? []).filter(({ id }) => id !== list.id), list],
    );
    setBulkListId(list.id);
    setError(null);
    setSuccess(null);
    setBulkBusy(true);
    try {
      const result = await addContactsToContactList(list.id, selectedIds);
      setSuccess(`Created “${list.name}” and added ${String(result.added)} contact(s).`);
      await invalidateContacts();
    } catch (cause: unknown) {
      setError(
        `“${list.name}” was created, but the contacts could not be added. ${contactErrorMessage(cause, "Please try again.")} Use Add to list to retry.`,
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

  return {
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
  };
}
