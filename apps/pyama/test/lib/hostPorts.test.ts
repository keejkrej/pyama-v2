import { afterEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({ ok: true })),
}));

import { invoke } from "@tauri-apps/api/core";
import { createHostPorts } from "../../src/lib/host";

afterEach(() => {
  vi.mocked(invoke).mockClear();
});

describe("tauri ipc data bridge", () => {
  test("forwards align-state payload while saving bbox", async () => {
    const ports = createHostPorts();

    const result = await ports.dataPort.saveBbox(
      "/tmp/workspace",
      { kind: "nd2", path: "/tmp/source.nd2" },
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
        excludedCells: [{ i: 0, j: 1 }],
      },
    );

    expect(result).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("save_bbox", {
      workspacePath: "/tmp/workspace",
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
        excludedCells: [{ i: 0, j: 1 }],
      },
    });
  });
});
