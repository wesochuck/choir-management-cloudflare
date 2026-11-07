import { Dialog } from "@choir/ui";
import { useEffect, useId, useState } from "react";
import { OrganizationFeatureIcon } from "../../organizationFeatures/OrganizationFeatureIcon";
import type { OrganizationIconId } from "../../organizationFeatures/icons";
import type { Workspace } from "./types";
import { workspaceLabel } from "./utils";

const workspaceDetails: Record<
  Workspace,
  { readonly description: string; readonly icon: OrganizationIconId }
> = {
  organization: { description: "Manage the chorus", icon: "roster" },
  member: { description: "Schedule, music, and RSVPs", icon: "home" },
  account: { description: "Profile and sign-in settings", icon: "settings" },
  platform: { description: "Manage the platform", icon: "settings" },
};

export interface MobileWorkspaceChooserProps {
  readonly options: readonly Workspace[];
  readonly selected: Workspace;
  readonly onSwitch: (workspace: Workspace) => void;
}

export function MobileWorkspaceChooser({
  options,
  selected,
  onSwitch,
}: MobileWorkspaceChooserProps) {
  const headingId = useId();
  const displayOrder: readonly Workspace[] = ["organization", "member", "account", "platform"];
  return (
    <section className="mobile-workspace-chooser" aria-labelledby={headingId}>
      <h2 id={headingId}>Switch workspace</h2>
      <div className="mobile-workspace-chooser__options">
        {displayOrder
          .filter((workspace) => options.includes(workspace))
          .map((workspace) => (
            <button
              aria-current={workspace === selected ? "true" : undefined}
              className="mobile-workspace-chooser__option"
              key={workspace}
              onClick={() => {
                if (workspace !== selected) onSwitch(workspace);
              }}
              type="button"
            >
              <OrganizationFeatureIcon
                className="mobile-workspace-chooser__icon"
                iconId={workspaceDetails[workspace].icon}
              />
              <span className="mobile-workspace-chooser__copy">
                <span className="mobile-workspace-chooser__label">{workspaceLabel(workspace)}</span>
                <span className="mobile-workspace-chooser__description">
                  {workspaceDetails[workspace].description}
                </span>
              </span>
              {workspace === selected ? (
                <span className="mobile-workspace-chooser__current">
                  <span aria-hidden="true">✓</span>
                  <span className="sr-only">Current workspace</span>
                </span>
              ) : null}
            </button>
          ))}
      </div>
    </section>
  );
}

/** Account and Platform pages have no bottom navigation to host More. */
export function MobileWorkspaceMore(props: MobileWorkspaceChooserProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 48rem)");
    const closeOnDesktop = () => {
      if (!phone.matches) setOpen(false);
    };
    phone.addEventListener("change", closeOnDesktop);
    return () => {
      phone.removeEventListener("change", closeOnDesktop);
    };
  }, []);
  return (
    <>
      <button
        className="button button--secondary mobile-workspace-more-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        More
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="More"
        dirty={false}
        className="mobile-member-sheet"
      >
        <MobileWorkspaceChooser {...props} />
      </Dialog>
    </>
  );
}
