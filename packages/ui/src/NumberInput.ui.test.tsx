import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NumberInput } from "./NumberInput";

function Harness({ initial = 0, min = 0, max = 120, onCommit = vi.fn() }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label>
        Months
        <NumberInput
          min={min}
          max={max}
          value={value}
          onChange={(event) => {
            const next = Math.max(min, Math.min(max, event.currentTarget.valueAsNumber));
            setValue(next);
            onCommit(next);
          }}
        />
      </label>
      <button type="button">Done</button>
    </>
  );
}

describe("NumberInput", () => {
  it("allows deleting zero with Backspace and typing a replacement", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    const input = screen.getByRole("spinbutton", { name: "Months" });
    await user.click(input);
    await user.keyboard("{End}{Backspace}");
    expect(input).toHaveValue(null);
    expect(onCommit).not.toHaveBeenCalled();
    await user.type(input, "24");
    await user.tab();
    expect(input).toHaveValue(24);
    expect(onCommit).toHaveBeenLastCalledWith(24);
  });

  it("keeps a cleared positive value blank while editing, then restores it on blur", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness initial={12} min={1} onCommit={onCommit} />);
    const input = screen.getByLabelText("Months");
    await user.clear(input);
    expect(input).toHaveValue(null);
    expect(onCommit).not.toHaveBeenCalled();
    await user.tab();
    expect(input).toHaveValue(12);
  });

  it("retains typed digits before applying the consumer's canonical value on blur", async () => {
    const user = userEvent.setup();
    render(<Harness initial={12} min={10} />);
    const input = screen.getByLabelText("Months");
    await user.clear(input);
    await user.type(input, "24");
    expect(input).toHaveValue(24);
    await user.tab();
    expect(input).toHaveValue(24);
    await user.clear(input);
    await user.type(input, "999");
    expect(input).toHaveValue(999);
    expect(input).toBeInvalid();
    await user.tab();
    expect(input).toHaveValue(120);
    expect(input).toBeValid();
  });

  it("accepts an explicit zero and preserves native number attributes and event handlers", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness initial={12} onCommit={onCommit} />);
    const input = screen.getByLabelText("Months");
    await user.clear(input);
    await user.type(input, "0");
    await user.tab();
    expect(input).toHaveValue(0);
    expect(onCommit).toHaveBeenLastCalledWith(0);
    fireEvent.change(input, { target: { value: "1" } });
    expect(onCommit).toHaveBeenLastCalledWith(1);
  });

  it("reflects external value changes when there is no active edit", () => {
    const { rerender } = render(<NumberInput aria-label="Months" value={12} />);
    rerender(<NumberInput aria-label="Months" value={36} />);
    expect(screen.getByLabelText("Months")).toHaveValue(36);
  });
});
