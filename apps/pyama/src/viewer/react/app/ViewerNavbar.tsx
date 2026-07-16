import {
  type MouseEvent,
  useEffect,
  useState,
} from "react";
import { FolderOpen, HardDrive, X } from "lucide-react";

import type { ViewerSource } from "@/shared/contracts";
import { Button } from "@/shared/ui";
import { ContextSummary, ServerConnectionButton } from "@/shared/react";

interface ViewerNavbarProps {
  workspacePath: string | null;
  source: ViewerSource | null;
  onPickWorkspace: () => void | Promise<void>;
  onOpenNd2: () => void | Promise<void>;
  onOpenCzi: () => void | Promise<void>;
  onClearSource: () => void;
}

export default function ViewerNavbar({
  workspacePath,
  source,
  onPickWorkspace,
  onOpenNd2,
  onOpenCzi,
  onClearSource,
}: ViewerNavbarProps) {
  const [openDataModalOpen, setOpenDataModalOpen] = useState(false);

  useEffect(() => {
    if (!openDataModalOpen) return undefined;

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenDataModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openDataModalOpen]);

  useEffect(() => {
    if (!workspacePath) {
      setOpenDataModalOpen(false);
    }
  }, [workspacePath]);

  const handleOpenNd2 = async () => {
    setOpenDataModalOpen(false);
    await onOpenNd2();
  };

  const handleOpenCzi = async () => {
    setOpenDataModalOpen(false);
    await onOpenCzi();
  };

  const handleSourceClear = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClearSource();
  };

  const sourceBadge = source?.kind === "nd2" ? "ND2" : source?.kind === "czi" ? "CZI" : null;

  return (
    <>
      <header className="border-b border-border/80 bg-background px-6 py-3">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="min-w-0 justify-self-start" />

          <div className="min-w-0 justify-self-center">
            <div className="flex max-w-[56rem] flex-wrap items-center justify-center gap-3">
              <ContextSummary
                label="Workspace"
                value={workspacePath}
                icon={<FolderOpen className="size-4" />}
                onClick={() => void onPickWorkspace()}
              />
              <ContextSummary
                label="Source"
                value={source?.path ?? null}
                icon={<HardDrive className="size-4" />}
                badge={sourceBadge}
                disabled={!workspacePath}
                onClick={() => setOpenDataModalOpen(true)}
                action={
                  source ? (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="rounded-full"
                      aria-label="Clear source"
                      onClick={handleSourceClear}
                    >
                      <X className="size-3.5" />
                    </Button>
                  ) : null
                }
              />
            </div>
          </div>

          <div className="min-w-0 justify-self-end">
            <div className="flex items-center justify-end gap-2">
              <ServerConnectionButton />
            </div>
          </div>
        </div>
      </header>

      {openDataModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpenDataModalOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-lg rounded-[1.25rem] border border-border/80 bg-card shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="open-data-title"
          >
            <div className="px-5 pb-3 pt-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h2 id="open-data-title" className="text-[1.4rem] font-medium tracking-tight text-foreground">
                    Open Data
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Choose a source format.
                  </p>
                </div>

                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0 rounded-full"
                  aria-label="Close open data modal"
                  onClick={() => setOpenDataModalOpen(false)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>

            <div className="px-5 pb-5">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="group flex min-h-24 w-full items-center justify-center rounded-2xl border border-border/70 bg-muted/[0.12] px-4 py-5 text-center transition-colors hover:border-primary/35 hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => void handleOpenNd2()}
                >
                  <p className="text-[1.1rem] font-medium tracking-[0.02em] text-foreground transition-colors group-hover:text-primary">
                    ND2
                  </p>
                </button>

                <button
                  type="button"
                  className="group flex min-h-24 w-full items-center justify-center rounded-2xl border border-border/70 bg-muted/[0.12] px-4 py-5 text-center transition-colors hover:border-primary/35 hover:bg-primary/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => void handleOpenCzi()}
                >
                  <p className="text-[1.1rem] font-medium tracking-[0.02em] text-foreground transition-colors group-hover:text-primary">
                    CZI
                  </p>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
