import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";

import { DesignSystemView } from "./DesignSystemView";

describe("DesignSystemView form anatomy", () => {
  it("associates explanatory help text with aria-describedby", () => {
    render(<DesignSystemView />);
    const forms = within(screen.getByRole("region", { name: "Forms" }));

    const publicEmail = forms.getByLabelText("Public contact email");
    expect(publicEmail).toHaveAttribute("aria-describedby", "ds-sample-help-text");
    expect(forms.getByText("Shown on public event listings and receipt footers.")).toHaveAttribute(
      "id",
      "ds-sample-help-text",
    );
  });

  it("keeps optional markers inline with label row without intervening elements before control", () => {
    render(<DesignSystemView />);
    const forms = within(screen.getByRole("region", { name: "Forms" }));

    const optionalInput = forms.getByLabelText(/^Alternate contact/);
    expect(optionalInput).toBeInTheDocument();

    const field = optionalInput.closest(".field");
    expect(field).not.toBeNull();

    // The label row must contain the label text and the inline optional marker
    const labelRow = field?.querySelector(".field__label-row");
    expect(labelRow).not.toBeNull();
    if (!(labelRow instanceof HTMLElement)) {
      throw new Error("Expected labelRow to be an HTMLElement");
    }
    expect(within(labelRow).getByText("(Optional)")).toBeInTheDocument();

    // The input must be a direct child of .field, directly following the label row
    expect(labelRow.nextElementSibling).toBe(optionalInput);
  });

  it("marks required inputs with semantic required attribute", () => {
    render(<DesignSystemView />);
    const forms = within(screen.getByRole("region", { name: "Forms" }));

    const requiredInput = forms.getByLabelText("Organization name");
    expect(requiredInput).toBeRequired();
  });

  it("associates validation error message with role='alert' and aria-invalid", () => {
    render(<DesignSystemView />);
    const forms = within(screen.getByRole("region", { name: "Forms" }));

    const invalidInput = forms.getByLabelText("Season code");
    expect(invalidInput).toHaveAttribute("aria-invalid", "true");
    expect(invalidInput).toHaveAttribute("aria-describedby", "ds-sample-invalid-error");

    const errorMsg = forms.getByRole("alert");
    expect(errorMsg).toHaveAttribute("id", "ds-sample-invalid-error");
    expect(errorMsg).toHaveClass("field-error");
    expect(errorMsg).toHaveTextContent("Enter at least 3 characters.");
  });

  it("associates paired fields in form-grid with below-control help and aria-describedby", () => {
    render(<DesignSystemView />);
    const forms = within(screen.getByRole("region", { name: "Forms" }));

    const voiceSelect = forms.getByLabelText("Voice part");
    const sectionInput = forms.getByLabelText(/^Section note/);

    expect(voiceSelect).toBeInTheDocument();
    expect(sectionInput).toBeInTheDocument();
    expect(sectionInput).toHaveAttribute("aria-describedby", "ds-sample-paired-help");

    const pairedHelp = forms.getByText("Visible only to directors and section leaders.");
    expect(pairedHelp).toHaveAttribute("id", "ds-sample-paired-help");
    expect(pairedHelp).toHaveClass("field-help");

    // Both controls should reside within a .form-grid container
    const formGrid = voiceSelect.closest(".form-grid");
    expect(formGrid).not.toBeNull();
    expect(sectionInput.closest(".form-grid")).toBe(formGrid);
  });
});

