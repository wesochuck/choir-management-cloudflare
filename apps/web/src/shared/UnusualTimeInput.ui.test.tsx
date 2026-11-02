import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { UnusualTimeInput } from "./UnusualTimeInput";

function Editor({ save }: { readonly save: () => void }) {
  const [value, setValue] = useState("18:00");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <UnusualTimeInput
        aria-label="Start"
        type="time"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      <button type="submit">Save</button>
    </form>
  );
}
describe("unusual time input", () => {
  it("prompts on blur and accepts an unchanged confirmed value", () => {
    render(<Editor save={vi.fn()} />);
    const input = screen.getByLabelText("Start");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "02:30" } });
    expect(screen.queryByText("Check this time")).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByText(/2:30 AM/)).toBeTruthy();
    fireEvent.click(screen.getByText("Keep time"));
    fireEvent.blur(input);
    expect(screen.queryByText("Check this time")).toBeNull();
  });
  it("blocks saving an unconfirmed edited time", () => {
    const save = vi.fn();
    render(<Editor save={save} />);
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "02:30" } });
    fireEvent.click(screen.getByText("Save"));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("Change time")).toBeTruthy();
  });
});
