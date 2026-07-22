import type { MemberProfile, OrganizationDirectoryProfile } from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";

import {
  AuthApiError,
  deleteOrganizationProfilePhoto,
  getMemberProfile,
  listOrganizationDirectory,
  updateMemberProfile,
  setOrganizationProfilePhoto,
  uploadPrivateOrganizationFile,
} from "../auth/api";

type ProfileState =
  | { readonly status: "error" | "loading" | "missing" }
  | { readonly profile: MemberProfile; readonly status: "ready" };

type DirectoryState =
  | { readonly status: "error" | "loading" }
  | { readonly profiles: readonly OrganizationDirectoryProfile[]; readonly status: "ready" };

function ProfilePhotoEditor({
  onChanged,
  profile,
}: {
  readonly onChanged: (fileId: string | null) => void;
  readonly profile: MemberProfile;
}) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function savePhoto(): Promise<void> {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage("Profile photos may not exceed 5 MB.");
      return;
    }
    setBusy(true);
    setMessage(null);
    let uploadedFileId: string | null = null;
    try {
      uploadedFileId = (await uploadPrivateOrganizationFile(file)).id;
      await setOrganizationProfilePhoto(profile.id, uploadedFileId);
      setFile(null);
      setMessage("Your Profile photo was updated.");
      onChanged(uploadedFileId);
    } catch (error: unknown) {
      if (uploadedFileId) {
        await fetch(`/api/organization/files/${encodeURIComponent(uploadedFileId)}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
      setMessage(
        error instanceof AuthApiError ? error.message : "Your photo could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(): Promise<void> {
    if (!profile.photoFileId || !window.confirm("Remove your Profile photo?")) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteOrganizationProfilePhoto(profile.id);
      setMessage("Your Profile photo was removed.");
      onChanged(null);
    } catch (error: unknown) {
      setMessage(
        error instanceof AuthApiError ? error.message : "Your photo could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-stack profile-photo-controls">
      <div className="profile-photo">
        {profile.photoFileId ? (
          <img
            alt={`${profile.displayName} Profile`}
            src={`/api/organization/files/${encodeURIComponent(profile.photoFileId)}`}
          />
        ) : (
          <span aria-hidden="true">{profile.displayName.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <label className="field">
        Profile photo
        <input
          accept="image/jpeg,image/png,image/webp"
          type="file"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
          }}
        />
      </label>
      <div className="button-row">
        <button disabled={busy || !file} onClick={() => void savePhoto()} type="button">
          Upload photo
        </button>
        {profile.photoFileId ? (
          <button disabled={busy} onClick={() => void removePhoto()} type="button">
            Remove photo
          </button>
        ) : null}
      </div>
      <p className="field-help">JPEG, PNG, or WebP; up to 5 MB.</p>
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}

function MemberProfileEditor({
  enabled,
  onSaved,
}: {
  readonly enabled: boolean;
  readonly onSaved: () => void;
}) {
  const [state, setState] = useState<ProfileState>({ status: "loading" });
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [showInDirectory, setShowInDirectory] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    getMemberProfile(controller.signal)
      .then((profile) => {
        setState({ profile, status: "ready" });
        setDisplayName(profile.displayName);
        setPhone(profile.phone);
        setShowInDirectory(profile.showInDirectory);
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

  async function save(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const profile = await updateMemberProfile({ displayName, phone, showInDirectory });
      setState({ profile, status: "ready" });
      setDisplayName(profile.displayName);
      setPhone(profile.phone);
      setShowInDirectory(profile.showInDirectory);
      setMessage("Your Organization Profile was updated.");
      onSaved();
    } catch (error: unknown) {
      setMessage(
        error instanceof AuthApiError ? error.message : "Your Profile could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-section" aria-labelledby="member-profile-title">
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Membership identity</p>
        <h2 id="member-profile-title">My Organization Profile</h2>
      </div>
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
      {enabled && state.status === "ready" ? (
        <form
          className="form-stack member-profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="profile-facts" aria-label="Organization Profile details">
            <p>
              <strong>Email:</strong> {state.profile.email}
            </p>
            <p>
              <strong>Voice part:</strong> {state.profile.voicePart || "Not assigned"}
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
          <label className="field">
            Display name
            <input
              maxLength={200}
              required
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
              }}
            />
          </label>
          <label className="field">
            Phone
            <input
              autoComplete="tel"
              maxLength={50}
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
              }}
            />
          </label>
          <label className="checkbox-row">
            <input
              checked={showInDirectory}
              type="checkbox"
              onChange={(event) => {
                setShowInDirectory(event.target.checked);
              }}
            />
            Show me in the Organization directory
          </label>
          <p className="field-help">
            Change your sign-in email from account security. Organization managers control voice
            part and lifecycle status.
          </p>
          <button className="button button--primary" disabled={busy} type="submit">
            {busy ? "Saving Profile…" : "Save my Profile"}
          </button>
          {message ? (
            <p
              className={
                message.includes("updated") ? "notice notice--success" : "notice notice--error"
              }
              role="status"
            >
              {message}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

function Directory({
  enabled,
  revision,
}: {
  readonly enabled: boolean;
  readonly revision: number;
}) {
  const [state, setState] = useState<DirectoryState>({ status: "loading" });
  const [search, setSearch] = useState("");
  const [voicePart, setVoicePart] = useState("");

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
    <section className="account-section" aria-labelledby="organization-directory-title">
      <div className="section-heading section-heading--compact">
        <p className="eyebrow">Member contacts</p>
        <h2 id="organization-directory-title">Organization directory</h2>
      </div>
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
                placeholder="Name, voice part, phone, or email"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
            </label>
            <label className="field">
              Voice part
              <select
                value={voicePart}
                onChange={(event) => {
                  setVoicePart(event.target.value);
                }}
              >
                <option value="">All voice parts</option>
                {voiceParts.map((part) => (
                  <option key={part} value={part}>
                    {part}
                  </option>
                ))}
              </select>
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
                  <p>{profile.voicePart || "Voice part not assigned"}</p>
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

export function MemberProfileDirectory({ enabled }: { readonly enabled: boolean }) {
  const [revision, setRevision] = useState(0);
  return (
    <>
      <MemberProfileEditor
        enabled={enabled}
        onSaved={() => {
          setRevision((current) => current + 1);
        }}
      />
      <Directory enabled={enabled} revision={revision} />
    </>
  );
}
