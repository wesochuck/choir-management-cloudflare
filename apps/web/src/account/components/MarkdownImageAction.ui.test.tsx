import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { MarkdownToolbar } from "./MarkdownToolbar";
vi.mock("../../api", async (original) => ({
  ...(await original<typeof api>()),
  uploadPrivateOrganizationFile: vi.fn(),
  deletePrivateOrganizationFile: vi.fn(),
}));
const fileId = "77777777-7777-4777-8777-777777777777";
function editor(value = "Before\n\n", allowImages = true) {
  const textareaRef = createRef<HTMLTextAreaElement>();
  const onChange = vi.fn();
  const view = (text: string, change = onChange) => (
    <>
      <MarkdownToolbar
        value={text}
        textareaRef={textareaRef}
        onChange={change}
        allowImages={allowImages}
      />
      <textarea aria-label="Body" ref={textareaRef} defaultValue={text} />
    </>
  );
  const result = render(view(value));
  textareaRef.current?.setSelectionRange(value.length, value.length);
  return { ...result, textareaRef, onChange, view };
}
beforeEach(() => {
  vi.mocked(api.uploadPrivateOrganizationFile).mockReset();
  vi.mocked(api.deletePrivateOrganizationFile).mockReset();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() }),
  );
});
describe("website image toolbar", () => {
  it("keeps image controls out of existing non-website toolbars", () => {
    editor("", false);
    expect(screen.queryByRole("button", { name: "Insert image" })).toBeNull();
  });
  it("validates image type and alt text, uploads once, inserts a block and restores the cursor", async () => {
    const user = userEvent.setup();
    const { onChange, textareaRef } = editor();
    vi.mocked(api.uploadPrivateOrganizationFile).mockResolvedValue({
      id: fileId,
      fileName: "choir.png",
      contentType: "image/png",
      sizeBytes: 8,
      uploadedAt: "2026-11-01T00:00:00Z",
      requestId: "11111111-1111-4111-8111-111111111111",
    });
    await user.click(screen.getByRole("button", { name: "Insert image" }));
    const dialog = within(screen.getByRole("dialog", { name: "Insert image" }));
    await user.click(dialog.getByRole("button", { name: "Insert image" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose an image");
    await user.upload(
      dialog.getByLabelText("Choose image"),
      new File(["image"], "choir.png", { type: "image/png" }),
    );
    await user.type(dialog.getByLabelText("Alt text"), "Choir rehearsing");
    await user.type(dialog.getByLabelText("Caption (optional)"), "Spring rehearsal");
    await user.click(dialog.getByRole("button", { name: "Insert image" }));
    expect(onChange).toHaveBeenCalledWith(
      `Before\n\n![Choir rehearsing](choir-image:${fileId} "Spring rehearsal")`,
    );
    expect(api.uploadPrivateOrganizationFile).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(textareaRef.current).toHaveFocus());
  });
  it("rejects unsupported or oversized files before upload", async () => {
    const user = userEvent.setup({ applyAccept: false });
    editor();
    await user.click(screen.getByRole("button", { name: "Insert image" }));
    const input = screen.getByLabelText("Choose image");
    await user.upload(input, new File(["<svg/>"], "image.svg", { type: "image/svg+xml" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a JPEG, PNG, or WebP");
    await user.upload(
      input,
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("5 MB or smaller");
    expect(api.uploadPrivateOrganizationFile).not.toHaveBeenCalled();
  });
  it("updates alt text and caption without replacing the source image", async () => {
    const user = userEvent.setup();
    const { onChange } = editor(`![Old description](choir-image:${fileId})`);
    await user.click(screen.getByRole("button", { name: "Insert image" }));
    await user.clear(screen.getByLabelText("Alt text"));
    await user.type(screen.getByLabelText("Alt text"), "Choir singing");
    await user.type(screen.getByLabelText("Caption (optional)"), "Spring concert");
    await user.click(screen.getByRole("button", { name: "Apply image" }));
    expect(onChange).toHaveBeenCalledWith(
      `![Choir singing](choir-image:${fileId} "Spring concert")`,
    );
    expect(api.uploadPrivateOrganizationFile).not.toHaveBeenCalled();
    expect(api.deletePrivateOrganizationFile).not.toHaveBeenCalled();
  });
  it("cancels an unopened upload without changing content", async () => {
    const user = userEvent.setup();
    const { onChange } = editor();
    await user.click(screen.getByRole("button", { name: "Insert image" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(api.uploadPrivateOrganizationFile).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Insert image" })).toHaveFocus();
  });
  it("edits and removes an existing image without uploading or deleting published files", async () => {
    const user = userEvent.setup();
    const { onChange } = editor(`![Old description](choir-image:${fileId})`);
    await user.click(screen.getByRole("button", { name: "Insert image" }));
    expect(screen.getByRole("dialog", { name: "Edit image" })).toBeInTheDocument();
    expect(screen.getByLabelText("Alt text")).toHaveValue("Old description");
    await user.click(screen.getByRole("button", { name: "Remove image" }));
    expect(onChange).toHaveBeenCalledWith("");
    expect(api.uploadPrivateOrganizationFile).not.toHaveBeenCalled();
    expect(api.deletePrivateOrganizationFile).not.toHaveBeenCalled();
  });
  it("rejects a stale insertion and cleans up its new upload without overwriting newer text", async () => {
    const user = userEvent.setup();
    const { onChange, rerender, view } = editor();
    vi.mocked(api.uploadPrivateOrganizationFile).mockResolvedValue({
      id: fileId,
      fileName: "choir.png",
      contentType: "image/png",
      sizeBytes: 8,
      uploadedAt: "2026-11-01T00:00:00Z",
      requestId: "11111111-1111-4111-8111-111111111111",
    });
    await user.click(screen.getByRole("button", { name: "Insert image" }));
    const dialog = within(screen.getByRole("dialog", { name: "Insert image" }));
    await user.upload(
      dialog.getByLabelText("Choose image"),
      new File(["image"], "choir.png", { type: "image/png" }),
    );
    await user.type(dialog.getByLabelText("Alt text"), "Choir");
    rerender(view("Newer text"));
    await user.click(dialog.getByRole("button", { name: "Insert image" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("page text changed");
    expect(onChange).not.toHaveBeenCalled();
    expect(api.deletePrivateOrganizationFile).toHaveBeenCalledWith(fileId);
  });
  it("uses the current change callback when an upload finishes after other page fields changed", async () => {
    const user = userEvent.setup();
    const { onChange, rerender, view } = editor();
    let finish:
      ((file: Awaited<ReturnType<typeof api.uploadPrivateOrganizationFile>>) => void) | undefined;
    vi.mocked(api.uploadPrivateOrganizationFile).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(screen.getByRole("button", { name: "Insert image" }));
    const dialog = within(screen.getByRole("dialog", { name: "Insert image" }));
    await user.upload(
      dialog.getByLabelText("Choose image"),
      new File(["image"], "choir.png", { type: "image/png" }),
    );
    await user.type(dialog.getByLabelText("Alt text"), "Choir");
    await user.click(dialog.getByRole("button", { name: "Insert image" }));
    const currentChange = vi.fn();
    rerender(view("Before\n\n", currentChange));
    if (!finish) throw new Error("Upload did not start");
    finish({
      id: fileId,
      fileName: "choir.png",
      contentType: "image/png",
      sizeBytes: 8,
      uploadedAt: "2026-11-01T00:00:00Z",
      requestId: "11111111-1111-4111-8111-111111111111",
    });
    await waitFor(() => {
      expect(currentChange).toHaveBeenCalledWith(`Before\n\n![Choir](choir-image:${fileId})`);
    });
    expect(onChange).not.toHaveBeenCalled();
  });
  it("keeps upload failures editable and cancellation leaves content untouched", async () => {
    const user = userEvent.setup();
    const { onChange } = editor();
    vi.mocked(api.uploadPrivateOrganizationFile).mockRejectedValue(new Error("offline"));
    await user.click(screen.getByRole("button", { name: "Insert image" }));
    const dialog = within(screen.getByRole("dialog", { name: "Insert image" }));
    await user.upload(
      dialog.getByLabelText("Choose image"),
      new File(["image"], "choir.png", { type: "image/png" }),
    );
    await user.type(dialog.getByLabelText("Alt text"), "Choir");
    await user.click(dialog.getByRole("button", { name: "Insert image" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be inserted");
    expect(dialog.getByLabelText("Alt text")).toHaveValue("Choir");
    expect(onChange).not.toHaveBeenCalled();
  });
});
