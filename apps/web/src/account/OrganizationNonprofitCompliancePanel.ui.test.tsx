import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { NonprofitComplianceSettingsResponse } from "@choir/contracts";
import { futureDateString, pastDateString, relativeDate } from "@choir/testkit";
import * as api from "../api/organization";
import { SaveBar, SaveCoordinatorProvider, useSaveCoordinator } from "../persistence";
import { OrganizationNonprofitCompliancePanel } from "./OrganizationNonprofitCompliancePanel";

vi.mock("../api/organization", () => ({
  getNonprofitComplianceSettings: vi.fn(),
  getComplianceAssignees: vi.fn(),
  updateComplianceTask: vi.fn(),
  completeComplianceTask: vi.fn(),
  toggleNonprofitCompliance: vi.fn(),
  createComplianceTask: vi.fn(),
  archiveComplianceTask: vi.fn(),
  restoreComplianceTask: vi.fn(),
}));
function table(): HTMLElement {
  return screen.getByRole("table");
}

function firstButton(name: string): HTMLElement {
  const button = within(table()).getAllByRole("button", { name })[0];
  if (!button) throw new Error(`Missing ${name} button`);
  return button;
}
const date = futureDateString({ days: 30 });
const settings: NonprofitComplianceSettingsResponse = {
  enabled: true,
  requestId: "11111111-1111-4111-8111-111111111111",
  tasks: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      kind: "irs_annual_return",
      source: "builtin",
      templateKey: "irs_annual_return",
      title: "IRS annual return",
      description: "",
      referenceUrl: null,
      applicable: true,
      archived: false,
      recurrenceMonths: 12,
      nextDueDate: date,
      lastCompletedDate: null,
      nextReminderAt: null,
      reminderIntervalDays: 7,
      responsibleMembershipId: null,
      responsibleUserId: null,
      responsibleName: null,
      responsibleEmail: null,
      responsibleNeedsReassignment: false,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      kind: "ohio_ag_annual_report",
      source: "builtin",
      templateKey: "ohio_ag_annual_report",
      title: "Ohio annual report",
      description: "",
      referenceUrl: null,
      applicable: true,
      archived: false,
      recurrenceMonths: 12,
      nextDueDate: date,
      lastCompletedDate: null,
      nextReminderAt: null,
      reminderIntervalDays: 7,
      responsibleMembershipId: null,
      responsibleUserId: null,
      responsibleName: null,
      responsibleEmail: null,
      responsibleNeedsReassignment: false,
    },
  ],
};
function Navigate({ onLeave }: { readonly onLeave: () => void }) {
  const coordinator = useSaveCoordinator();
  return (
    <button
      onClick={() => {
        void coordinator.requestLeave({ reason: "navigate", action: onLeave });
      }}
    >
      Navigate away
    </button>
  );
}
async function setup() {
  const onLeave = vi.fn();
  render(
    <SaveCoordinatorProvider>
      <OrganizationNonprofitCompliancePanel timezone="UTC" />
      <SaveBar />
      <Navigate onLeave={onLeave} />
    </SaveCoordinatorProvider>,
  );
  await screen.findByRole("table");
  await within(table()).findByText("IRS annual return");
  return { user: userEvent.setup(), onLeave };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getNonprofitComplianceSettings).mockResolvedValue(settings);
  vi.mocked(api.getComplianceAssignees).mockResolvedValue({
    assignees: [],
    requestId: "11111111-1111-4111-8111-111111111111",
  });
  vi.mocked(api.updateComplianceTask).mockImplementation((taskId, update) =>
    Promise.resolve({
      ...settings,
      tasks: settings.tasks.map((task) => (task.id === taskId ? { ...task, ...update } : task)),
    }),
  );
  vi.mocked(api.completeComplianceTask).mockResolvedValue(settings);
});

it("explains that weekly reminders start four weeks before the due date", async () => {
  await setup();
  expect(
    screen.getByText(/starting four weeks before the stored due date until marked complete/),
  ).toBeInTheDocument();
});

it.each(["Jordan Smith", null, undefined])(
  "shows completion attribution with name=%s",
  async (name) => {
    vi.mocked(api.getNonprofitComplianceSettings).mockResolvedValue({
      ...settings,
      tasks: settings.tasks.map((task) => ({
        ...task,
        lastCompletedDate: pastDateString({ days: 1 }),
        lastCompletedByUserId: "admin-id",
        lastCompletedByName: name,
      })),
    });
    await setup();
    expect(within(table()).getAllByText(`By ${name ?? "Name unavailable"}`)).toHaveLength(2);
  },
);

