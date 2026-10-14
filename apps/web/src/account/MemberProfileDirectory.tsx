import type { MemberProfile, OrganizationDirectoryProfile } from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";

import {
  AuthApiError,
  getMemberProfile,
  listOrganizationDirectory,
  requestMemberEmailChange,
  updateMemberProfile,
} from "../api";
import { AppLink } from "./components/AuthenticatedShell/navigation";
import { ProfilePhotoEditor, type ProfilePhotoTarget } from "./components/ProfilePhotoEditor";
import { useOrganizationTerminology } from "./organizationTerminologyContext";
import { usePersistedDraft } from "../persistence";

export { ProfilePhotoEditor, type ProfilePhotoTarget };

type ProfileState =
  | { readonly status: "error" | "loading" | "missing" }
  | { readonly profile: MemberProfile; readonly status: "ready" };

type EmailChangeMessage = {
  readonly status: "error" | "success";
  readonly targetEmail?: string;
  readonly text: string;
} | null;

type DirectoryState =
  | { readonly status: "error" | "loading" }
  | { readonly profiles: readonly OrganizationDirectoryProfile[]; readonly status: "ready" };

interface ProfileDraft {
  displayName: string;
  phone: string;
  receiveOtherEventReminders: boolean;
  receivePerformanceReminders: boolean;
  receiveRehearsalReminders: boolean;
  showInDirectory: boolean;
}

