import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { NavigationControls, showErrorToast } from "../src/shared/react";
import {
  persistStoredString,
  readStoredStringWithFallback,
  workspaceStore,
} from "../src/shared/state";

const SRC_ROOT = join(import.meta.dir, "..", "src");
const VIEWER_ROOT = join(SRC_ROOT, "viewer");
const SHARED_ROOT = join(SRC_ROOT, "shared");

function collectSourceFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];

  for (const entry of entries) {
    const nextPath = join(root, entry);
    const stats = statSync(nextPath);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(nextPath));
      continue;
    }
    if (nextPath.endsWith(".ts") || nextPath.endsWith(".tsx")) {
      files.push(nextPath);
    }
  }

  return files;
}

function collectForbiddenImports(root: string, forbiddenPatterns: RegExp[]): string[] {
  const violations: string[] = [];

  for (const filePath of collectSourceFiles(root)) {
    const source = readFileSync(filePath, "utf8");
    if (forbiddenPatterns.some((pattern) => pattern.test(source))) {
      violations.push(relative(SRC_ROOT, filePath).replaceAll("\\", "/"));
    }
  }

  return violations.sort();
}

describe("shared package surface", () => {
  test("exports the shared shell helpers and state", () => {
    expect(typeof NavigationControls).toBe("function");
    expect(typeof showErrorToast).toBe("function");
    expect(typeof workspaceStore.getState).toBe("function");
  });
});

describe("module boundaries", () => {
  test("shared does not import viewer internals", () => {
    const violations = collectForbiddenImports(SHARED_ROOT, [
      /from\s+["'][^"']*@\/viewer(?:\/|["'])/,
      /from\s+["'][^"']*\.\.\/\.\.\/viewer(?:\/|["'])/,
    ]);

    expect(violations).toEqual([]);
  });

  test("source imports use shared core/contracts instead of legacy viewer aliases", () => {
    const violations = collectForbiddenImports(SRC_ROOT, [
      /from\s+["']@\/viewer\/core["']/,
      /from\s+["']@\/viewer\/contracts["']/,
      /from\s+["']lisca\//,
    ]);

    expect(violations).toEqual([]);
  });

  test("viewer workspace file names are explicit", () => {
    const sourceFiles = collectSourceFiles(SRC_ROOT).map((filePath) =>
      relative(SRC_ROOT, filePath).replaceAll("\\", "/"),
    );

    expect(sourceFiles).toContain("viewer/react/app/ViewerAlignWorkspace.tsx");
    expect(sourceFiles).not.toContain("viewer/react/app/ViewerWorkspace.tsx");
    expect(sourceFiles).not.toContain("viewer/react/app/ViewerRoiWorkspace.tsx");
    expect(sourceFiles).not.toContain("viewer/react/app/RoiWorkspace.tsx");
  });
});

describe("shared storage helpers", () => {
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
