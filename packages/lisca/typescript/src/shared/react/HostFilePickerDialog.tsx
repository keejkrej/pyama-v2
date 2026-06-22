import { useCallback, useEffect, useState } from "react";

import { FileIcon, FolderIcon } from "lucide-react";

import type { HostFilePickerMode, HostFsEntry, HostListDirectoryResult, ViewerHostPort } from "lisca/shared/contracts";

import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui";

function pathExtLower(name: string): string {
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return "";
  return name.slice(i).toLowerCase();
}

function fileMatchesMode(mode: HostFilePickerMode, entry: HostFsEntry): boolean {
  if (entry.isDirectory) return false;
  const ext = pathExtLower(entry.name);
  switch (mode) {
    case "nd2_file":
      return ext === ".nd2";
    case "czi_file":
      return ext === ".czi";
    default:
      return false;
  }
}

function isDirectoryMode(mode: HostFilePickerMode): boolean {
  return mode === "workspace" || mode === "tif_dir" || mode === "jpg_dir";
}

export type HostFilePickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostPort: Pick<ViewerHostPort, "listDirectory" | "userHomeDirectory">;
  mode: HostFilePickerMode;
  title: string;
  description?: string;
  onPickDirectory: (path: string) => void;
  onPickFile: (path: string) => void;
};

export default function HostFilePickerDialog({
  open,
  onOpenChange,
  hostPort,
  mode,
  title,
  description,
  onPickDirectory,
  onPickFile,
}: HostFilePickerDialogProps) {
  const [list, setList] = useState<HostListDirectoryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<HostFsEntry | null>(null);

  const loadPath = useCallback(
    async (path: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const result = await hostPort.listDirectory(path);
        setList(result);
        setSelectedFile(null);
      } catch (cause) {
        setList(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    },
    [hostPort],
  );

  useEffect(() => {
    if (!open) return;
    void loadPath(null);
  }, [open, loadPath]);

  const navigateToEntry = (entry: HostFsEntry) => {
    if (!entry.isDirectory) return;
    void loadPath(entry.path);
  };

  const goUp = () => {
    if (!list) return;
    if (list.parent) {
      void loadPath(list.parent);
    } else if (list.path) {
      void loadPath(null);
    }
  };

  const goHome = async () => {
    try {
      const home = await hostPort.userHomeDirectory();
      await loadPath(home);
    } catch (cause) {
      setList(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const canGoUp = Boolean(list?.path);
  const dirMode = isDirectoryMode(mode);

  const confirmDirectory = () => {
    if (!list?.path) return;
    onPickDirectory(list.path);
    onOpenChange(false);
  };

  const confirmFile = () => {
    if (!selectedFile || selectedFile.isDirectory || !fileMatchesMode(mode, selectedFile)) return;
    onPickFile(selectedFile.path);
    onOpenChange(false);
  };

  const handleRowClick = (entry: HostFsEntry) => {
    if (dirMode && entry.isDirectory) {
      navigateToEntry(entry);
      return;
    }
    if (!dirMode) {
      if (entry.isDirectory) {
        navigateToEntry(entry);
        return;
      }
      if (fileMatchesMode(mode, entry)) {
        setSelectedFile(entry);
      }
    }
  };

  const handleRowDoubleClick = (entry: HostFsEntry) => {
    if (entry.isDirectory) {
      navigateToEntry(entry);
      return;
    }
    if (!dirMode && fileMatchesMode(mode, entry)) {
      onPickFile(entry.path);
      onOpenChange(false);
    }
  };

  const locationLabel = list?.path ?? "Choose a location";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="-mt-0.5 truncate text-sm text-muted-foreground" title={locationLabel}>
            {locationLabel}
          </p>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{title}</DialogDescription>
          )}
        </DialogHeader>

        <DialogPanel className="flex min-h-0 flex-col gap-2 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={!canGoUp || loading} onClick={goUp}>
              Up
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading}
              title="User home on the host (the process serving this file list)"
              aria-label="Go to user home on the host"
              onClick={() => void goHome()}
            >
              Home
            </Button>
          </div>

          <div className="max-h-[min(50vh,360px)] min-h-[200px] overflow-auto rounded-md border border-border/80 bg-card/30">
            {loading ? (
              <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : error ? (
              <div className="p-3 text-sm text-red-400">{error}</div>
            ) : (
              <ul className="divide-y divide-border/50">
                {(list?.entries ?? []).map((entry) => {
                  const isSel =
                    selectedFile && selectedFile.path === entry.path && !entry.isDirectory;
                  const muted =
                    !entry.isDirectory && !dirMode && !fileMatchesMode(mode, entry);
                  return (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          isSel ? "bg-primary/15" : ""
                        } ${muted ? "text-muted-foreground/60" : ""}`}
                        onClick={() => handleRowClick(entry)}
                        onDoubleClick={() => handleRowDoubleClick(entry)}
                      >
                        <span className="inline-flex size-4 shrink-0 text-muted-foreground">
                          {entry.isDirectory ? <FolderIcon className="size-4" /> : <FileIcon className="size-4" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogPanel>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {dirMode ? (
            <Button type="button" disabled={!list?.path || loading} onClick={confirmDirectory}>
              Select folder
            </Button>
          ) : (
            <Button
              type="button"
              disabled={
                !selectedFile ||
                selectedFile.isDirectory ||
                !fileMatchesMode(mode, selectedFile) ||
                loading
              }
              onClick={confirmFile}
            >
              Select file
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
