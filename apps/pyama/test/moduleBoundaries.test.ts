import { describe, expect, test } from "bun:test";

import App from "../src/App";
import CanvasSurface from "../src/components/CanvasSurface";
import { NavigationControls } from "../src/components/NavigationControls";
import {
  persistStoredString,
  readStoredStringWithFallback,
  workspaceStore,
} from "../src/lib/state";
import { showErrorToast } from "../src/lib/toast";

describe("spa surface", () => {
  test("exports the app shell and canvas", () => {
    expect(typeof App).toBe("function");
    expect(typeof CanvasSurface).toBe("function");
    expect(typeof NavigationControls).toBe("function");
    expect(typeof showErrorToast).toBe("function");
    expect(typeof workspaceStore.getState).toBe("function");
  });
});

describe("storage helpers", () => {
  test("read and persist strings with legacy key cleanup", () => {
    const data = new Map<string, string>([["legacy", "old"]]);
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    };

    expect(readStoredStringWithFallback(storage, "current", "legacy")).toBe("old");
    persistStoredString(storage, "current", "new", "legacy");
    expect(data.get("current")).toBe("new");
    expect(data.has("legacy")).toBe(false);
    persistStoredString(storage, "current", null, "legacy");
    expect(data.has("current")).toBe(false);
  });
});