it.each([
  { days: 29, completed: true, label: "Completed", tone: "success" },
  { days: 29, completed: false, label: "Scheduled", tone: "neutral" },
  { days: 28, completed: true, label: "Upcoming", tone: "neutral" },
  { days: 0, completed: true, label: "Due", tone: "warning" },
  { days: -1, completed: true, label: "Overdue", tone: "danger" },
  { days: null, completed: false, label: "Not scheduled", tone: "neutral" },
  { days: null, completed: true, label: "Completed", tone: "success" },
])(
  "shows $label for a task $days days away with completion=$completed",
  async ({ days, completed, label, tone }) => {
    vi.mocked(api.getNonprofitComplianceSettings).mockResolvedValue({
      ...settings,
      tasks: settings.tasks.map((task) => ({
        ...task,
        lastCompletedDate: completed ? pastDateString({ days: 365 }) : null,
        nextDueDate: days === null ? null : relativeDate({ days }).toISOString().slice(0, 10),
      })),
    });
    await setup();
    const pills = within(table()).getAllByLabelText(`Status: ${label}`);
    expect(pills).toHaveLength(2);
    for (const pill of pills) expect(pill).toHaveClass(`status-pill--${tone}`);
  },
);

it("guards task switching and navigation, and saves through the shared SaveBar", async () => {
  const { user, onLeave } = await setup();
  await user.click(firstButton("Edit"));
  fireEvent.change(within(table()).getByLabelText("Recurrence (months)"), {
    target: { value: "24" },
  });
  expect(screen.getByRole("region", { name: "Unsaved changes" })).toBeInTheDocument();
  await user.click(within(table()).getByRole("button", { name: "Edit" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(within(table()).getByLabelText("Recurrence (months)")).toHaveValue(24);
  await user.click(screen.getByRole("button", { name: "Navigate away" }));
  expect(onLeave).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(
    within(screen.getByRole("region", { name: "Unsaved changes" })).getByRole("button", {
      name: /Save/,
    }),
  );
  await waitFor(() => {
    expect(api.updateComplianceTask).toHaveBeenCalledWith(settings.tasks[0]?.id, {
      applicable: true,
      nextDueDate: date,
      recurrenceMonths: 24,
    });
  });
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument(),
  );
  await user.click(within(table()).getByRole("button", { name: "Edit" }));
  expect(within(table()).getByLabelText("Recurrence (months)")).toHaveValue(12);
});

it("keeps newer edits dirty when a previous save finishes", async () => {
  const { user } = await setup();
  let resolveSave: ((value: NonprofitComplianceSettingsResponse) => void) | undefined;
  vi.mocked(api.updateComplianceTask).mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
  );
  await user.click(firstButton("Edit"));
  fireEvent.change(within(table()).getByLabelText("Recurrence (months)"), {
    target: { value: "24" },
  });
  await user.click(
    within(screen.getByRole("region", { name: "Unsaved changes" })).getByRole("button", {
      name: "Save changes",
    }),
  );
  fireEvent.change(within(table()).getByLabelText("Recurrence (months)"), {
    target: { value: "36" },
  });
  await act(async () => {
    resolveSave?.({
      ...settings,
      tasks: settings.tasks.map((task, index) =>
        index === 0 ? { ...task, recurrenceMonths: 24 } : task,
      ),
    });
    await Promise.resolve();
  });
  expect(within(table()).getByLabelText("Recurrence (months)")).toHaveValue(36);
  expect(screen.getByRole("region", { name: "Unsaved changes" })).toBeInTheDocument();
});

it("allows clearing recurrence and saves the replacement without a leading zero", async () => {
  const { user } = await setup();
  await user.click(firstButton("Edit"));
  const input = within(table()).getByLabelText("Recurrence (months)");
  await user.clear(input);
  expect(input).toHaveValue(null);
  expect(api.updateComplianceTask).not.toHaveBeenCalled();
  await user.type(input, "24");
  await user.click(
    within(screen.getByRole("region", { name: "Unsaved changes" })).getByRole("button", {
      name: "Save changes",
    }),
  );
  await waitFor(() => {
    expect(api.updateComplianceTask).toHaveBeenCalledWith(settings.tasks[0]?.id, {
      applicable: true,
      nextDueDate: date,
      recurrenceMonths: 24,
    });
  });
  expect(input).toHaveValue(24);
});

it("uses a focus-trapped completion dialog with guarded dismissal and focus restoration", async () => {
  const { user } = await setup();
  const trigger = firstButton("Mark completed");
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Mark IRS annual return complete" });
  expect(dialog.contains(document.activeElement)).toBe(true);
  for (let i = 0; i < 6; i++) {
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  }
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  fireEvent.input(screen.getByLabelText("Completion date"), { target: { value: date } });
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.completeComplianceTask).not.toHaveBeenCalled();
});

