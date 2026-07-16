import { useRef, useState } from "react";
import { useStore } from "zustand";

import type { HostFilePickerMode, ViewerDataPort, ViewerHostPort } from "@/shared/contracts";
import { makeSourceKey } from "@/shared/core";
import { AnchoredToastProvider, HostFilePickerDialog, ToastProvider } from "@/shared/react";
import { setWorkspacePath, workspaceStore } from "@/shared/state";

import ViewerAlignWorkspace from "./ViewerAlignWorkspace";
import { setSource, viewerStore } from "./viewerStore";

interface ViewerAppProps {
  dataPort: ViewerDataPort;
  hostPort: ViewerHostPort;
}

export default function ViewerApp({ dataPort, hostPort }: ViewerAppProps) {
  const workspacePath = useStore(workspaceStore, (state) => state.workspacePath);
  const source = useStore(viewerStore, (state) => state.source);
  const pickerModeRef = useRef<HostFilePickerMode | null>(null);
  const [filePicker, setFilePicker] = useState<{
    open: boolean;
    mode: HostFilePickerMode;
    title: string;
  }>({ open: false, mode: "workspace", title: "" });

  const openHostPicker = (mode: HostFilePickerMode, title: string) => {
    pickerModeRef.current = mode;
    setFilePicker({ open: true, mode, title });
  };

  const handlePickWorkspace = () => {
    openHostPicker("workspace", "Workspace folder");
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
    if (pickerModeRef.current === "workspace") {
      setWorkspacePath(path);
    }
  };

  const workspace = (
    <ViewerAlignWorkspace
      key={source ? `align:${makeSourceKey(source)}` : "align:no-source"}
      workspacePath={workspacePath}
      source={source}
      backend={dataPort}
      onPickWorkspace={handlePickWorkspace}
      onOpenNd2={handlePickNd2}
      onOpenCzi={handlePickCzi}
      onClearSource={() => setSource(null)}
    />
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
