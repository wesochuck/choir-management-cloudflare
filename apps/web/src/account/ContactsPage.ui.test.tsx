import { contactSchema, type Contact } from "@choir/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { ContactsPage } from "./ContactsPage";

const contact1 = contactSchema.parse({
  createdAt: "2026-08-01T00:00:00.000Z",
  displayName: "Alice Allison",
  email: "alice@example.com",
  firstName: "Alice",
  id: "11111111-1111-4111-8111-111111111111",
  lastName: "Allison",
  normalizedEmail: "alice@example.com",
  normalizedPhone: null,
  phone: null,
  profileId: null,
  source: "Web",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

describe("ContactsPage list synchronization (#168)", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: Infinity,
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates list count and rows immediately after creating a contact without manual reload", async () => {
    let contactsList: Contact[] = [];

    vi.spyOn(api, "listAllOrganizationContacts").mockImplementation(() =>
      Promise.resolve({
        contacts: contactsList,
        memberships: [],
        preferences: [],
      }),
    );
    vi.spyOn(api, "listOrganizationContactLists").mockResolvedValue([]);
    vi.spyOn(api, "listOrganizationProfiles").mockResolvedValue([]);
    vi.spyOn(api, "createOrganizationContact").mockImplementation((input) => {
      const created = contactSchema.parse({
        createdAt: "2026-08-01T00:00:00.000Z",
        displayName: input.displayName ?? null,
        email: input.email ?? null,
        firstName: input.firstName ?? null,
        id: "22222222-2222-4222-8222-222222222222",
        lastName: input.lastName ?? null,
        normalizedEmail: input.email?.toLowerCase() ?? null,
        normalizedPhone: null,
        phone: input.phone ?? null,
        profileId: null,
        source: input.source ?? null,
        updatedAt: "2026-08-01T00:00:00.000Z",
      });
      contactsList = [created];
      return Promise.resolve(created);
    });

    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <ContactsPage enabled />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("0 shown")).toBeInTheDocument();
    expect(screen.getByText("No contacts yet")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add contact" }));
    expect(await screen.findByRole("dialog", { name: "Add contact" })).toBeInTheDocument();

    const firstNameInput = screen.getByLabelText("First name");
    await user.type(firstNameInput, "Alice");
    const lastNameInput = screen.getByLabelText("Last name");
    await user.type(lastNameInput, "Allison");
    const emailInput = screen.getByLabelText("Email");
    await user.type(emailInput, "alice@example.com");

    await user.click(screen.getByRole("button", { name: "Create contact" }));

    // Verify contact dialog closes and row + count appear immediately
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Contact created.")).toBeInTheDocument();
    expect(screen.getByText("1 shown")).toBeInTheDocument();
    expect(screen.getAllByText("Alice Allison").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("No contacts yet")).not.toBeInTheDocument();
  });

  it("updates list count and removes row immediately after deleting a contact without manual reload", async () => {
    let contactsList: Contact[] = [contact1];

    vi.spyOn(api, "listAllOrganizationContacts").mockImplementation(() =>
      Promise.resolve({
        contacts: contactsList,
        memberships: [],
        preferences: [],
      }),
    );
    vi.spyOn(api, "listOrganizationContactLists").mockResolvedValue([]);
    vi.spyOn(api, "listOrganizationProfiles").mockResolvedValue([]);
    vi.spyOn(api, "deleteOrganizationContact").mockImplementation(() => {
      contactsList = [];
      return Promise.resolve();
    });

    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <ContactsPage enabled />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 shown")).toBeInTheDocument();
    expect(screen.getAllByText("Alice Allison").length).toBeGreaterThanOrEqual(1);

    const [deleteBtn] = screen.getAllByRole("button", { name: "Delete Alice Allison" });
    expect(deleteBtn).toBeDefined();
    if (deleteBtn) {
      await user.click(deleteBtn);
    }

    const confirmDialog = await screen.findByRole("dialog", { name: "Delete contact?" });
    expect(confirmDialog).toBeInTheDocument();
    await user.click(within(confirmDialog).getByRole("button", { name: "Delete contact" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(screen.getByText("Contact deleted.")).toBeInTheDocument();
    expect(screen.getByText("0 shown")).toBeInTheDocument();
    expect(screen.queryByText("Alice Allison")).not.toBeInTheDocument();
  });

  it("leaves row visible and displays error message when deletion fails", async () => {
    vi.spyOn(api, "listAllOrganizationContacts").mockResolvedValue({
      contacts: [contact1],
      memberships: [],
      preferences: [],
    });
    vi.spyOn(api, "listOrganizationContactLists").mockResolvedValue([]);
    vi.spyOn(api, "listOrganizationProfiles").mockResolvedValue([]);
    vi.spyOn(api, "deleteOrganizationContact").mockRejectedValue(
      new Error("Network failure deleting contact"),
    );

    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <ContactsPage enabled />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("1 shown")).toBeInTheDocument();
    expect(screen.getAllByText("Alice Allison").length).toBeGreaterThanOrEqual(1);

    const [deleteBtn] = screen.getAllByRole("button", { name: "Delete Alice Allison" });
    expect(deleteBtn).toBeDefined();
    if (deleteBtn) {
      await user.click(deleteBtn);
    }

    const confirmDialog = await screen.findByRole("dialog", { name: "Delete contact?" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Delete contact" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(screen.getByText("The contact could not be deleted.")).toBeInTheDocument();
    expect(screen.getAllByText("Alice Allison").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("1 shown")).toBeInTheDocument();
  });
});