describe("DesignSystemView choice controls", () => {
  it("renders canonical choice-field markup with choice-field__content wrapper", () => {
    render(<DesignSystemView />);
    const forms = within(screen.getByRole("region", { name: "Forms" }));

    const singleLineCheckbox = forms.getByRole("checkbox", {
      name: "Email reminders before performances",
    });
    expect(singleLineCheckbox).toBeInTheDocument();

    const label = singleLineCheckbox.closest("label");
    expect(label).toHaveClass("choice-field");

    const content = label?.querySelector(".choice-field__content");
    expect(content).not.toBeNull();
    expect(content).toHaveTextContent("Email reminders before performances");
  });

  it("supports title and description anatomy in choice controls", () => {
    render(<DesignSystemView />);
    const forms = within(screen.getByRole("region", { name: "Forms" }));

    const autoFollowUp = forms.getByRole("checkbox", {
      name: /Automatic attendance follow-up/,
    });
    expect(autoFollowUp).toBeInTheDocument();
    expect(autoFollowUp).toHaveAttribute("aria-describedby", "ds-choice-desc-help");

    const label = autoFollowUp.closest("label");
    expect(label).toHaveClass("choice-field");

    const title = label?.querySelector(".choice-field__title");
    expect(title).toHaveTextContent("Automatic attendance follow-up");

    const description = label?.querySelector(".choice-field__description");
    expect(description).toHaveAttribute("id", "ds-choice-desc-help");
    expect(description).toHaveTextContent(/Send an automated email reminder/);
  });

  it("supports disabled choice controls", () => {
    render(<DesignSystemView />);
    const forms = within(screen.getByRole("region", { name: "Forms" }));

    const disabledCheckbox = forms.getByRole("checkbox", {
      name: /Archived season syncing \(Disabled\)/,
    });
    expect(disabledCheckbox).toBeDisabled();

    const disabledRadio = forms.getByRole("radio", {
      name: /Roster closed \(Disabled\)/,
    });
    expect(disabledRadio).toBeDisabled();
  });

  it("supports radio groups within fieldset.choice-group", () => {
    render(<DesignSystemView />);
    const forms = within(screen.getByRole("region", { name: "Forms" }));

    const radioGroup = forms.getByRole("group", { name: "Choice controls: radio group" });
    expect(radioGroup).toHaveClass("choice-group");

    const auditionRadio = within(radioGroup).getByRole("radio", { name: /Audition required/ });
    const openRadio = within(radioGroup).getByRole("radio", { name: /Open inquiry/ });

    expect(auditionRadio).toBeChecked();
    expect(openRadio).not.toBeChecked();
  });

  it("supports large touch/public variant via .choice-field--large", () => {
    render(<DesignSystemView />);
    const forms = within(screen.getByRole("region", { name: "Forms" }));

    const publicCheckbox = forms.getByRole("checkbox", {
      name: "Hide my name from public donor recognition",
    });
    const label = publicCheckbox.closest("label");
    expect(label).toHaveClass("choice-field");
    expect(label).toHaveClass("choice-field--large");
  });
});

describe("DesignSystemView action rows", () => {
  it("renders ordinary button rows and inline control-height button actions", () => {
    render(<DesignSystemView />);
    const buttonsSection = within(screen.getByRole("region", { name: "Buttons & actions" }));

    const searchBtn = buttonsSection.getByRole("button", { name: "Search" });
    expect(searchBtn).toHaveClass("button--control-height");
    expect(searchBtn.closest("form")).toHaveClass("design-system__inline-row");
  });

  it("renders form-actions with start, between, and end alignment modifiers", () => {
    render(<DesignSystemView />);
    const buttonsSection = within(screen.getByRole("region", { name: "Buttons & actions" }));

    const startBtn = buttonsSection.getByRole("button", { name: "Start aligned (Primary)" });
    expect(startBtn.closest(".form-actions")).toHaveClass("form-actions--start");

    const betweenBtn = buttonsSection.getByRole("button", { name: "Space between (Continue)" });
    expect(betweenBtn.closest(".form-actions")).toHaveClass("form-actions--between");

    const endBtn = buttonsSection.getByRole("button", { name: "End aligned (Save)" });
    expect(endBtn.closest(".form-actions")).toHaveClass("form-actions--end");
  });

  it("keeps dialog footer actions specialized with dialog__actions", () => {
    render(<DesignSystemView />);
    const primitivesSection = within(screen.getByRole("region", { name: "UI primitives" }));

    const openDialogBtn = primitivesSection.getByRole("button", { name: "Open dialog" });
    fireEvent.click(openDialogBtn);

    const dialog = screen.getByRole("dialog");
    const saveBtn = within(dialog).getByRole("button", { name: "Save sample" });
    const dialogActions = saveBtn.closest(".dialog__actions");
    expect(dialogActions).not.toBeNull();
  });
});
