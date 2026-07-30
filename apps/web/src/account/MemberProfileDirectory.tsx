import type { MemberProfile, OrganizationDirectoryProfile } from "@choir/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AuthApiError,
  deleteOrganizationProfilePhoto,
  getMemberProfile,
  listOrganizationDirectory,
  updateMemberProfile,
  setOrganizationProfilePhoto,
  uploadPrivateOrganizationFile,
} from "../auth/api";

type ProfilePhotoTarget = Pick<MemberProfile, "displayName" | "id" | "photoFileId">;

type ProfileState =
  | { readonly status: "error" | "loading" | "missing" }
  | { readonly profile: MemberProfile; readonly status: "ready" };

type DirectoryState =
  | { readonly status: "error" | "loading" }
  | { readonly profiles: readonly OrganizationDirectoryProfile[]; readonly status: "ready" };

// eslint-disable-next-line complexity -- this editor coordinates upload, camera, preview, and removal states.
export function ProfilePhotoEditor({
  onChanged,
  profile,
}: {
  readonly onChanged: (fileId: string | null) => void;
  readonly profile: ProfilePhotoTarget;
}) {
  const [busy, setBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraDevices, setCameraDevices] = useState<readonly MediaDeviceInfo[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const cameraCloseRef = useRef<HTMLButtonElement>(null);
  const cameraTriggerRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingPreviewRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const stopCamera = useCallback((): void => {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
  }, []);

  const setPendingFile = useCallback((nextFile: File | null): void => {
    if (pendingPreviewRef.current) URL.revokeObjectURL(pendingPreviewRef.current);
    const nextPreview = nextFile ? URL.createObjectURL(nextFile) : null;
    pendingPreviewRef.current = nextPreview;
    setFile(nextFile);
    setPendingPreview(nextPreview);
  }, []);

  useEffect(() => {
    if (!cameraOpen) {
      stopCamera();
      return;
    }

    const lifecycle: { active: boolean } = { active: true };
    const isActive = (): boolean => lifecycle.active;

    // eslint-disable-next-line complexity -- camera startup handles permission, device discovery, and stream cleanup.
    async function startCamera(): Promise<void> {
      setCameraLoading(true);
      setCameraReady(false);
      setCameraError(null);
      try {
        const mediaDevices = "mediaDevices" in navigator ? navigator.mediaDevices : undefined;
        if (!mediaDevices) {
          throw new Error("camera_unsupported");
        }

        let devices = await mediaDevices.enumerateDevices();
        let videoInputs = devices.filter(({ kind }) => kind === "videoinput");
        if (videoInputs.length === 0 || !videoInputs.some(({ label }) => label)) {
          const permissionStream = await mediaDevices.getUserMedia({ video: true });
          permissionStream.getTracks().forEach((track) => {
            track.stop();
          });
          devices = await mediaDevices.enumerateDevices();
          videoInputs = devices.filter(({ kind }) => kind === "videoinput");
        }
        if (!isActive()) return;

        setCameraDevices(videoInputs);
        const defaultCameraId = videoInputs[0]?.deviceId ?? "";
        const cameraId = selectedCameraId || defaultCameraId;
        if (!selectedCameraId && defaultCameraId) setSelectedCameraId(defaultCameraId);

        const stream = await mediaDevices.getUserMedia({
          video: cameraId
            ? { deviceId: { exact: cameraId }, height: { ideal: 640 }, width: { ideal: 640 } }
            : { facingMode: "user", height: { ideal: 640 }, width: { ideal: 640 } },
        });
        if (!isActive()) {
          stream.getTracks().forEach((track) => {
            track.stop();
          });
          return;
        }

        streamRef.current = stream;
      } catch (error: unknown) {
        if (!isActive()) return;
        setCameraError(
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Camera access was denied. Check your browser or system permissions."
            : "The camera could not be opened. You can choose a photo file instead.",
        );
      } finally {
        if (isActive()) setCameraLoading(false);
      }
    }

    void startCamera();
    return () => {
      lifecycle.active = false;
      stopCamera();
    };
  }, [cameraOpen, selectedCameraId, stopCamera]);

  useEffect(() => {
    if (!cameraOpen || cameraLoading || cameraError || !streamRef.current) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video) return;
    let cancelled = false;
    const markReady = (): void => {
      if (!cancelled && video.videoWidth > 0 && video.videoHeight > 0) {
        setCameraReady(true);
      }
    };
    video.addEventListener("loadedmetadata", markReady);
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    void video
      .play()
      .then(() => {
        markReady();
      })
      .catch(() => {
        if (!cancelled) {
          setCameraError("The camera preview could not start. Choose a photo file instead.");
        }
      });
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", markReady);
    };
  }, [cameraError, cameraLoading, cameraOpen]);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    if (!cameraOpen) return;
    const trigger = cameraTriggerRef.current;
    cameraCloseRef.current?.focus();
    return () => {
      trigger?.focus();
    };
  }, [cameraOpen]);

  useEffect(() => {
    return () => {
      if (pendingPreviewRef.current) URL.revokeObjectURL(pendingPreviewRef.current);
    };
  }, []);

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
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMessage("Profile photo was updated.");
      onChanged(uploadedFileId);
    } catch (error: unknown) {
      if (uploadedFileId) {
        await fetch(`/api/organization/files/${encodeURIComponent(uploadedFileId)}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
      setMessage(
        error instanceof AuthApiError ? error.message : "The Profile photo could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function capturePhoto(): Promise<void> {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError("The camera preview is not ready yet. Try again in a moment.");
      return;
    }
    const side = Math.min(video.videoWidth, video.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("The camera photo could not be prepared. Choose a photo file instead.");
      return;
    }
    context.translate(side, 0);
    context.scale(-1, 1);
    context.drawImage(
      video,
      (video.videoWidth - side) / 2,
      (video.videoHeight - side) / 2,
      side,
      side,
      0,
      0,
      side,
      side,
    );
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });
    if (!blob) {
      setCameraError("The camera photo could not be prepared. Choose a photo file instead.");
      return;
    }
    setPendingFile(
      new File([blob], `profile-photo-${String(Date.now())}.jpg`, { type: "image/jpeg" }),
    );
    stopCamera();
    setCameraReady(false);
    setCameraOpen(false);
    setCameraError(null);
    setMessage("Photo captured. Upload it to save the Profile photo.");
  }

  function closeCamera(): void {
    stopCamera();
    setCameraReady(false);
    setCameraOpen(false);
    setCameraError(null);
    setCameraLoading(false);
  }

  async function removePhoto(): Promise<void> {
    if (!profile.photoFileId || !window.confirm("Remove this Profile photo?")) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteOrganizationProfilePhoto(profile.id);
      setMessage("Profile photo was removed.");
      onChanged(null);
    } catch (error: unknown) {
      setMessage(
        error instanceof AuthApiError ? error.message : "The Profile photo could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="form-stack profile-photo-controls">
        <div className="profile-photo-controls__heading">
          <div className="profile-photo">
            {pendingPreview || profile.photoFileId ? (
              <img
                alt={`${profile.displayName} Profile photo`}
                src={
                  pendingPreview ??
                  `/api/organization/files/${encodeURIComponent(profile.photoFileId ?? "")}`
                }
              />
            ) : (
              <span aria-hidden="true">{profile.displayName.slice(0, 1).toUpperCase()}</span>
            )}
          </div>
          <div>
            <strong>Profile photo</strong>
            <p className="field-help">Add a photo for this Profile using a file or camera.</p>
          </div>
        </div>
        <input
          ref={fileInputRef}
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          id={`profile-photo-file-${profile.id}`}
          type="file"
          onChange={(event) => {
            setPendingFile(event.target.files?.[0] ?? null);
          }}
        />
        <div className="button-row">
          <label
            className="button button--secondary button--small"
            htmlFor={`profile-photo-file-${profile.id}`}
          >
            Choose photo
          </label>
          <button
            className="button button--secondary button--small"
            disabled={busy || cameraLoading}
            onClick={() => {
              setCameraError(null);
              setCameraReady(false);
              setCameraOpen(true);
            }}
            ref={cameraTriggerRef}
            type="button"
          >
            Take photo
          </button>
          <button
            className="button button--primary button--small"
            disabled={busy || !file}
            onClick={() => void savePhoto()}
            type="button"
          >
            Upload photo
          </button>
          {profile.photoFileId ? (
            <button
              className="button button--secondary button--small"
              disabled={busy}
              onClick={() => void removePhoto()}
              type="button"
            >
              Remove photo
            </button>
          ) : null}
        </div>
        {file ? <p className="field-help">Ready to upload: {file.name}</p> : null}
        <p className="field-help">JPEG, PNG, or WebP; up to 5 MB.</p>
        {message ? <p role="status">{message}</p> : null}
      </div>
      {cameraOpen ? (
        <div
          aria-labelledby={`profile-photo-camera-title-${profile.id}`}
          aria-modal="true"
          className="profile-photo-camera"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeCamera();
          }}
          role="dialog"
        >
          <div className="profile-photo-camera__panel">
            <div className="profile-photo-camera__header">
              <div>
                <p className="eyebrow">Profile photo</p>
                <h2 id={`profile-photo-camera-title-${profile.id}`}>Take a photo</h2>
              </div>
              <button
                aria-label="Close camera"
                className="dialog__close"
                onClick={closeCamera}
                ref={cameraCloseRef}
                type="button"
              >
                ×
              </button>
            </div>
            {cameraError ? (
              <div className="notice notice--error" role="alert">
                <p>{cameraError}</p>
                <button
                  className="button button--secondary button--small"
                  onClick={() => {
                    fileInputRef.current?.click();
                    closeCamera();
                  }}
                  type="button"
                >
                  Choose a photo file
                </button>
              </div>
            ) : (
              <>
                <video
                  aria-label="Camera preview"
                  autoPlay
                  className="profile-photo-camera__preview"
                  muted
                  playsInline
                  ref={videoRef}
                />
                {cameraLoading ? <p className="notice notice--info">Opening the camera…</p> : null}
              </>
            )}
            {cameraDevices.length > 1 && !cameraError && !cameraLoading ? (
              <label className="field">
                Camera
                <select
                  value={selectedCameraId}
                  onChange={(event) => {
                    setSelectedCameraId(event.target.value);
                  }}
                >
                  {cameraDevices.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${String(index + 1)}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="dialog__actions">
              <button className="button button--secondary" onClick={closeCamera} type="button">
                Cancel
              </button>
              {!cameraError && !cameraLoading ? (
                <button
                  className="button button--primary"
                  disabled={!cameraReady}
                  onClick={() => void capturePhoto()}
                  type="button"
                >
                  Capture photo
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
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

export function MemberProfileDirectory({
  enabled,
  view = "both",
}: {
  readonly enabled: boolean;
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
      {view !== "profile" ? <Directory enabled={enabled} revision={revision} /> : null}
    </>
  );
}
