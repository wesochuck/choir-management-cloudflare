import type { PublicWebsiteDocument } from "@choir/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { MarkdownToolbar } from "./MarkdownToolbar";
vi.mock("../../api", async (original) => ({
  ...(await original<typeof api>()),
  listOrganizationPublicDocuments: vi.fn(),
}));
const document: PublicWebsiteDocument = {
  id: "doc",
  fileId: "file",
  title: "Scholarship [form]",
  downloadPath: "/documents/scholarship.pdf",
  fileName: "form.pdf",
  contentType: "application/pdf",
  sizeBytes: 245760,
  slug: "scholarship",
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
function setup(value: string, supplied = true, manage?: () => Promise<boolean>) {
  const textareaRef = createRef<HTMLTextAreaElement>();
  const onChange = vi.fn();
  const view = (text: string) => (
    <>
      <MarkdownToolbar
        hostedDocuments={supplied ? [document] : undefined}
        value={text}
        textareaRef={textareaRef}
        onChange={onChange}
        onManageDocuments={manage}
      />
      <textarea aria-label="Content" ref={textareaRef} defaultValue={text} />
    </>
  );
  const rendered = render(view(value));
  return { ...rendered, view, textareaRef, onChange };
}
beforeEach(() => {
  vi.mocked(api.listOrganizationPublicDocuments).mockReset();
});
describe("direct document insertion", () => {
  it.each([
    ["Read here today", 5, 9, 'Read [here](/documents/scholarship.pdf){target="_self"} today'],
    [
      "Read  today",
      5,
      5,
      'Read [Scholarship \\[form\\]](/documents/scholarship.pdf){target="_self"} today',
    ],
    ['[Old](/old){target="_blank"}', 2, 2, '[Old](/documents/scholarship.pdf){target="_blank"}'],
  ])(
    "inserts at the captured selection and restores the caret",
    async (value, start, end, expected) => {
      const user = userEvent.setup();
      const { textareaRef, onChange } = setup(value);
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, end);
      await user.click(screen.getByRole("button", { name: "Insert document" }));
      expect(screen.getByRole("dialog", { name: "Insert document" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: /Scholarship \[form\] PDF/ }));
      expect(onChange).toHaveBeenCalledWith(expected);
      await waitFor(() => {
        expect(textareaRef.current).toHaveFocus();
      });
    },
  );
  it("filters documents and dismisses without an edit, returning focus to the trigger", async () => {
    const user = userEvent.setup();
    const { onChange } = setup("Read");
    const trigger = screen.getByRole("button", { name: "Insert document" });
    await user.click(trigger);
    await user.type(screen.getByRole("searchbox"), "missing");
    expect(screen.getByText("No matching documents.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });
  it("refuses a stale selection when the source text changes", async () => {
    const user = userEvent.setup();
    const { view, rerender, onChange } = setup("Old text");
    await user.click(screen.getByRole("button", { name: "Insert document" }));
    rerender(view("Changed text"));
    await user.click(screen.getByRole("button", { name: /Scholarship \[form\] PDF/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("The text changed");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("keeps selection and text when Manage documents navigation is canceled", async () => {
    const user = userEvent.setup();
    const manage = vi.fn().mockResolvedValue(false);
    const { textareaRef, onChange } = setup("Read here", true, manage);
    textareaRef.current?.setSelectionRange(5, 9);
    await user.click(screen.getByRole("button", { name: "Insert document" }));
    await user.click(screen.getByRole("button", { name: "Manage documents" }));
    expect(manage).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "Insert document" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Scholarship \[form\] PDF/ }));
    expect(onChange).toHaveBeenCalledWith(
      'Read [here](/documents/scholarship.pdf){target="_self"}',
    );
  });
  it("distinguishes loading, failure/retry, and empty results", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listOrganizationPublicDocuments).mockImplementationOnce(
      () =>
        new Promise(() => {
          /* Intentionally pending while loading is asserted. */
        }),
    );
    const { unmount } = setup("Read", false);
    await user.click(screen.getByRole("button", { name: "Insert document" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading documents");
    unmount();
    vi.mocked(api.listOrganizationPublicDocuments)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([]);
    setup("Read", false);
    await user.click(screen.getByRole("button", { name: "Insert document" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText("No website documents yet. Add one in Documents."),
    ).toBeInTheDocument();
  });
});
