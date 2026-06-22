import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";

import type { HostFilePickerMode, ViewerDataPort, ViewerHostPort } from "lisca/shared/contracts";
import { makeSourceKey } from "lisca/shared/core";
import { AnchoredToastProvider, HostFilePickerDialog, ToastProvider } from "lisca/shared/react";
import { setWorkspacePath, workspaceStore } from "lisca/shared/state";

import ViewerAlignWorkspace from "./ViewerAlignWorkspace";
import ViewerRoiWorkspace from "./ViewerRoiWorkspace";
import type { ViewerMode } from "./ViewerNavbar";
import { LAST_VIEWER_MODE_KEY, readStoredViewerMode } from "./viewerRoutes";
import { setSource, viewerStore } from "./viewerStore";

interface ViewerAppProps {
  dataPort: ViewerDataPort;
  hostPort: ViewerHostPort;
  mode?: ViewerMode;
  onModeChange?: (mode: ViewerMode) => void;
}

export default function ViewerApp({
  dataPort,
  hostPort,
  mode: controlledMode,
  onModeChange,
}: ViewerAppProps) {
  const workspacePath = useStore(workspaceStore, (state) => state.workspacePath);
  const source = useStore(viewerStore, (state) => state.source);
  const pickerModeRef = useRef<HostFilePickerMode | null>(null);
  const [filePicker, setFilePicker] = useState<{
    open: boolean;
    mode: HostFilePickerMode;
    title: string;
  }>({ open: false, mode: "workspace", title: "" });
  const [uncontrolledMode, setUncontrolledMode] = useState<ViewerMode>(() => {
    if (typeof window === "undefined") return "align";
    return readStoredViewerMode(window.sessionStorage) ?? "align";
  });
  const mode = controlledMode ?? uncontrolledMode;

  const setMode = (nextMode: ViewerMode) => {
    if (controlledMode === undefined) {
      setUncontrolledMode(nextMode);
    }
    onModeChange?.(nextMode);
  };

  useEffect(() => {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.setItem(LAST_VIEWER_MODE_KEY, mode);
  }, [mode]);

  const openHostPicker = (mode: HostFilePickerMode, title: string) => {
    pickerModeRef.current = mode;
    setFilePicker({ open: true, mode, title });
  };

  const handlePickWorkspace = () => {
    openHostPicker("workspace", "Workspace folder");
  };

  const handlePickTif = () => {
    if (!workspacePath) return;
    openHostPicker("tif_dir", "TIFF image folder");
  };

  const handlePickJpg = () => {
    if (!workspacePath) return;
    openHostPicker("jpg_dir", "JPEG / PNG image folder");
  };

  const handlePickNd2 = () => {
    if (!workspacePath) return;
    openHostPicker("nd2_file", "ND2 file");
  };

  const handlePickCzi = () => {
    if (!workspacePath) return;
    openHostPicker("czi_file", "CZI file");
  };

  const applyHostPickFile = (path: string) => {
    const mode = pickerModeRef.current;
    if (mode === "nd2_file") setSource({ kind: "nd2", path });
    if (mode === "czi_file") setSource({ kind: "czi", path });
  };

  const applyHostPickDirectory = (path: string) => {
    const mode = pickerModeRef.current;
    if (mode === "workspace") {
      setWorkspacePath(path);
      return;
    }
    if (!workspacePath) return;
    if (mode === "tif_dir") setSource({ kind: "tif", path });
    if (mode === "jpg_dir") setSource({ kind: "jpg", path });
  };

  const workspace = (
    mode === "align" ? (
      <ViewerAlignWorkspace
        key={source ? `align:${makeSourceKey(source)}` : "align:no-source"}
        workspacePath={workspacePath}
        source={source}
        backend={dataPort}
        mode={mode}
        onModeChange={setMode}
        onPickWorkspace={handlePickWorkspace}
        onOpenTif={handlePickTif}
        onOpenJpg={handlePickJpg}
        onOpenNd2={handlePickNd2}
        onOpenCzi={handlePickCzi}
        onCheckRoiExists={hostPort.roiPosExists}
        onClearSource={() => setSource(null)}
      />
    ) : (
      <ViewerRoiWorkspace
        key="roi-workspace"
        workspacePath={workspacePath}
        source={source}
        backend={dataPort}
        mode={mode}
        onModeChange={setMode}
        onPickWorkspace={handlePickWorkspace}
        onOpenTif={handlePickTif}
        onOpenJpg={handlePickJpg}
        onOpenNd2={handlePickNd2}
        onOpenCzi={handlePickCzi}
        onClearSource={() => setSource(null)}
      />
    )
  );

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <div className="h-full overflow-hidden bg-background">
          {workspace}
        </div>

        <HostFilePickerDialog
          open={filePicker.open}
          onOpenChange={(open) => {
            setFilePicker((prev) => ({ ...prev, open }));
            if (!open) pickerModeRef.current = null;
          }}
          hostPort={hostPort}
          mode={filePicker.mode}
          title={filePicker.title}
          onPickDirectory={applyHostPickDirectory}
          onPickFile={applyHostPickFile}
        />
      </AnchoredToastProvider>
    </ToastProvider>
  );
}
