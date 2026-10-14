import type { OrganizationPollSummary } from "@choir/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { archiveOrganizationPoll, listOrganizationPolls } from "../api";
import { PollEditDialog, PollsPage } from "./PollsPage";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal();
  if (typeof actual !== "object" || actual === null) throw new Error("Unexpected api shape");
  return {
    ...actual,
    archiveOrganizationPoll: vi.fn(),
    createOrganizationPoll: vi.fn(),
    getOrganizationPoll: vi.fn(),
    getOrganizationPollResults: vi.fn(),
    listOrganizationPolls: vi.fn(),
    updateOrganizationPoll: vi.fn(),
  };
});

describe("PollEditDialog exactly two options (#171)", () => {
  it("describes the dialog as asking a question with exactly two response options", () => {
    render(
      <PollEditDialog
        description=""
        editingPollHasResponses={false}
        editingPollId={null}
        error={null}
        expiresAt="2026-10-20T18:00"
        onClose={vi.fn()}
        onDescriptionChange={vi.fn()}
        onExpiresAtChange={vi.fn()}
        onOptionsChange={vi.fn()}
        onSave={vi.fn()}
        onTitleChange={vi.fn()}
        open={true}
        options={["Yes", "No"]}
        saving={false}
        title=""
      />,
    );

    expect(screen.getByRole("dialog", { name: "Create poll" })).toBeInTheDocument();
    expect(
      screen.getByText("Ask a question with exactly two response options (Yes and No by default)."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Option 1")).toHaveValue("Yes");
    expect(screen.getByLabelText("Option 2")).toHaveValue("No");
    expect(screen.queryByLabelText("Option 3")).not.toBeInTheDocument();
  });

  it("surfaces validation error specifying exactly two poll options", () => {
    render(
      <PollEditDialog
        description=""
        editingPollHasResponses={false}
        editingPollId={null}
        error="Add a title, expiration date, and exactly two poll options."
        expiresAt="2026-10-20T18:00"
        onClose={vi.fn()}
        onDescriptionChange={vi.fn()}
        onExpiresAtChange={vi.fn()}
        onOptionsChange={vi.fn()}
        onSave={vi.fn()}
        onTitleChange={vi.fn()}
        open={true}
        options={["Yes", "No"]}
        saving={false}
        title=""
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Add a title, expiration date, and exactly two poll options.",
    );
  });

  it("locks option inputs and informs user when poll has received responses", () => {
    render(
      <PollEditDialog
        description="Annual banquet attendance"
        editingPollHasResponses={true}
        editingPollId="poll-123"
        error={null}
        expiresAt="2026-10-20T18:00"
        onClose={vi.fn()}
        onDescriptionChange={vi.fn()}
        onExpiresAtChange={vi.fn()}
        onOptionsChange={vi.fn()}
        onSave={vi.fn()}
        onTitleChange={vi.fn()}
        open={true}
        options={["Yes", "No"]}
        saving={false}
        title="Attending Banquet?"
      />,
    );

    expect(screen.getByRole("dialog", { name: "Edit poll" })).toBeInTheDocument();
    expect(
      screen.getByText(/This poll has received responses\. Option structure is locked/),
    ).toBeInTheDocument();

    const opt1 = screen.getByLabelText<HTMLInputElement>("Option 1");
    const opt2 = screen.getByLabelText<HTMLInputElement>("Option 2");
    expect(opt1).toBeDisabled();
    expect(opt2).toBeDisabled();

    // Title and description remain editable
    expect(screen.getByLabelText<HTMLInputElement>("Title")).not.toBeDisabled();
    expect(screen.getByLabelText<HTMLTextAreaElement>("Description")).not.toBeDisabled();
  });

  it("calls onOptionsChange when editing option text", async () => {
    const user = userEvent.setup();
    const onOptionsChange = vi.fn();

    render(
      <PollEditDialog
        description=""
        editingPollHasResponses={false}
        editingPollId={null}
        error={null}
        expiresAt="2026-10-20T18:00"
        onClose={vi.fn()}
        onDescriptionChange={vi.fn()}
        onExpiresAtChange={vi.fn()}
        onOptionsChange={onOptionsChange}
        onSave={vi.fn()}
        onTitleChange={vi.fn()}
        open={true}
        options={["Yes", "No"]}
        saving={false}
        title=""
      />,
    );

    const opt1 = screen.getByLabelText<HTMLInputElement>("Option 1");
    await user.clear(opt1);
    await user.type(opt1, "Definitely");

    expect(onOptionsChange).toHaveBeenCalled();
  });

  it("shows archive button and requires 2-step inline confirmation (#170)", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <PollEditDialog
        archivedAt=""
        description="Active poll"
        editingPollHasResponses={true}
        editingPollId="a0000000-0000-4000-8000-000000000001"
        error={null}
        expiresAt="2026-10-20T18:00"
        onArchive={onArchive}
        onClose={onClose}
        onDescriptionChange={vi.fn()}
        onExpiresAtChange={vi.fn()}
        onOptionsChange={vi.fn()}
        onSave={vi.fn()}
        onTitleChange={vi.fn()}
        open={true}
        options={["Yes", "No"]}
        saving={false}
        title="Active Poll"
      />,
    );

    const archiveBtn = screen.getByRole("button", { name: "Archive poll" });
    expect(archiveBtn).toBeInTheDocument();

    // Click Archive poll -> shows 2-step confirmation
    await user.click(archiveBtn);
    const confirmGroup = screen.getByRole("group", { name: "Confirm archiving poll" });
    expect(
      within(confirmGroup).getByText(
        /Archive this poll\? Voting will close immediately while preserving all responses\./,
      ),
    ).toBeInTheDocument();

    const cancelBtn = within(confirmGroup).getByRole("button", { name: "Cancel" });
    const confirmBtn = within(confirmGroup).getByRole("button", { name: "Confirm archive" });
    expect(confirmBtn).toBeInTheDocument();

    // Cancel dismisses confirmation
    await user.click(cancelBtn);
    expect(screen.queryByRole("group", { name: "Confirm archiving poll" })).not.toBeInTheDocument();
    expect(onArchive).not.toHaveBeenCalled();

    // Click again and confirm
    await user.click(screen.getByRole("button", { name: "Archive poll" }));
    const activeConfirmGroup = screen.getByRole("group", { name: "Confirm archiving poll" });
    await user.click(within(activeConfirmGroup).getByRole("button", { name: "Confirm archive" }));

    expect(onArchive).toHaveBeenCalledWith("a0000000-0000-4000-8000-000000000001");
  });
});

