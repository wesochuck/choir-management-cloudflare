import type { OrganizationEvent, TicketBundle } from "@choir/contracts";
import { Dialog } from "@choir/ui";
import type { Dispatch, SetStateAction, SyntheticEvent } from "react";
import { money } from "./shared";

export function BundlePanel({
  bundleCapacity,
  bundleDialogOpen,
  bundleEventIds,
  bundleIsActive,
  bundlePrice,
  bundleSaleEnd,
  bundleTitle,
  bundles,
  busy,
  closeBundleDialog,
  editBundle,
  editingBundleId,
  openNewBundle,
  removeBundle,
  saveBundle,
  setBundleCapacity,
  setBundleEventIds,
  setBundleIsActive,
  setBundlePrice,
  setBundleSaleEnd,
  setBundleTitle,
  ticketEvents,
}: {
  readonly bundleCapacity: string;
  readonly bundleDialogOpen: boolean;
  readonly bundleEventIds: readonly string[];
  readonly bundleIsActive: boolean;
  readonly bundlePrice: string;
  readonly bundleSaleEnd: string;
  readonly bundleTitle: string;
  readonly bundles: readonly TicketBundle[];
  readonly busy: boolean;
  readonly closeBundleDialog: () => void;
  readonly editBundle: (bundle: TicketBundle) => void;
  readonly editingBundleId: string | null;
  readonly openNewBundle: () => void;
  readonly removeBundle: (bundleId: string) => Promise<void>;
  readonly saveBundle: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
  readonly setBundleCapacity: Dispatch<SetStateAction<string>>;
  readonly setBundleEventIds: Dispatch<SetStateAction<readonly string[]>>;
  readonly setBundleIsActive: Dispatch<SetStateAction<boolean>>;
  readonly setBundlePrice: Dispatch<SetStateAction<string>>;
  readonly setBundleSaleEnd: Dispatch<SetStateAction<string>>;
  readonly setBundleTitle: Dispatch<SetStateAction<string>>;
  readonly ticketEvents: readonly OrganizationEvent[];
}) {
  return (
    <div
      aria-labelledby="ticketing-bundles-tab"
      className="split-panel"
      id="ticketing-bundles-panel"
      role="tabpanel"
    >
      <div>
        <h3>Ticket bundles</h3>
        <p>Create a bundle, pass, or ticket tier for one or more performances.</p>
        <button className="button button--primary" onClick={openNewBundle} type="button">
          New ticket bundle
        </button>
      </div>
      <Dialog
        description="Set pricing, capacity, sale timing, and included performances."
        onClose={closeBundleDialog}
        open={bundleDialogOpen}
        title={editingBundleId ? "Edit ticket bundle" : "New ticket bundle"}
      >
        <form className="form-stack" onSubmit={(formEvent) => void saveBundle(formEvent)}>
          <h3>{editingBundleId ? "Edit ticket bundle" : "New ticket bundle"}</h3>
          <label className="field">
            Bundle title
            <input
              required
              maxLength={500}
              value={bundleTitle}
              onChange={(event) => {
                setBundleTitle(event.target.value);
              }}
            />
          </label>
          <div className="form-grid form-grid--two">
            <label className="field">
              Price (USD)
              <input
                required
                min="0"
                step="0.01"
                type="number"
                value={bundlePrice}
                onChange={(event) => {
                  setBundlePrice(event.target.value);
                }}
              />
            </label>
            <label className="field">
              Capacity (blank is unlimited)
              <input
                min="1"
                step="1"
                type="number"
                value={bundleCapacity}
                onChange={(event) => {
                  setBundleCapacity(event.target.value);
                }}
              />
            </label>
          </div>
          <label className="field">
            Sale ends
            <input
              required
              type="datetime-local"
              value={bundleSaleEnd}
              onChange={(event) => {
                setBundleSaleEnd(event.target.value);
              }}
            />
          </label>
          <label>
            <input
              checked={bundleIsActive}
              type="checkbox"
              onChange={(event) => {
                setBundleIsActive(event.target.checked);
              }}
            />{" "}
            Active for public sale
          </label>
          <fieldset className="field">
            <legend>Included performances</legend>
            {ticketEvents.length === 0 ? <p>Create ticketed performances first.</p> : null}
            {ticketEvents.map((event) => (
              <label key={event.id}>
                <input
                  checked={bundleEventIds.includes(event.id)}
                  type="checkbox"
                  onChange={(change) => {
                    setBundleEventIds((current) =>
                      change.target.checked
                        ? [...current, event.id]
                        : current.filter((id) => id !== event.id),
                    );
                  }}
                />{" "}
                {event.title}
              </label>
            ))}
          </fieldset>
          <div className="form-actions">
            <button
              className="button button--primary"
              disabled={busy || bundleEventIds.length === 0}
              type="submit"
            >
              {busy ? "Saving…" : "Save bundle"}
            </button>
            {editingBundleId ? (
              <button
                className="button button--secondary"
                disabled={busy}
                onClick={closeBundleDialog}
                type="button"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </Dialog>
      <div>
        {bundles.length === 0 ? <p>No bundles yet.</p> : null}
        {bundles.map((bundle) => (
          <article className="compact-card" key={bundle.id}>
            <h4>{bundle.title}</h4>
            <p>
              {money(bundle.priceCents)} · {bundle.eventIds.length} performance
              {bundle.eventIds.length === 1 ? "" : "s"} · {bundle.isActive ? "active" : "inactive"}
            </p>
            <div className="form-actions">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  editBundle(bundle);
                }}
                type="button"
              >
                Edit
              </button>
              <button
                className="text-button text-button--danger"
                disabled={busy}
                onClick={() => void removeBundle(bundle.id)}
                type="button"
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
