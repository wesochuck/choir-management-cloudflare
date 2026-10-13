import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as filesApi from "../../api/files";
import * as profilesApi from "../../api/profiles";
import { SaveBar, SaveCoordinatorProvider } from "../../persistence";
import { ProfilePhotoEditor, type ProfilePhotoTarget } from "./ProfilePhotoEditor";

vi.mock("../../api/files", async (importOriginal) => {
  const actual = await importOriginal<typeof filesApi>();
  return {
    ...actual,
    deletePrivateOrganizationFile: vi.fn(),
    uploadPrivateOrganizationFile: vi.fn(),
  };
});

vi.mock("../../api/profiles", async (importOriginal) => {
  const actual = await importOriginal<typeof profilesApi>();
  return {
    ...actual,
    deleteOrganizationProfilePhoto: vi.fn(),
    setOrganizationProfilePhoto: vi.fn(),
  };
});

const defaultProfile: ProfilePhotoTarget = {
  displayName: "Jordan Singer",
  id: "22222222-2222-4222-8222-222222222222",
  photoFileId: null,
};

describe("ProfilePhotoEditor", () => {
  let mockTracks: { stop: ReturnType<typeof vi.fn> }[];
  let mockStream: { getTracks: () => typeof mockTracks };

  beforeEach(() => {
    vi.resetAllMocks();
    mockTracks = [{ stop: vi.fn() }];
    mockStream = {
      getTracks: () => mockTracks,
    };

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles file selection, size validation, and upload", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const onPendingChange = vi.fn();

    vi.mocked(filesApi.uploadPrivateOrganizationFile).mockResolvedValue({
      contentType: "image/jpeg",
      fileName: "sample.jpg",
      id: "file-999",
      requestId: "req-123",
      sizeBytes: 1024,
      uploadedAt: new Date().toISOString(),
    });
    vi.mocked(profilesApi.setOrganizationProfilePhoto).mockResolvedValue(undefined);

    render(
      <SaveCoordinatorProvider>
        <ProfilePhotoEditor
          onChanged={onChanged}
          onPendingChange={onPendingChange}
          profile={defaultProfile}
        />
        <SaveBar />
      </SaveCoordinatorProvider>,
    );

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput instanceof HTMLInputElement).toBe(true);
    if (!fileInput || !(fileInput instanceof HTMLInputElement)) return;

    // Oversized file (> 5 MB) validation
    const largeFile = new File([new Uint8Array(6 * 1024 * 1024)], "too-large.png", {
      type: "image/png",
    });
    await user.upload(fileInput, largeFile);
    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    expect(await screen.findByText("Profile photos may not exceed 5 MB.")).toBeInTheDocument();
    expect(filesApi.uploadPrivateOrganizationFile).not.toHaveBeenCalled();

    // Valid file upload
    const validFile = new File(["valid"], "avatar.jpg", { type: "image/jpeg" });
    await user.upload(fileInput, validFile);
    expect(screen.getByText("Ready to upload: avatar.jpg")).toBeInTheDocument();
    expect(onPendingChange).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole("button", { name: "Upload photo" }));
    expect(filesApi.uploadPrivateOrganizationFile).toHaveBeenCalledWith(validFile);
    expect(profilesApi.setOrganizationProfilePhoto).toHaveBeenCalledWith(
      defaultProfile.id,
      "file-999",
    );
    expect(await screen.findByText("Profile photo was updated.")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledWith("file-999");
  });

  it("handles photo removal with confirmation", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    const profileWithPhoto: ProfilePhotoTarget = {
      ...defaultProfile,
      photoFileId: "existing-photo-123",
    };

    vi.mocked(profilesApi.deleteOrganizationProfilePhoto).mockResolvedValue(undefined);

    render(<ProfilePhotoEditor onChanged={onChanged} profile={profileWithPhoto} />);

    const removeButton = screen.getByRole("button", { name: "Remove photo" });
    await user.click(removeButton);

    const confirmButton = await screen.findByRole("button", { name: "Remove photo" });
    await user.click(confirmButton);

    expect(profilesApi.deleteOrganizationProfilePhoto).toHaveBeenCalledWith(defaultProfile.id);
    expect(await screen.findByText("Profile photo was removed.")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledWith(null);
  });

  it("stops media tracks when camera dialog is closed or unmounted", async () => {
    const user = userEvent.setup();
    const enumerateDevicesMock = vi
      .fn()
      .mockResolvedValue([{ deviceId: "cam-1", kind: "videoinput", label: "FaceTime Camera" }]);
    const getUserMediaMock = vi.fn().mockResolvedValue(mockStream);

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: enumerateDevicesMock,
        getUserMedia: getUserMediaMock,
      },
    });

    const { unmount } = render(<ProfilePhotoEditor onChanged={vi.fn()} profile={defaultProfile} />);

    await user.click(screen.getByRole("button", { name: "Take photo" }));
    expect(await screen.findByRole("dialog", { name: "Take a photo" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Take a photo" })).not.toBeInTheDocument();
    expect(mockTracks[0]?.stop).toHaveBeenCalled();

    // Reopen and unmount to verify cleanup
    await user.click(screen.getByRole("button", { name: "Take photo" }));
    expect(await screen.findByRole("dialog", { name: "Take a photo" })).toBeInTheDocument();
    unmount();
    expect(mockTracks[0]?.stop).toHaveBeenCalled();
  });

  it("displays an error when camera permission is denied", async () => {
    const user = userEvent.setup();
    const permissionError = new DOMException("Permission denied", "NotAllowedError");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockRejectedValue(permissionError),
        getUserMedia: vi.fn().mockRejectedValue(permissionError),
      },
    });

    render(<ProfilePhotoEditor onChanged={vi.fn()} profile={defaultProfile} />);

    await user.click(screen.getByRole("button", { name: "Take photo" }));
    expect(
      await screen.findByText(
        "Camera access was denied. Check your browser or system permissions.",
      ),
    ).toBeInTheDocument();
  });

  it("revokes previous object URL when new file is selected or component unmounts", async () => {
    const user = userEvent.setup();
    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock-preview");
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    const { unmount } = render(<ProfilePhotoEditor onChanged={vi.fn()} profile={defaultProfile} />);

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput instanceof HTMLInputElement).toBe(true);
    if (!fileInput || !(fileInput instanceof HTMLInputElement)) return;

    const file1 = new File(["pic1"], "pic1.jpg", { type: "image/jpeg" });
    const file2 = new File(["pic2"], "pic2.jpg", { type: "image/jpeg" });

    await user.upload(fileInput, file1);
    expect(createObjectURLSpy).toHaveBeenCalledWith(file1);

    await user.upload(fileInput, file2);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-preview");

    act(() => {
      unmount();
    });
    expect(revokeObjectURLSpy).toHaveBeenCalled();
  });
});