const mockPollSummary: OrganizationPollSummary = {
  archivedAt: "",
  createdAt: "2026-10-10T12:00:00.000Z",
  expiresAt: "2026-10-20T18:00:00.000Z",
  id: "a0000000-0000-4000-8000-000000000001",
  optionTallies: [
    { count: 5, id: "b0000000-0000-4000-8000-000000000001", label: "Yes" },
    { count: 2, id: "b0000000-0000-4000-8000-000000000002", label: "No" },
  ],
  responseCount: 7,
  title: "Fall Concert Participation",
};

describe("PollsPage archive controls and safeguards (#170)", () => {
  function renderPollsPage() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <PollsPage enabled={true} />
      </QueryClientProvider>,
    );
  }

  it("renders active polls with Archive action, enforces 2-step confirmation, and disallows permanent deletion", async () => {
    const user = userEvent.setup();
    vi.mocked(listOrganizationPolls).mockResolvedValue([mockPollSummary]);
    vi.mocked(archiveOrganizationPoll).mockResolvedValue({
      archivedAt: "2026-10-14T12:00:00.000Z",
      id: mockPollSummary.id,
    });

    renderPollsPage();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Fall Concert Participation")).toBeInTheDocument();

    // Permanent delete must not exist anywhere on the page
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();

    // Archive button exists on the active row in table
    const archiveBtn = within(table).getByRole("button", { name: "Archive" });
    await user.click(archiveBtn);

    // 2-step confirmation prompt appears
    expect(within(table).getByText("Archive this poll?")).toBeInTheDocument();
    const cancelBtn = within(table).getByRole("button", { name: "Cancel" });
    const confirmBtn = within(table).getByRole("button", { name: "Confirm archive" });
    expect(confirmBtn).toBeInTheDocument();

    // Cancel dismisses without archiving
    await user.click(cancelBtn);
    expect(within(table).queryByText("Archive this poll?")).not.toBeInTheDocument();
    expect(archiveOrganizationPoll).not.toHaveBeenCalled();

    // Click Archive again and confirm
    await user.click(within(table).getByRole("button", { name: "Archive" }));
    await user.click(within(table).getByRole("button", { name: "Confirm archive" }));

    expect(archiveOrganizationPoll).toHaveBeenCalledWith(mockPollSummary.id);
    expect(await screen.findByText("Poll archived.")).toBeInTheDocument();
  });

  it("renders archived badge and no Archive button when poll is already archived", async () => {
    vi.mocked(listOrganizationPolls).mockResolvedValue([
      {
        ...mockPollSummary,
        archivedAt: "2026-10-14T12:00:00.000Z",
      },
    ]);

    renderPollsPage();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Fall Concert Participation")).toBeInTheDocument();
    expect(within(table).getByText("Archived")).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });
});
