import { afterEach, describe, expect, test } from "bun:test";

import { createLiscaHostPorts } from "../../../src/shared/host";

type MockWsMessage = {
  id?: string;
  method?: string;
  payload?: unknown;
  ok?: boolean;
  result?: unknown;
  error?: string;
  event?: string;
};

const CROP_PROGRESS_EVENT = "viewer://crop-progress";

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  public readonly sent: string[] = [];
  public onopen: ((event: Event) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onclose: (() => void) | null = null;

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.onopen?.(new Event("open"));
    }, 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.onclose?.();
  }

  emitMessage(message: MockWsMessage) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }));
  }
}

function lastRequest(socket: MockWebSocket): {
  id: string;
  method: string;
  payload: unknown;
} {
  const raw = socket.sent.at(-1);
  if (!raw) {
    throw new Error("No socket request was sent");
  }
  const request = JSON.parse(raw) as { id?: string; method?: string; payload?: unknown };
  if (!request.id || !request.method) {
    throw new Error("Malformed websocket request");
  }
  return {
    id: request.id,
    method: request.method,
    payload: request.payload,
  };
}

function eventPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

afterEach(() => {
  MockWebSocket.instances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = MockWebSocket;
});

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function activeMockSocket(): MockWebSocket {
  const socket = MockWebSocket.instances.at(-1);
  if (!socket) {
    throw new Error("No MockWebSocket instance (createLiscaHostPorts first)");
  }
  return socket;
}

describe("websocket data bridge", () => {
  test("forwards crop-progress events and resolves crop responses", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = MockWebSocket;
    const ports = createLiscaHostPorts();

    const received: Array<{ requestId: string; progress: number; message: string }> = [];
    ports.dataPort.onCropRoiProgress((event) => {
      received.push(event);
    });

    const cropPromise = ports.dataPort.cropRoi(
      "/tmp/workspace",
      { kind: "tif", path: "/tmp/source" },
      3,
      "tiff",
      "req-1",
    );

    await flushMicrotasks();
    const socket = activeMockSocket();
    const request = lastRequest(socket);
    expect(eventPayload(request.payload).requestId).toBe("req-1");

    socket.emitMessage({
      event: CROP_PROGRESS_EVENT,
      payload: {
        request_id: "req-1",
        progress: 0.5,
        message: "Writing ROI planes",
      },
    });
    socket.emitMessage({
      id: request.id,
      ok: true,
      result: { ok: true, status: "success", outputPath: "/tmp/roi" },
    });

    await expect(cropPromise).resolves.toEqual({
      ok: true,
      status: "success",
      outputPath: "/tmp/roi",
    });
    expect(received).toEqual([
      {
        requestId: "req-1",
        progress: 0.5,
        message: "Writing ROI planes",
      },
    ]);
  });

  test("forwards hidden crop batch override payload", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = MockWebSocket;
    const ports = createLiscaHostPorts();

    const cropPromise = ports.dataPort.cropRoi(
      "/tmp/workspace",
      { kind: "nd2", path: "/tmp/source.nd2" },
      3,
      "tiff",
      "req-hidden",
      50,
    );

    await flushMicrotasks();
    const socket = activeMockSocket();
    const request = lastRequest(socket);
    const payload = eventPayload(request.payload);
    expect(request.method).toEqual("crop_roi");
    expect(payload).toEqual({
      workspacePath: "/tmp/workspace",
      source: { kind: "nd2", path: "/tmp/source.nd2" },
      pos: 3,
      format: "tiff",
      batch: 50,
      requestId: "req-hidden",
    });

    socket.emitMessage({ id: request.id, ok: true, result: { ok: true, status: "success" } });
    await expect(cropPromise).resolves.toEqual({ ok: true, status: "success" });
  });

  test("forwards align-state payload while saving bbox", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = MockWebSocket;
    const ports = createLiscaHostPorts();

    const savePromise = ports.dataPort.saveBbox(
      "/tmp/workspace",
      { kind: "tif", path: "/tmp/source" },
      7,
      "roi,x,y,w,h\n0,0,0,1,1\n",
      {
        grid: {
          enabled: true,
          shape: "square",
          tx: 1,
          ty: 2,
          rotation: 0.3,
          spacingA: 100,
          spacingB: 120,
          cellWidth: 80,
          cellHeight: 90,
          opacity: 0.4,
        },
        excludedCells: [{ i: 3, j: 4 }],
      },
    );

    await flushMicrotasks();
    const socket = activeMockSocket();
    const request = lastRequest(socket);
    expect(request.method).toBe("save_bbox");

    const payload = eventPayload(request.payload);
    expect(payload).toEqual({
      workspacePath: "/tmp/workspace",
      source: { kind: "tif", path: "/tmp/source" },
      pos: 7,
      csv: "roi,x,y,w,h\n0,0,0,1,1\n",
      alignState: {
        grid: {
          enabled: true,
          shape: "square",
          tx: 1,
          ty: 2,
          rotation: 0.3,
          spacingA: 100,
          spacingB: 120,
          cellWidth: 80,
          cellHeight: 90,
          opacity: 0.4,
        },
        excludedCells: [{ i: 3, j: 4 }],
      },
    });

    socket.emitMessage({ id: request.id, ok: true, result: { ok: true } });
    await expect(savePromise).resolves.toEqual({ ok: true });
  });
});