// eslint-disable-next-line complexity -- the editor coordinates Profile fields and the verified email-change request state.
function MemberProfileEditor({
  enabled,
  onSaved,
}: {
  readonly enabled: boolean;
  readonly onSaved: () => void;
}) {
  const { partLabel } = useOrganizationTerminology();
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  const [initialDraft, setInitialDraft] = useState<ProfileDraft | null>(null);
  const [email, setEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState<EmailChangeMessage>(null);
  const [message, setMessage] = useState<string | null>(null);

  const {
    draft,
    error: draftError,
    saving: busy,
    updateField,
  } = usePersistedDraft<ProfileDraft>({
    initialValue: initialDraft,
    onSaveSuccess: (saved) => {
      setState((current) =>
        current.status === "ready"
          ? {
              profile: {
                ...current.profile,
                displayName: saved.displayName,
                phone: saved.phone,
                receiveOtherEventReminders: saved.receiveOtherEventReminders,
                receivePerformanceReminders: saved.receivePerformanceReminders,
                receiveRehearsalReminders: saved.receiveRehearsalReminders,
                showInDirectory: saved.showInDirectory,
              },
              status: "ready",
            }
          : current,
      );
      setMessage("Your Organization Profile was updated.");
      onSaved();
    },
    resourceKey: "member-profile-editor",
    save: async (currentDraft) => {
      const updated = await updateMemberProfile(currentDraft);
      return {
        displayName: updated.displayName,
        phone: updated.phone,
        receiveOtherEventReminders: updated.receiveOtherEventReminders,
        receivePerformanceReminders: updated.receivePerformanceReminders,
        receiveRehearsalReminders: updated.receiveRehearsalReminders,
        showInDirectory: updated.showInDirectory,
      };
    },
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getMemberProfile(controller.signal)
      .then((profile) => {
        setState({ profile, status: "ready" });
        setEmail(profile.email);
        setInitialDraft({
          displayName: profile.displayName,
          phone: profile.phone,
          receiveOtherEventReminders: profile.receiveOtherEventReminders,
          receivePerformanceReminders: profile.receivePerformanceReminders,
          receiveRehearsalReminders: profile.receiveRehearsalReminders,
          showInDirectory: profile.showInDirectory,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState(
          error instanceof AuthApiError && error.status === 404
            ? { status: "missing" }
            : { status: "error" },
        );
      });
    return () => {
      controller.abort();
    };
  }, [enabled]);

  async function requestEmailChange(): Promise<void> {
    if (state.status !== "ready") return;
    const trimmed = email.trim();
    if (!trimmed.includes("@")) {
      setEmailMessage({
        status: "error",
        text: "Enter a valid new email address.",
      });
      return;
    }
    if (trimmed.toLowerCase() === state.profile.email.toLowerCase()) {
      setEmailMessage({
        status: "error",
        text: "Choose a different email address before requesting a change.",
      });
      return;
    }
    setEmailBusy(true);
    setEmailMessage(null);
    try {
      const requestedEmail = await requestMemberEmailChange(trimmed);
      setEmailMessage({
        status: "success",
        targetEmail: requestedEmail,
        text: `We sent a confirmation link to ${requestedEmail}. Open that email and click the confirmation link within 30 minutes to complete the change. Your current sign-in remains active until confirmed. If you made a mistake or want to cancel, enter a different address above or let the link expire.`,
      });
    } catch (error: unknown) {
      setEmailMessage({
        status: "error",
        text:
          error instanceof AuthApiError
            ? error.message
            : "The email change could not be started. Please try again.",
      });
    } finally {
      setEmailBusy(false);
    }
  }

  const effectiveMessage = draftError ?? message;

  return (
    <section className="account-section" aria-label="My Organization Profile">
      {!enabled || state.status === "loading" ? <p>Loading your Profile…</p> : null}
      {enabled && state.status === "missing" ? (
        <p className="empty-state">
          Ask an Organization Owner or Administrator to link this Membership to a Profile.
        </p>
      ) : null}
      {enabled && state.status === "error" ? (
        <p className="notice notice--error" role="alert">
          Your Organization Profile could not be loaded.
        </p>
      ) : null}
      {enabled && state.status === "ready" && draft ? (
        <div className="form-stack member-profile-form">
          <div className="profile-facts" aria-label="Organization Profile details">
            <p>
              <strong>Current sign-in email:</strong> {state.profile.email}
            </p>
            <p>
              <strong>{partLabel}:</strong> {state.profile.voicePart || "Not assigned"}
            </p>
            <p>
              <strong>Status:</strong>{" "}
              {state.profile.globalStatus === "Idle" ? "On Break" : state.profile.globalStatus}
            </p>
          </div>
          <ProfilePhotoEditor
            profile={state.profile}
            onChanged={(photoFileId) => {
              setState({
                profile: { ...state.profile, photoFileId },
                status: "ready",
              });
              onSaved();
            }}
          />
          <div className="field">
            <label htmlFor="member-email">New sign-in email</label>
            <input
              aria-describedby={
                emailMessage ? "member-email-help member-email-status" : "member-email-help"
              }
              autoComplete="email"
              id="member-email"
              maxLength={320}
              required
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (emailMessage?.status === "error") {
                  setEmailMessage(null);
                }
              }}
            />
            <p className="field-help" id="member-email-help">
              Enter your new sign-in address. We'll send a confirmation link there and a security
              notice to your current address. Your sign-in stays on your current address until
              confirmed. Once confirmed, this also updates where you receive choir communications.
            </p>
            <button
              className="button button--secondary"
              disabled={
                emailBusy ||
                (emailMessage?.status === "success" &&
                  emailMessage.targetEmail?.toLowerCase() === email.trim().toLowerCase())
              }
              onClick={() => void requestEmailChange()}
              type="button"
            >
              {emailBusy
                ? "Sending confirmation…"
                : emailMessage?.status === "success" &&
                    emailMessage.targetEmail?.toLowerCase() === email.trim().toLowerCase()
                  ? "Confirmation link sent"
                  : "Change email"}
            </button>
            {emailMessage ? (
              <p
                className={`notice notice--${emailMessage.status}`}
                id="member-email-status"
                role={emailMessage.status === "error" ? "alert" : "status"}
              >
                {emailMessage.text}
              </p>
            ) : null}
          </div>
          <label className="field">
            Display name
            <input
              disabled={busy}
              maxLength={200}
              required
              value={draft.displayName}
              onChange={(event) => {
                updateField("displayName", event.target.value);
              }}
            />
          </label>
          <label className="field">
            Phone
            <input
              autoComplete="tel"
              disabled={busy}
              maxLength={50}
              value={draft.phone}
              onChange={(event) => {
                updateField("phone", event.target.value);
              }}
            />
          </label>
          <label className="checkbox-row">
            <input
              checked={draft.showInDirectory}
              disabled={busy}
              type="checkbox"
              onChange={(event) => {
                updateField("showInDirectory", event.target.checked);
              }}
            />
            Show me in the Organization directory
          </label>
          <fieldset className="field" disabled={busy}>
            <legend>Email reminder preferences</legend>
            <p className="field-help" id="reminder-preferences-help">
              Choose which automatic event reminders you receive, currently scheduled about 48 hours
              before an event. Turning off a reminder does not change your RSVP or remove the event
              from your schedule. Organization-wide opt-outs, suppressions, and email bounces still
              take precedence.
            </p>
            <label className="checkbox-row">
              <input
                aria-describedby="reminder-preferences-help"
                checked={draft.receiveRehearsalReminders}
                type="checkbox"
                onChange={(event) => {
                  updateField("receiveRehearsalReminders", event.target.checked);
                }}
              />
              Rehearsal reminders — Email me before upcoming rehearsals.
            </label>
            <label className="checkbox-row">
              <input
                aria-describedby="reminder-preferences-help"
                checked={draft.receivePerformanceReminders}
                type="checkbox"
                onChange={(event) => {
                  updateField("receivePerformanceReminders", event.target.checked);
                }}
              />
              Performance reminders — Email me before upcoming concerts and performances.
            </label>
            <label className="checkbox-row">
              <input
                aria-describedby="reminder-preferences-help"
                checked={draft.receiveOtherEventReminders}
                type="checkbox"
                onChange={(event) => {
                  updateField("receiveOtherEventReminders", event.target.checked);
                }}
              />
              Other Event reminders — Email me about Other Events where I am invited to respond or
              have volunteered.
            </label>
          </fieldset>
          <p className="field-help">
            Organization managers control {partLabel.toLowerCase()} assignments and lifecycle
            status.
          </p>
          {effectiveMessage ? (
            <p
              className={
                effectiveMessage.includes("updated")
                  ? "notice notice--success"
                  : "notice notice--error"
              }
              role="status"
            >
              {effectiveMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Directory({
  adminReturnTo,
  enabled,
  navigate,
  revision,
}: {
  readonly adminReturnTo?: string | null | undefined;
  readonly enabled: boolean;
  readonly navigate?: ((href: string) => void) | undefined;
  readonly revision: number;
}) {
  const { partLabel, partLabelPlural } = useOrganizationTerminology();
  const [state, setState] = useState<DirectoryState>({ status: "loading" });
  const [search, setSearch] = useState("");
  const [voicePart, setVoicePart] = useState("");
  const handleNavigate =
    navigate ??
    ((href: string) => {
      window.location.assign(href);
    });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    listOrganizationDirectory(controller.signal)
      .then((profiles) => {
        setState({ profiles, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, [enabled, revision]);

  const voiceParts = useMemo(
    () =>
      state.status === "ready"
        ? [...new Set(state.profiles.map(({ voicePart: value }) => value).filter(Boolean))].sort()
        : [],
    [state],
  );
  const profiles = useMemo(() => {
    if (state.status !== "ready") return [];
    const needle = search.trim().toLocaleLowerCase();
    return state.profiles.filter((profile) => {
      if (voicePart && profile.voicePart !== voicePart) return false;
      return (
        !needle ||
        [profile.displayName, profile.email, profile.phone, profile.voicePart]
          .join(" ")
          .toLocaleLowerCase()
          .includes(needle)
      );
    });
  }, [search, state, voicePart]);

  return (
    <section className="account-section" aria-label="Organization directory">
      {adminReturnTo ? (
        <aside
          aria-label="Admin navigation context"
          className="admin-return-bar notice notice--info"
        >
          <span className="admin-return-bar__text">Viewing member Directory</span>
          <span aria-hidden="true" className="admin-return-bar__separator">
            {" "}
            ·{" "}
          </span>
          <AppLink
            className="button button--secondary button--small admin-return-bar__action"
            href={adminReturnTo}
            onNavigate={handleNavigate}
          >
            Back to Admin
          </AppLink>
        </aside>
      ) : null}
      {!enabled || state.status === "loading" ? <p>Loading the directory…</p> : null}
      {enabled && state.status === "error" ? (
        <p className="notice notice--error" role="alert">
          The Organization directory could not be loaded.
        </p>
      ) : null}
      {enabled && state.status === "ready" ? (
        <>
          <div className="directory-filters">
            <label className="field">
              Search directory
              <input
                placeholder={`Name, ${partLabel.toLowerCase()}, phone, or email`}
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
            </label>
            <label className="field">
              {partLabel}
              <select
                aria-describedby="directory-part-filter-help"
                aria-label={partLabel}
                value={voicePart}
                onChange={(event) => {
                  setVoicePart(event.target.value);
                }}
              >
                <option value="">All {partLabelPlural.toLowerCase()}</option>
                {voiceParts.map((part) => (
                  <option key={part} value={part}>
                    {part}
                  </option>
                ))}
              </select>
              <span className="field-help" id="directory-part-filter-help">
                Only {partLabelPlural.toLowerCase()} with listed members appear.
              </span>
            </label>
          </div>
          {profiles.length === 0 ? (
            <p className="empty-state">No opted-in Profiles match these directory filters.</p>
          ) : (
            <ul className="directory-grid">
              {profiles.map((profile) => (
                <li key={profile.id} aria-label={`Directory Profile: ${profile.displayName}`}>
                  <div className="profile-photo profile-photo--directory">
                    {profile.photoFileId ? (
                      <img
                        alt=""
                        src={`/api/organization/files/${encodeURIComponent(profile.photoFileId)}`}
                      />
                    ) : (
                      <span aria-hidden="true">
                        {profile.displayName.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <h3>{profile.displayName}</h3>
                  <p>{profile.voicePart || `${partLabel} not assigned`}</p>
                  <p>
                    Email:{" "}
                    {profile.email ? (
                      <a href={`mailto:${profile.email}`}>{profile.email}</a>
                    ) : (
                      "Not listed"
                    )}
                  </p>
                  <p>
                    Phone:{" "}
                    {profile.phone ? (
                      <a href={`tel:${profile.phone}`}>{profile.phone}</a>
                    ) : (
                      "Not listed"
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}

export function MemberProfileDirectory({
  adminReturnTo,
  enabled,
  navigate,
  view = "both",
}: {
  readonly adminReturnTo?: string | null | undefined;
  readonly enabled: boolean;
  readonly navigate?: ((href: string) => void) | undefined;
  readonly view?: "both" | "directory" | "profile";
}) {
  const [revision, setRevision] = useState(0);
  return (
    <>
      {view !== "directory" ? (
        <MemberProfileEditor
          enabled={enabled}
          onSaved={() => {
            setRevision((current) => current + 1);
          }}
        />
      ) : null}
      {view !== "profile" ? (
        <Directory
          adminReturnTo={adminReturnTo}
          enabled={enabled}
          navigate={navigate}
          revision={revision}
        />
      ) : null}
    </>
  );
}
