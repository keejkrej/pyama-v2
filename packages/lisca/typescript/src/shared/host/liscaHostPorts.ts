import type {
  AutoExcludePreviewRequest,
  AutoExcludePreviewResponse,
  AnnotationLabel,
  CropOutputFormat,
  CropRoiProgressEvent,
  CropRoiResponse,
  FrameRequest,
  FrameResult,
  HostListDirectoryResult,
  LoadedRawFrameAnnotation,
  LoadedRoiFrameAnnotation,
  LoadFrameOptions,
  RawFrameAnnotation,
  RawFrameAnnotationPayload,
  RawFrameRequest,
  RoiFrameAnnotation,
  RoiFrameAnnotationPayload,
  RoiFrameRequest,
  RoiWorkspaceScan,
  SavedAlignState,
  SaveBboxResponse,
  ViewerDataPort,
  ViewerHostPort,
  ViewerSource,
  WorkspaceScan,
} from "lisca/shared/contracts";

interface RpcRequest {
  id: string;
  method: string;
  payload?: unknown;
}

interface RpcResponse<T> {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
}

interface RpcEvent {
  event: string;
  payload: unknown;
}

type RawProgressHandler = (wirePayload: unknown) => void;

interface FramePayload {
  width: number;
  height: number;
  data_base64: string;
  pixel_type?: FrameResult["pixelType"];
  contrast_domain?: FrameResult["contrastDomain"];
  suggested_contrast?: FrameResult["suggestedContrast"];
  applied_contrast?: FrameResult["appliedContrast"];
}

interface CropRoiProgressPayload {
  request_id: string;
  progress: number;
  message: string;
}

const CROP_PROGRESS_EVENT = "viewer://crop-progress";
const DEFAULT_WEBSOCKET_URL = "ws://127.0.0.1:3412";

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

