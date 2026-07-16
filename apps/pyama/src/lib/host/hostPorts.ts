import { invoke } from "@tauri-apps/api/core";

import type {
  AutoExcludePreviewRequest,
  AutoExcludePreviewResponse,
  FrameRequest,
  FrameResult,
  HostListDirectoryResult,
  LoadFrameOptions,
  AlignState,
  SaveBboxResponse,
  DataPort,
  HostPort,
  Source,
  WorkspaceScan,
} from "@/lib/contracts";

interface FramePayload {
  width: number;
  height: number;
  data_base64: string;
  pixel_type?: FrameResult["pixelType"];
  contrast_domain?: FrameResult["contrastDomain"];
  suggested_contrast?: FrameResult["suggestedContrast"];
  applied_contrast?: FrameResult["appliedContrast"];
}

function toFrameResult(payload: FramePayload): FrameResult {
  return {
    width: payload.width,
    height: payload.height,
    pixels: decodeBase64ToBytes(payload.data_base64),
    pixelType: payload.pixel_type ?? "uint8",
    contrastDomain: payload.contrast_domain,
    suggestedContrast: payload.suggested_contrast,
    appliedContrast: payload.applied_contrast,
  };
}

function decodeBase64ToBytes(value: string): Uint8Array {
  if (typeof atob !== "function") {
    throw new Error("Base64 decoding is unavailable in this host");
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Ports backed by Tauri `invoke` IPC. */
export interface HostPorts {
  dataPort: DataPort;
  hostPort: HostPort;
}

/** Host filesystem helpers and data commands over Tauri IPC. */
export function createHostPorts(): HostPorts {
  const dataPort: DataPort = {
    scanSource(source: Source): Promise<WorkspaceScan> {
      return invoke<WorkspaceScan>("scan_source", { source });
    },

    loadFrame(source: Source, request: FrameRequest, options?: LoadFrameOptions) {
      return invoke<FramePayload>("load_frame", {
        source,
        request,
        contrast: options?.contrast ?? null,
      }).then(toFrameResult);
    },

    listSavedBboxPositions(workspacePath: string): Promise<number[]> {
      return invoke<number[]>("list_saved_bbox_positions", { workspacePath });
    },

    loadAlignState(workspacePath: string, pos: number): Promise<AlignState | null> {
      return invoke<AlignState | null>("load_align_state", {
        workspacePath,
        pos,
      });
    },

    autoExcludePreview(request: AutoExcludePreviewRequest): Promise<AutoExcludePreviewResponse> {
      return invoke<AutoExcludePreviewResponse>("auto_exclude_preview", {
        request,
      });
    },

    saveBbox(
      workspacePath: string,
      _source: Source,
      pos: number,
      csv: string,
      alignState: AlignState,
    ): Promise<SaveBboxResponse> {
      return invoke<SaveBboxResponse>("save_bbox", {
        workspacePath,
        pos,
        csv,
        alignState,
      });
    },
  };

  const hostPort: HostPort = {
    listDirectory(path: string | null) {
      return invoke<HostListDirectoryResult>("list_directory", { path });
    },

    userHomeDirectory() {
      return invoke<string>("user_home_directory");
    },

    readTextFile(path: string) {
      return invoke<string>("read_text_file", { path });
    },
  };

  return {
    dataPort,
    hostPort,
  };
}
