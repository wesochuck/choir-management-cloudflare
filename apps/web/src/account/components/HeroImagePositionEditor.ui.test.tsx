import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { HeroImagePositionEditor } from "./HeroImagePositionEditor";

function Harness() {
  const [position, setPosition] = useState({ x: 50, y: 50 });
  return (
    <HeroImagePositionEditor
      imageUrl="/hero.png"
      position={position}
      disabled={false}
      onChange={setPosition}
    />
  );
}
it("supports arrow keys, precision controls, mobile crop and centering", () => {
  render(<Harness />);
  const reposition = screen.getByRole("button", { name: "Reposition hero image" });
  fireEvent.keyDown(reposition, { key: "ArrowDown" });
  expect(reposition).toHaveStyle({ backgroundPosition: "50% 52%" });
  fireEvent.keyDown(reposition, { key: "ArrowRight", shiftKey: true });
  expect(reposition).toHaveStyle({ backgroundPosition: "60% 52%" });
  fireEvent.change(screen.getByRole("slider", { name: /Vertical focal point/ }), {
    target: { value: "100" },
  });
  expect(reposition).toHaveStyle({ backgroundPosition: "60% 100%" });
  fireEvent.click(screen.getByRole("button", { name: "Mobile crop" }));
  expect(reposition).toHaveClass("hero-position-editor__image--mobile");
  fireEvent.click(screen.getByRole("button", { name: "Center image" }));
  expect(reposition).toHaveStyle({ backgroundPosition: "50% 50%" });
});
