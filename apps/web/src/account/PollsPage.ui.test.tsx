import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PollEditDialog } from "./PollsPage";

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
});