function toCropRoiProgressEvent(payload: CropRoiProgressPayload): CropRoiProgressEvent {
  return {
    requestId: payload.request_id,
    progress: payload.progress,
    message: payload.message,
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

export function getLiscaWebSocketUrl(): string {
  return resolveWebSocketUrl();
}

function resolveWebSocketUrl(): string {
  const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  const viteUrl = viteEnv?.VITE_LISCA_WEBSOCKET_URL?.trim();

  if (typeof window !== "undefined") {
    const param = new URL(window.location.href).searchParams.get("liscaWsUrl")?.trim();
    if (param) return param;
  }

  if (viteUrl) return viteUrl;

  if (typeof window === "undefined") {
    return DEFAULT_WEBSOCKET_URL;
  }

  return DEFAULT_WEBSOCKET_URL;
}

function makeRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface LiscaHostPortsOptions {
  websocketUrl?: string;
}

type EventHandler = (event: Event | MessageEvent<string>) => void;

type SocketEvents = {
  add: (type: string, handler: EventHandler) => void;
};

class WebSocketRpcClient {
  private socket: WebSocket | null = null;
  private readonly url: string;
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();
  private readonly eventListeners = new Map<string, Set<RawProgressHandler>>();
  private connection: Promise<void> | null = null;
  private isConnected = false;

  private openResolve: (() => void) | null = null;
  private openReject: ((error: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  private getSocketEvents(socket: WebSocket): SocketEvents {
    const typedSocket = socket as WebSocket & {
      addEventListener?: (type: string, listener: EventHandler) => void;
      onopen?: (event: Event) => void;
      onerror?: (event: Event) => void;
      onmessage?: (event: MessageEvent<string>) => void;
      onclose?: (event: Event | MessageEvent<string>) => void;
    };
    return {
      add: (type, handler) => {
        if (typeof typedSocket.addEventListener === "function") {
          typedSocket.addEventListener(type, handler);
          return;
        }
        if (type === "open") typedSocket.onopen = handler as (event: Event) => void;
        if (type === "error") typedSocket.onerror = handler as (event: Event) => void;
        if (type === "message") typedSocket.onmessage = handler as (event: MessageEvent<string>) => void;
        if (type === "close") typedSocket.onclose = handler as (event: Event) => void;
      },
    };
  }

  private connect(): Promise<void> {
    if (this.isConnected) {
      return Promise.resolve();
    }

    if (this.connection) {
      return this.connection;
    }

    this.socket = new WebSocket(this.url);

    const next = new Promise<void>((resolve, reject) => {
      this.openResolve = resolve;
      this.openReject = reject;
    });

    this.connection = next;
    const socket = this.getSocketEvents(this.socket);
    socket.add("open", this.handleOpen);
    socket.add("error", this.handleError);
    socket.add("message", this.handleMessage);
    socket.add("close", this.handleClose);

    this.connection.finally(() => {
      if (this.connection === next) {
        this.connection = null;
      }
    });

    return next;
  }

  private disconnect(error: Error): void {
    const openReject = this.openReject;
    if (openReject) {
      openReject(error);
      this.openResolve = null;
      this.openReject = null;
    }

    this.isConnected = false;
    this.connection = null;

    for (const [id, { reject }] of this.pending) {
      reject(new Error(`WebSocket closed before request ${id} completed`));
    }
    this.pending.clear();

    const ws = this.socket;
    this.socket = null;
    try {
      ws?.close();
    } catch {
      // Ignore close errors on failed sockets.
    }
  }

  private async connectIfNeeded(): Promise<void> {
    if (this.isConnected) return;
    await this.connect();
  }

  async call<T>(method: string, payload?: unknown): Promise<T> {
    await this.connectIfNeeded();

    if (!this.isConnected || !this.socket) {
      throw new Error("WebSocket is not connected");
    }

    const id = makeRequestId();
    const request: RpcRequest = { id, method, payload };
    const data = JSON.stringify(request);

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });

      try {
        this.socket!.send(data);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  subscribe(event: string, listener: RawProgressHandler): () => void {
    let listeners = this.eventListeners.get(event);
    if (!listeners) {
      listeners = new Set<RawProgressHandler>();
      this.eventListeners.set(event, listeners);
    }
    listeners.add(listener);

    return () => {
      listeners = this.eventListeners.get(event);
      if (!listeners) return;
      listeners.delete(listener);
    };
  }

  private handleOpen = () => {
    const openResolve = this.openResolve;
    if (openResolve) openResolve();
    this.isConnected = true;
    this.openResolve = null;
    this.openReject = null;
  };

  private normalizeError = (error: unknown, fallback: string): Error => {
    if (error instanceof Error) return error;
    return new Error(fallback);
  };

  private handleError = (event: Event) => {
    this.disconnect(this.normalizeError(event, "WebSocket connection failed"));
  };

  private handleClose = (event: Event) => {
    const reason = event instanceof CloseEvent
      ? `WebSocket closed (${event.code}): ${event.reason || "closed"}`
      : "WebSocket connection closed";
    this.disconnect(this.normalizeError(event, reason));
  };

  private handleMessage: EventHandler = (event) => {
    const data =
      "data" in event && typeof (event as MessageEvent<string>).data === "string"
        ? (event as MessageEvent<string>).data
        : null;
    if (data === null) return;
    const message = this.parseMessage(data);
    if (!message) return;

    if ("event" in message) {
      const wirePayload = message.payload;
      for (const listener of this.eventListeners.get(message.event) ?? []) {
        listener(wirePayload);
      }
      return;
    }

    const response = message as RpcResponse<unknown>;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);

    if (!response.ok) {
      pending.reject(new Error(response.error ?? "WebSocket request failed"));
      return;
    }

    pending.resolve(response.result);
  };

  private parseMessage(data: string): RpcResponse<unknown> | RpcEvent | null {
    try {
      const message = JSON.parse(data) as RpcResponse<unknown> | RpcEvent;
      if (typeof message === "object" && message !== null && "event" in message && "payload" in message) {
        return message;
      }
      if (
        typeof message === "object" &&
        message !== null &&
        "id" in message &&
        typeof (message as RpcResponse<unknown>).id === "string" &&
        "ok" in message
      ) {
        return message as RpcResponse<unknown>;
      }
    } catch (_error) {
      // Ignore invalid server payload.
    }

    return null;
  }
}

/** RPC ports backed by the LISCA WebSocket server (browser or any webview, including Tauri). */
export interface LiscaHostPorts {
  dataPort: ViewerDataPort;
  hostPort: LiscaHostPort;
}

/** Host filesystem helpers implemented over the same WebSocket as `ViewerDataPort`. */
export interface LiscaHostPort extends ViewerHostPort {}

export function createLiscaHostPorts(options: LiscaHostPortsOptions = {}): LiscaHostPorts {
  const socket = new WebSocketRpcClient(options.websocketUrl ?? getLiscaWebSocketUrl());

  const dataPort: ViewerDataPort = {
    scanSource(source: ViewerSource): Promise<WorkspaceScan> {
      return socket.call<WorkspaceScan>("scan_source", { source });
    },

    loadFrame(source: ViewerSource, request: FrameRequest, options?: LoadFrameOptions) {
      return socket
        .call<FramePayload>("load_frame", {
          source,
          request,
          contrast: options?.contrast ?? null,
        })
        .then(toFrameResult);
    },

    scanRoiWorkspace(workspacePath: string): Promise<RoiWorkspaceScan> {
      return socket.call<RoiWorkspaceScan>("scan_roi_workspace", { workspacePath });
    },

    listSavedBboxPositions(workspacePath: string): Promise<number[]> {
      return socket.call<number[]>("list_saved_bbox_positions", { workspacePath });
    },

    loadAlignState(workspacePath: string, pos: number): Promise<SavedAlignState | null> {
      return socket.call<SavedAlignState | null>("load_align_state", {
        workspacePath,
        pos,
      });
    },

    autoExcludePreview(request: AutoExcludePreviewRequest): Promise<AutoExcludePreviewResponse> {
      return socket.call<AutoExcludePreviewResponse>("auto_exclude_preview", {
        request,
      });
    },

    loadAnnotationLabels(workspacePath: string): Promise<AnnotationLabel[]> {
      return socket.call<AnnotationLabel[]>("load_annotation_labels", { workspacePath });
    },

    saveAnnotationLabels(workspacePath: string, labels: AnnotationLabel[]): Promise<AnnotationLabel[]> {
      return socket.call<AnnotationLabel[]>("save_annotation_labels", {
        workspacePath,
        labels,
      });
    },

    loadRoiFrame(workspacePath: string, request: RoiFrameRequest, options?: LoadFrameOptions) {
      return socket
        .call<FramePayload>("load_roi_frame", {
          workspacePath,
          request,
          contrast: options?.contrast ?? null,
        })
        .then(toFrameResult);
    },

    loadRoiFrameAnnotation(
      workspacePath: string,
      request: RoiFrameRequest,
    ): Promise<LoadedRoiFrameAnnotation> {
      return socket.call<LoadedRoiFrameAnnotation>(
        "load_roi_frame_annotation",
        { workspacePath, request },
      );
    },

    loadRawAnnotationSource(workspacePath: string): Promise<ViewerSource | null> {
      return socket.call<ViewerSource | null>("load_raw_annotation_source", {
        workspacePath,
      });
    },

    loadRawFrameAnnotation(
      workspacePath: string,
      source: ViewerSource,
      request: RawFrameRequest,
    ): Promise<LoadedRawFrameAnnotation> {
      return socket.call<LoadedRawFrameAnnotation>("load_raw_frame_annotation", {
        workspacePath,
        source,
        request,
      });
    },

    saveRoiFrameAnnotation(
      workspacePath: string,
      request: RoiFrameRequest,
      annotation: RoiFrameAnnotationPayload,
    ): Promise<RoiFrameAnnotation> {
      return socket.call<RoiFrameAnnotation>("save_roi_frame_annotation", {
        workspacePath,
        request,
        annotation,
      });
    },

    saveRawFrameAnnotation(
      workspacePath: string,
      source: ViewerSource,
      request: RawFrameRequest,
      annotation: RawFrameAnnotationPayload,
    ): Promise<RawFrameAnnotation> {
      return socket.call<RawFrameAnnotation>("save_raw_frame_annotation", {
        workspacePath,
        source,
        request,
        annotation,
      });
    },

    saveBbox(
      workspacePath: string,
      source: ViewerSource,
      pos: number,
      csv: string,
      alignState: SavedAlignState,
    ): Promise<SaveBboxResponse> {
      return socket.call<SaveBboxResponse>("save_bbox", {
        workspacePath,
        source,
        pos,
        csv,
        alignState,
      });
    },

    async cropRoi(
      workspacePath: string,
      source: ViewerSource,
      pos: number,
      format: CropOutputFormat,
      requestId?: string,
      batch?: number,
    ): Promise<CropRoiResponse> {
      return socket.call<CropRoiResponse>("crop_roi", {
        workspacePath,
        source,
        pos,
        format,
        batch,
        requestId: requestId ?? makeRequestId(),
      });
    },

    cancelCropRoi(requestId: string): Promise<void> {
      return socket.call<void>("cancel_crop_roi", { requestId });
    },

    onCropRoiProgress(listener: (event: CropRoiProgressEvent) => void) {
      return socket.subscribe(CROP_PROGRESS_EVENT, (wire) => {
        listener(toCropRoiProgressEvent(wire as CropRoiProgressPayload));
      });
    },
  };

  const hostPort: LiscaHostPort = {
    listDirectory(path: string | null) {
      return socket.call<HostListDirectoryResult>("list_directory", { path });
    },

    userHomeDirectory() {
      return socket.call<string>("user_home_directory", {});
    },

    readTextFile(path: string) {
      return socket.call<string>("read_text_file", { path });
    },

    roiPosExists(workspacePath: string, pos: number) {
      return socket.call<boolean>("roi_pos_exists", { workspacePath, pos });
    },
  };

  return {
    dataPort,
    hostPort,
  };
}
