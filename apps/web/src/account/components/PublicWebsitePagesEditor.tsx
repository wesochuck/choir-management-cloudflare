import type { PublicWebsitePage } from "@choir/contracts";
import { useConfirmation } from "@choir/ui";
import { useRef } from "react";
import { MarkdownToolbar } from "./MarkdownToolbar";

export function PublicWebsitePagesEditor({
  pages,
  savedIds,
  selectedId,
  onSelect,
  onChange,
  busy,
  home,
  onManageDocuments,
  manualSlugs,
  onManualSlugEdit,
}: {
  readonly manualSlugs: ReadonlySet<string>;
  readonly onManualSlugEdit: (id: string) => void;
  readonly pages: readonly PublicWebsitePage[];
  readonly savedIds: ReadonlySet<string>;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly onChange: (pages: PublicWebsitePage[]) => void;
  readonly busy: boolean;
  readonly home: React.ReactNode;
  readonly onManageDocuments: () => Promise<boolean>;
}) {
  const { confirm, confirmationDialog } = useConfirmation();
  const titleRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const page = pages.find((item) => item.id === selectedId);
  function update(next: PublicWebsitePage) {
    onChange(pages.map((item) => (item.id === next.id ? next : item)));
  }
  return (
    <div className="form-stack">
      {confirmationDialog}
      <div className="website-page-selector">
        <label className="field">
          Page
          <select
            aria-label="Page"
            disabled={busy}
            value={page?.id ?? "home"}
            onChange={(event) => {
              onSelect(event.target.value);
            }}
          >
            <option value="home">Home</option>
            {pages.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title || "Untitled page"}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button button--secondary button--control-height"
          disabled={busy || pages.length >= 50}
          type="button"
          onClick={() => {
            const next = {
              id: crypto.randomUUID(),
              title: "",
              slug: "",
              body: "",
              showInNavigation: true,
            };
            onChange([...pages, next]);
            onSelect(next.id);
            requestAnimationFrame(() => {
              titleRef.current?.focus();
            });
          }}
        >
          Add page
        </button>
      </div>
      {page ? (
        <>
          <h2>Edit page</h2>
          <label className="field">
            Page title
            <input
              ref={titleRef}
              disabled={busy}
              maxLength={120}
              value={page.title}
              onChange={(event) => {
                const title = event.target.value;
                const derive = !savedIds.has(page.id) && !manualSlugs.has(page.id);
                update({
                  ...page,
                  title,
                  ...(derive
                    ? {
                        slug: title
                          .toLowerCase()
                          .normalize("NFKD")
                          .replace(/[\u0300-\u036f]/g, "")
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/^-|-$/g, "")
                          .slice(0, 120),
                      }
                    : {}),
                });
              }}
            />
          </label>
          <label className="field">
            URL
            <div className="website-page-url">
              <span>/</span>
              <input
                aria-label="Page URL"
                disabled={busy || savedIds.has(page.id)}
                maxLength={120}
                value={page.slug}
                onChange={(event) => {
                  onManualSlugEdit(page.id);
                  update({ ...page, slug: event.target.value });
                }}
              />
            </div>
          </label>
          <p className="field-help">
            {savedIds.has(page.id)
              ? "This URL is fixed after the first save to preserve existing links."
              : "Use a short, descriptive address. The URL becomes fixed after saving."}
          </p>
          {page.navigationLabel !== undefined ? (
            <label className="field">
              Navigation label
              <input
                disabled={busy}
                value={page.navigationLabel}
                maxLength={60}
                onChange={(event) => {
                  update({
                    ...page,
                    navigationLabel: event.target.value || page.title.slice(0, 60),
                  });
                }}
              />
            </label>
          ) : null}
          <div className="field">
            <label htmlFor="website-page-body">Content (Markdown)</label>
            <MarkdownToolbar
              textareaRef={textareaRef}
              value={page.body}
              onManageDocuments={onManageDocuments}
              onChange={(body) => {
                update({ ...page, body });
              }}
            />
            <textarea
              id="website-page-body"
              ref={textareaRef}
              rows={12}
              maxLength={100_000}
              disabled={busy}
              value={page.body}
              onChange={(event) => {
                update({ ...page, body: event.target.value });
              }}
            />
            <p className="field-help">
              Empty pages can be saved but have no public route or menu link until they contain
              text.
            </p>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={page.showInNavigation}
              disabled={busy}
              onChange={(event) => {
                update({ ...page, showInNavigation: event.target.checked });
              }}
            />
            Show in navigation
          </label>
          <p className="field-help">
            Hidden menu links remain publicly accessible by URL after publication.
          </p>
          <button
            type="button"
            className="button button--secondary button--sm website-page-remove"
            disabled={busy}
            onClick={() => {
              void confirm({
                title: "Remove page?",
                description:
                  "The live page will disappear only after you save and publish this draft.",
                destructive: true,
                confirmLabel: "Remove page",
              }).then((accepted) => {
                if (accepted) {
                  onChange(pages.filter((item) => item.id !== page.id));
                  onSelect("home");
                }
              });
            }}
          >
            Remove page
          </button>
        </>
      ) : (
        home
      )}
    </div>
  );
}
