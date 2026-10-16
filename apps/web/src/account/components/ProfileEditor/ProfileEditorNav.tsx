import type { ReactElement } from "react";
import { TabsList, TabsTrigger } from "@choir/ui";
import type { ProfileTab } from "./types";

export interface ProfileEditorNavProps {
  readonly dirtySections: Readonly<Record<ProfileTab, boolean>>;
  readonly editingId: string | null;
  readonly onValueChange: (tab: ProfileTab) => void;
  readonly value: ProfileTab;
}

interface NavSection {
  readonly icon: (props: { readonly className?: string | undefined }) => ReactElement;
  readonly id: ProfileTab;
  readonly label: string;
}

function UserIcon({ className }: { readonly className?: string | undefined }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function MailIcon({ className }: { readonly className?: string | undefined }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <rect height="16" rx="2" width="20" x="2" y="4" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function CalendarIcon({ className }: { readonly className?: string | undefined }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M8 2v4M16 2v4" />
      <rect height="18" rx="2" width="18" x="3" y="4" />
      <path d="M3 10h18" />
    </svg>
  );
}

function DuesIcon({ className }: { readonly className?: string | undefined }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <rect height="14" rx="2" width="20" x="2" y="5" />
      <path d="M2 10h20" />
    </svg>
  );
}

function FolderIcon({ className }: { readonly className?: string | undefined }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  );
}

function MessageIcon({ className }: { readonly className?: string | undefined }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

const ALL_SECTIONS: readonly NavSection[] = [
  { id: "info", label: "Profile info", icon: UserIcon },
  { id: "email", label: "Email & notifications", icon: MailIcon },
  { id: "performance", label: "Performance RSVPs", icon: CalendarIcon },
  { id: "dues", label: "Dues", icon: DuesIcon },
  { id: "folders", label: "Folder numbers", icon: FolderIcon },
  { id: "messages", label: "Messages", icon: MessageIcon },
];

const VALID_PROFILE_TABS = new Set<string>([
  "dues",
  "email",
  "folders",
  "info",
  "messages",
  "performance",
]);

function isProfileTab(value: string): value is ProfileTab {
  return VALID_PROFILE_TABS.has(value);
}

export function ProfileEditorNav({
  dirtySections,
  editingId,
  onValueChange,
  value,
}: ProfileEditorNavProps) {
  const sections = editingId ? ALL_SECTIONS : ALL_SECTIONS.slice(0, 2);

  return (
    <>
      {/* Mobile synchronized selector */}
      <div className="profile-editor__mobile-nav">
        <label className="profile-editor__mobile-nav-label" htmlFor="profile-editor-section-select">
          Profile section
        </label>
        <select
          aria-label="Profile section"
          className="profile-editor__mobile-nav-select"
          id="profile-editor-section-select"
          onChange={(event) => {
            const nextValue = event.target.value;
            if (isProfileTab(nextValue)) {
              onValueChange(nextValue);
            }
          }}
          value={value}
        >
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.label}
              {dirtySections[section.id] ? " — Unsaved changes" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop vertical section rail */}
      <aside aria-label="Profile section navigation" className="profile-editor__rail">
        <div className="profile-editor__rail-header">Profile sections</div>
        <TabsList aria-label="Profile sections" className="profile-editor__rail-tablist">
          {sections.map((section) => {
            const Icon = section.icon;
            const isActive = value === section.id;
            return (
              <TabsTrigger
                aria-describedby={
                  dirtySections[section.id] ? `roster-profile-${section.id}-unsaved` : undefined
                }
                aria-controls={`roster-profile-${section.id}-panel`}
                className={`profile-editor__rail-trigger ${isActive ? "is-active" : ""}`}
                id={`roster-profile-${section.id}-tab`}
                key={section.id}
                value={section.id}
              >
                <Icon className="profile-editor__rail-icon" />
                <span className="profile-editor__rail-label">{section.label}</span>
                {dirtySections[section.id] ? (
                  <span
                    aria-hidden="true"
                    className="profile-editor__rail-unsaved"
                    id={`roster-profile-${section.id}-unsaved`}
                  >
                    <span className="profile-editor__rail-unsaved-dot" />
                    Unsaved
                  </span>
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <div className="profile-editor__rail-callout">
          <strong>Quick editing</strong>
          <p>Update this profile and return to the list without losing your place.</p>
        </div>
      </aside>
    </>
  );
}
