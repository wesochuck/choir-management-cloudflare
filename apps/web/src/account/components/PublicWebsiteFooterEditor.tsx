import type { PublicWebsiteSettingsRequest } from "@choir/contracts";
import { useRef, useState } from "react";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { importFooterEmbeds } from "./footerEmbedImport";

type FooterEmbed = NonNullable<PublicWebsiteSettingsRequest["footerEmbeds"]>[number];

export function FooterTabContent({
  busy,
  draft,
  onChange,
}: {
  readonly busy: boolean;
  readonly draft: PublicWebsiteSettingsRequest;
  readonly onChange: <K extends keyof PublicWebsiteSettingsRequest>(
    key: K,
    value: PublicWebsiteSettingsRequest[K],
  ) => void;
}) {
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const importRef = useRef<HTMLTextAreaElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const embeds = draft.footerEmbeds ?? [];
  function update(index: number, patch: Partial<FooterEmbed>) {
    onChange(
      "footerEmbeds",
      embeds.map((embed, position) => (position === index ? { ...embed, ...patch } : embed)),
    );
  }
  return (
    <div className="form-stack">
      <p className="field-help">
        Add your Organization’s contact details, acknowledgments, badges, or widgets. The footer
        appears across your public website after you save and publish.
      </p>
      <div className="field">
        <label htmlFor="website-footer-text">Footer text (Markdown)</label>
        <MarkdownToolbar
          textareaRef={textRef}
          value={draft.footerText ?? ""}
          onChange={(text) => {
            onChange("footerText", text);
          }}
        />
        <textarea
          id="website-footer-text"
          ref={textRef}
          rows={5}
          maxLength={10_000}
          disabled={busy}
          value={draft.footerText ?? ""}
          onChange={(event) => {
            onChange("footerText", event.target.value);
          }}
        />
        <p className="field-help">
          Supports paragraphs, bold, italic, and links. Copyright, Privacy, Terms, and your public
          contact link remain included.
        </p>
      </div>
      <div className="field">
        <label htmlFor="website-footer-import">Import embed code</label>
        <textarea
          id="website-footer-import"
          ref={importRef}
          rows={3}
          maxLength={20_000}
          disabled={busy || embeds.length >= 6}
          placeholder="Paste a linked image or iframe snippet, then choose Import embed."
        />
        <p className="field-help">
          Works with each Organization’s own badge or widget, including GuideStar/Candid. Images and
          iframe URLs must use HTTPS. Script-based widgets are not supported.
        </p>
        <button
          className="button button--secondary"
          type="button"
          disabled={busy || embeds.length >= 6}
          onClick={() => {
            const input = importRef.current;
            if (!(input instanceof HTMLTextAreaElement)) return;
            try {
              const imported = importFooterEmbeds(input.value);
              if (embeds.length + imported.length > 6)
                throw new Error("You can add up to six footer embeds.");
              onChange("footerEmbeds", [...embeds, ...imported]);
              input.value = "";
              setImportError(null);
            } catch (error: unknown) {
              setImportError(
                error instanceof Error ? error.message : "The embed could not be imported.",
              );
            }
          }}
        >
          Import embed
        </button>
        {importError ? (
          <p role="alert" className="notice notice--error">
            {importError}
          </p>
        ) : null}
      </div>
      {embeds.map((embed, index) => (
        <fieldset className="website-footer-embed-editor form-stack" key={index} disabled={busy}>
          <legend>Embed {index + 1}</legend>
          <div className="field">
            <label htmlFor={`footer-embed-kind-${String(index)}`}>Embed type</label>
            <select
              id={`footer-embed-kind-${String(index)}`}
              value={embed.kind}
              onChange={(event) => {
                update(index, { kind: event.target.value === "iframe" ? "iframe" : "image" });
              }}
            >
              <option value="image">Image / badge</option>
              <option value="iframe">Iframe widget</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`footer-embed-title-${String(index)}`}>Accessible description</label>
            <input
              id={`footer-embed-title-${String(index)}`}
              maxLength={200}
              value={embed.title}
              onChange={(event) => {
                update(index, { title: event.target.value });
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`footer-embed-src-${String(index)}`}>
              {embed.kind === "image" ? "Image URL" : "Iframe URL"}
            </label>
            <input
              id={`footer-embed-src-${String(index)}`}
              type="url"
              maxLength={2_048}
              value={embed.src}
              onChange={(event) => {
                update(index, { src: event.target.value });
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`footer-embed-link-${String(index)}`}>Link URL (optional)</label>
            <input
              id={`footer-embed-link-${String(index)}`}
              type="url"
              maxLength={2_048}
              value={embed.href}
              onChange={(event) => {
                update(index, { href: event.target.value });
              }}
            />
          </div>
          {embed.kind === "iframe" ? (
            <div className="field">
              <label htmlFor={`footer-embed-height-${String(index)}`}>Widget height (pixels)</label>
              <input
                id={`footer-embed-height-${String(index)}`}
                type="number"
                min={100}
                max={800}
                value={embed.height}
                onChange={(event) => {
                  update(index, { height: Number(event.target.value) });
                }}
              />
              <p className="field-help">
                Some providers block iframe embedding or require permissions this preview does not
                grant. Check the preview before publishing.
              </p>
            </div>
          ) : null}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              onChange(
                "footerEmbeds",
                embeds.filter((_, position) => position !== index),
              );
            }}
          >
            Remove embed {index + 1}
          </button>
        </fieldset>
      ))}
      <button
        className="button button--secondary"
        disabled={busy || embeds.length >= 6}
        type="button"
        onClick={() => {
          onChange("footerEmbeds", [
            ...embeds,
            { kind: "image", title: "", src: "", href: "", height: 240 },
          ]);
        }}
      >
        Add embed
      </button>
    </div>
  );
}
