import type { MemberProfile } from "@choir/contracts";
import { Dialog, DialogClose, useConfirmation } from "@choir/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  AuthApiError,
  deleteOrganizationProfilePhoto,
  deletePrivateOrganizationFile,
  setOrganizationProfilePhoto,
  uploadPrivateOrganizationFile,
} from "../../api";
import { useSaveRegistration } from "../../persistence";

export type ProfilePhotoTarget = Pick<MemberProfile, "displayName" | "id" | "photoFileId">;

export interface ProfilePhotoEditorProps {
  readonly onChanged: (fileId: string | null) => void;
  readonly onPendingChange?: (hasPending: boolean) => void;
  readonly profile: ProfilePhotoTarget;
}

// eslint-disable-next-line complexity -- this editor coordinates upload, camera, preview, and removal states.
export function ProfilePhotoEditor({
  onChanged,
  onPendingChange,
  profile,
}: ProfilePhotoEditorProps) {
  const { confirm, confirmationDialog } = useConfirmation();
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

  const profileId = profile.id;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset pending photo when the target Profile changes.
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setMessage(null);
  }, [profileId, setPendingFile]);

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
    return () => {
      if (pendingPreviewRef.current) URL.revokeObjectURL(pendingPreviewRef.current);
    };
  }, []);

  async function savePhoto(): Promise<boolean> {
    if (!file) return true;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("Choose a JPEG, PNG, or WebP image.");
      return false;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage("Profile photos may not exceed 5 MB.");
      return false;
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
      return true;
    } catch (error: unknown) {
      if (uploadedFileId) {
        await deletePrivateOrganizationFile(uploadedFileId).catch(() => undefined);
      }
      setMessage(
        error instanceof AuthApiError ? error.message : "The Profile photo could not be updated.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  const hasPendingPhoto = file !== null;

  useEffect(() => {
    onPendingChange?.(hasPendingPhoto);
  }, [hasPendingPhoto, onPendingChange]);

  useSaveRegistration({
    busy,
    dirty: hasPendingPhoto,
    discard: () => {
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMessage(null);
    },
    id: `member-profile-photo-${profile.id}`,
    resourceKey: `member-profile-photo-${profile.id}`,
    save: () => savePhoto(),
  });

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
    if (!profile.photoFileId) return;
    if (
      !(await confirm({
        confirmLabel: "Remove photo",
        description: "The current Profile photo will be permanently removed.",
        destructive: true,
        title: "Remove Profile photo?",
      }))
    ) {
      return;
    }
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
      <Dialog
        description="Take a photo with your device camera to use as your profile photo."
        onClose={closeCamera}
        open={cameraOpen}
        title="Take a photo"
      >
        <div className="stack-form">
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
            <DialogClose asChild>
              <button className="button button--secondary" onClick={closeCamera} type="button">
                Cancel
              </button>
            </DialogClose>
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
      </Dialog>
      {confirmationDialog}
    </>
  );
}
