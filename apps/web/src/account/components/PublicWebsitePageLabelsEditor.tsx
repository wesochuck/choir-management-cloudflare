import type { PublicWebsiteSettingsRequest } from "@choir/contracts";

const pages = [
  ["performances", "Performances", "Performances"],
  ["history", "History", "Our History"],
  ["tickets", "Tickets", "Tickets"],
  ["donations", "Donate", "Donate"],
  ["auditions", "Auditions", "Audition Inquiry"],
] as const;

export function PublicWebsitePageLabelsEditor({
  draft,
  busy,
  onChange,
}: {
  readonly draft: PublicWebsiteSettingsRequest;
  readonly busy: boolean;
  readonly onChange: (labels: NonNullable<PublicWebsiteSettingsRequest["pageLabels"]>) => void;
}) {
  return (
    <fieldset className="form-stack" disabled={busy}>
      <legend>Public page names</legend>
      <p className="field-help">
        Customize navigation labels and page headings independently. Leave a field blank to keep its
        default. Existing page addresses stay the same.
      </p>
      {pages.map(([page, label, heading]) => (
        <div className="form-grid" key={page}>
          {(["navigationLabel", "heading"] as const).map((field) => (
            <label className="field" key={field}>
              {label} {field === "heading" ? "page heading" : "navigation label"}
              <input
                value={draft.pageLabels?.[page]?.[field] ?? ""}
                maxLength={field === "heading" ? 120 : 60}
                placeholder={
                  field === "heading"
                    ? page === "donations" || page === "auditions"
                      ? "Use existing page heading"
                      : heading
                    : label
                }
                onChange={(event) => {
                  onChange({
                    ...draft.pageLabels,
                    [page]: {
                      ...draft.pageLabels?.[page],
                      [field]: event.target.value.trim() ? event.target.value : undefined,
                    },
                  });
                }}
              />
            </label>
          ))}
        </div>
      ))}
    </fieldset>
  );
}
