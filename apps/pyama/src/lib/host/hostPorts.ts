import type {
  AutoExcludePreviewRequest,
  AutoExcludePreviewResponse,
  FrameRequest,
  FrameResult,
  HostListDirectoryResult,
  LoadFrameOptions,
  SavedState,
  SaveBboxResponse,
  DataPort,
  HostPort,
  Source,
  WorkspaceScan,
} from "@/lib/contracts";

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

export function getWebSocketUrl(): string {
  return resolveWebSocketUrl();
}

function resolveWebSocketUrl(): string {
  const viteEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  const viteUrl = viteEnv?.VITE_WEBSOCKET_URL?.trim();

  if (typeof window !== "undefined") {
    const param = new URL(window.location.href).searchParams.get("wsUrl")?.trim();
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

export interface HostPortsOptions {
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

/** RPC ports backed by the WebSocket server (browser or any webview, including Tauri). */
export interface HostPorts {
  dataPort: DataPort;
  hostPort: HostPort;
}

/** Host filesystem helpers implemented over the same WebSocket as `DataPort`. */
export function createHostPorts(options: HostPortsOptions = {}): HostPorts {
  const socket = new WebSocketRpcClient(options.websocketUrl ?? getWebSocketUrl());

  const dataPort: DataPort = {
    scanSource(source: Source): Promise<WorkspaceScan> {
      return socket.call<WorkspaceScan>("scan_source", { source });
    },

    loadFrame(source: Source, request: FrameRequest, options?: LoadFrameOptions) {
      return socket
        .call<FramePayload>("load_frame", {
          source,
          request,
          contrast: options?.contrast ?? null,
        })
        .then(toFrameResult);
    },

    listSavedBboxPositions(workspacePath: string): Promise<number[]> {
      return socket.call<number[]>("list_saved_bbox_positions", { workspacePath });
    },

    loadSavedState(workspacePath: string, pos: number): Promise<SavedState | null> {
      return socket.call<SavedState | null>("load_align_state", {
        workspacePath,
        pos,
      });
    },

    autoExcludePreview(request: AutoExcludePreviewRequest): Promise<AutoExcludePreviewResponse> {
      return socket.call<AutoExcludePreviewResponse>("auto_exclude_preview", {
        request,
      });
    },

    saveBbox(
      workspacePath: string,
      source: Source,
      pos: number,
      csv: string,
      savedState: SavedState,
    ): Promise<SaveBboxResponse> {
      return socket.call<SaveBboxResponse>("save_bbox", {
        workspacePath,
        source,
        pos,
        csv,
        // Wire field name required by the Rust SaveBboxPayload.
        alignState: savedState,
      });
    },
  };

  const hostPort: HostPort = {
    listDirectory(path: string | null) {
      return socket.call<HostListDirectoryResult>("list_directory", { path });
    },

    userHomeDirectory() {
      return socket.call<string>("user_home_directory", {});
    },

    readTextFile(path: string) {
      return socket.call<string>("read_text_file", { path });
    },
  };

  return {
    dataPort,
    hostPort,
  };
}