it("renders tasks in a sortable table with the expected columns", async () => {
  const { user } = await setup();
  for (const header of [
    "Requirement",
    "Status",
    "Next due",
    "Recurrence",
    "Responsible administrator",
    "Last completed",
    "Actions",
  ]) {
    expect(
      within(table()).getByRole("columnheader", { name: new RegExp(`^${header}`) }),
    ).toBeInTheDocument();
  }
  expect(within(table()).getByRole("button", { name: "Sort by Next due" })).toBeInTheDocument();
  const bodyRows = () =>
    Array.from(table().querySelectorAll("tbody tr:not(.data-table__expanded-row)")).map(
      (row) => row.textContent,
    );
  // Default status order keeps API order for equal upcoming statuses.
  expect(bodyRows()[0]).toContain("IRS annual return");
  await user.click(within(table()).getByRole("button", { name: "Sort by Requirement" }));
  await user.click(within(table()).getByRole("button", { name: "Sort by Requirement" }));
  expect(bodyRows()[0]).toContain("Ohio annual report");
});

it("orders overdue and soonest first by default and responds to header sorting", async () => {
  vi.mocked(api.getNonprofitComplianceSettings).mockResolvedValue({
    ...settings,
    tasks: settings.tasks.map((task, index) => ({
      ...task,
      nextDueDate: relativeDate({ days: index === 0 ? 30 : 10 })
        .toISOString()
        .slice(0, 10),
    })),
  });
  const { user } = await setup();
  const bodyRows = () =>
    Array.from(table().querySelectorAll("tbody tr:not(.data-table__expanded-row)")).map(
      (row) => row.textContent,
    );
  // Default status order surfaces the sooner due date first within Upcoming.
  expect(bodyRows()[0]).toContain("Ohio annual report");
  await user.click(within(table()).getByRole("button", { name: "Sort by Requirement" }));
  expect(bodyRows()[0]).toContain("IRS annual return");
  expect(bodyRows()[1]).toContain("Ohio annual report");
});

it("shows the short Add dialog intro with the recipient policy under Responsible administrator", async () => {
  const { user } = await setup();
  await user.click(screen.getByRole("button", { name: "Add reminder" }));
  const dialog = screen.getByRole("dialog", { name: "Add compliance reminder" });
  expect(within(dialog).getByText("Create a custom Organization reminder.")).toBeInTheDocument();
  expect(
    within(dialog).queryByText(/Reminders go to all Owners and Administrators\.$/),
  ).not.toBeInTheDocument();
  const select = within(dialog).getByLabelText("Responsible administrator");
  const hintId = select.getAttribute("aria-describedby");
  expect(hintId).toBe("new-reminder-responsible-hint");
  const hint = document.getElementById(hintId ?? "");
  expect(hint).toHaveTextContent(
    "This assignment is for accountability only. Reminder emails go to all Organization Owners and Administrators, not just the selected person.",
  );
});

it("keeps the aligned recipient policy under Responsible administrator when editing", async () => {
  const { user } = await setup();
  await user.click(firstButton("Edit"));
  const select = within(table()).getByLabelText("Responsible administrator");
  const hint = document.getElementById(select.getAttribute("aria-describedby") ?? "");
  expect(hint).toHaveTextContent(
    "This assignment is for accountability only. Reminder emails go to all Organization Owners and Administrators, not just the selected person.",
  );
});

it("renders all four built-ins including the Ohio suggested date and count", async () => {
  const template = settings.tasks[0];
  if (!template) throw new Error("Missing fixture task");
  vi.mocked(api.getNonprofitComplianceSettings).mockResolvedValue({
    ...settings,
    tasks: [
      ...settings.tasks,
      {
        ...template,
        description: "Review unclaimed funds annually.",
        id: "44444444-4444-4444-8444-444444444444",
        kind: "ohio_unclaimed_funds_annual_report",
        nextDueDate: futureDateString({ days: 60 }),
        referenceUrl: "https://unclaimedfunds.ohio.gov/app/submit-a-report",
        templateKey: "ohio_unclaimed_funds_annual_report",
        title: "Ohio Annual Unclaimed Funds Report (including negative reports)",
      },
      {
        ...template,
        id: "55555555-5555-4555-8555-555555555555",
        kind: "ohio_continued_existence",
        nextDueDate: futureDateString({ days: 90 }),
        recurrenceMonths: 60,
        templateKey: "ohio_continued_existence",
        title: "Ohio Secretary of State Statement of Continued Existence",
      },
    ],
  });
  await setup();
  expect(screen.getByText("4 built-in · 0 custom · 0 archived")).toBeInTheDocument();
  expect(
    within(table()).getByText("Ohio Annual Unclaimed Funds Report (including negative reports)"),
  ).toBeInTheDocument();
  expect(within(table()).getByText(/Suggested date only/)).toBeInTheDocument();
  expect(within(table()).getByRole("link", { name: "Ohio holder reporting" })).toBeInTheDocument();
});
