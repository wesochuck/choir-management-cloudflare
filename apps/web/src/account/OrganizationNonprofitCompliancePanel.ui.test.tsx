import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { NonprofitComplianceSettingsResponse } from "@choir/contracts";
import { futureDateString } from "@choir/testkit";
import * as api from "../api/organization";
import { SaveBar, SaveCoordinatorProvider, useSaveCoordinator } from "../persistence";
import { OrganizationNonprofitCompliancePanel } from "./OrganizationNonprofitCompliancePanel";

vi.mock("../api/organization", () => ({
  getNonprofitComplianceSettings: vi.fn(),
  updateComplianceTask: vi.fn(),
  completeComplianceTask: vi.fn(),
  toggleNonprofitCompliance: vi.fn(),
}));
function firstButton(name: string): HTMLElement {
  const button = screen.getAllByRole("button", { name })[0];
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
      title: "IRS annual return",
      applicable: true,
      recurrenceMonths: 12,
      nextDueDate: date,
      lastCompletedDate: null,
      nextReminderAt: null,
      reminderIntervalDays: 7,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      kind: "ohio_ag_annual_report",
      title: "Ohio annual report",
      applicable: true,
      recurrenceMonths: 12,
      nextDueDate: date,
      lastCompletedDate: null,
      nextReminderAt: null,
      reminderIntervalDays: 7,
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
  await screen.findByText("IRS annual return");
  return { user: userEvent.setup(), onLeave };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getNonprofitComplianceSettings).mockResolvedValue(settings);
  vi.mocked(api.updateComplianceTask).mockImplementation((taskId, update) =>
    Promise.resolve({
      ...settings,
      tasks: settings.tasks.map((task) => (task.id === taskId ? { ...task, ...update } : task)),
    }),
  );
  vi.mocked(api.completeComplianceTask).mockResolvedValue(settings);
});

it("guards task switching and navigation, and saves through the shared SaveBar", async () => {
  const { user, onLeave } = await setup();
  await user.click(firstButton("Edit"));
  fireEvent.change(screen.getByLabelText("Recurrence (months)"), { target: { value: "24" } });
  expect(screen.getByRole("region", { name: "Unsaved changes" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByLabelText("Recurrence (months)")).toHaveValue(24);
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
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText("Recurrence (months)")).toHaveValue(12);
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
  fireEvent.change(screen.getByLabelText("Recurrence (months)"), { target: { value: "24" } });
  await user.click(
    within(screen.getByRole("region", { name: "Unsaved changes" })).getByRole("button", {
      name: "Save changes",
    }),
  );
  fireEvent.change(screen.getByLabelText("Recurrence (months)"), { target: { value: "36" } });
  await act(async () => {
    resolveSave?.({
      ...settings,
      tasks: settings.tasks.map((task, index) =>
        index === 0 ? { ...task, recurrenceMonths: 24 } : task,
      ),
    });
    await Promise.resolve();
  });
  expect(screen.getByLabelText("Recurrence (months)")).toHaveValue(36);
  expect(screen.getByRole("region", { name: "Unsaved changes" })).toBeInTheDocument();
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
