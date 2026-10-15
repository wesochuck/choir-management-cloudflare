import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PublicCopy } from "./PublicCopy";

describe("PublicCopy", () => {
  it("renders headings and paragraphs", () => {
    const markdown = "# Title\n\n## Subtitle\n\n### Section\n\nRegular paragraph text.";
    render(<PublicCopy text={markdown} />);

    expect(screen.getByRole("heading", { level: 2, name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Subtitle" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Section" })).toBeInTheDocument();
    expect(screen.getByText("Regular paragraph text.")).toBeInTheDocument();
  });

  it("renders inline bold, italic, and safe links", () => {
    const markdown =
      "Check out our **bold voices** and *expressive sound* on [our website](https://example.com) or [email us](mailto:test@example.com).";
    render(<PublicCopy text={markdown} />);

    expect(screen.getByText("bold voices").tagName).toBe("STRONG");
    expect(screen.getByText("expressive sound").tagName).toBe("EM");

    const link = screen.getByRole("link", { name: "our website" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");

    const mailLink = screen.getByRole("link", { name: "email us" });
    expect(mailLink).toHaveAttribute("href", "mailto:test@example.com");
  });

  it("sanitizes unsafe javascript links and treats raw HTML as text", () => {
    const unsafe = "Unsafe link: [Click me](javascript:alert(1)) and <script>alert('xss')</script>";
    render(<PublicCopy text={unsafe} />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByText(/Unsafe link: \[Click me\]\(javascript:alert\(1\)\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/<script>alert\('xss'\)<\/script>/)).toBeInTheDocument();
  });
});
