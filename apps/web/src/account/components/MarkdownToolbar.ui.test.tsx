import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { MarkdownToolbar } from "./MarkdownToolbar";

describe("MarkdownToolbar", () => {
  it("applies bold formatting to empty selection with default text", async () => {
    const user = userEvent.setup();
    const textareaRef = createRef<HTMLTextAreaElement>();
    const onChange = vi.fn();

    render(
      <div>
        <MarkdownToolbar onChange={onChange} textareaRef={textareaRef} value="" />
        <textarea ref={textareaRef} defaultValue="" />
      </div>,
    );

    const boldButton = screen.getByRole("button", { name: "Bold text" });
    await user.click(boldButton);

    expect(onChange).toHaveBeenCalledWith("**bold text**");
  });

  it("applies heading 2 to current line", async () => {
    const user = userEvent.setup();
    const textareaRef = createRef<HTMLTextAreaElement>();
    const onChange = vi.fn();

    render(
      <div>
        <MarkdownToolbar onChange={onChange} textareaRef={textareaRef} value="Hello world" />
        <textarea ref={textareaRef} defaultValue="Hello world" />
      </div>,
    );

    const h2Button = screen.getByRole("button", { name: "Heading 2" });
    await user.click(h2Button);

    expect(onChange).toHaveBeenCalledWith("## Hello world");
  });

  it("applies link formatting to text", async () => {
    const user = userEvent.setup();
    const textareaRef = createRef<HTMLTextAreaElement>();
    const onChange = vi.fn();

    render(
      <div>
        <MarkdownToolbar onChange={onChange} textareaRef={textareaRef} value="" />
        <textarea ref={textareaRef} defaultValue="" />
      </div>,
    );

    const linkButton = screen.getByRole("button", { name: "Insert link" });
    await user.click(linkButton);

    const dialog = screen.getByRole("dialog", { name: "Insert link" });
    expect(dialog).toBeInTheDocument();
    await user.type(screen.getByLabelText("Link text"), "Our website");
    await user.type(screen.getByLabelText("Link address"), "example.org");
    await user.click(screen.getByRole("checkbox", { name: "Open in new tab" }));
    await user.click(screen.getByRole("button", { name: "Apply link" }));
    expect(onChange).toHaveBeenCalledWith('[Our website](https://example.org){target="_blank"}');
  });

  it("populates title, link address, and new tab when selecting a hosted document", async () => {
    const user = userEvent.setup();
    const textareaRef = createRef<HTMLTextAreaElement>();
    const onChange = vi.fn();
    const hostedDoc = {
      contentType: "application/pdf" as const,
      createdAt: "2026-01-01T00:00:00Z",
      downloadPath: "/api/public/documents/donation-form.pdf",
      fileId: "11111111-1111-4111-8111-111111111111",
      fileName: "form.pdf",
      id: "22222222-2222-4222-8222-222222222222",
      sizeBytes: 1024,
      slug: "donation-form",
      sortOrder: 0,
      title: "Mail-In Donation Form",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    render(
      <div>
        <MarkdownToolbar
          hostedDocuments={[hostedDoc]}
          onChange={onChange}
          textareaRef={textareaRef}
          value=""
        />
        <textarea ref={textareaRef} defaultValue="" />
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "Insert link" }));
    expect(screen.getByRole("dialog", { name: "Insert link" })).toBeInTheDocument();

    const select = screen.getByLabelText("Hosted document (optional)");
    await user.selectOptions(select, hostedDoc.id);

    expect(screen.getByLabelText("Link text")).toHaveValue("Mail-In Donation Form");
    expect(screen.getByLabelText("Link address")).toHaveValue(
      "/api/public/documents/donation-form.pdf",
    );
    expect(screen.getByRole("checkbox", { name: "Open in new tab" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Apply link" }));
    expect(onChange).toHaveBeenCalledWith(
      '[Mail-In Donation Form](/api/public/documents/donation-form.pdf){target="_blank"}',
    );
  });
});
