import { useRef, useState } from "react";
import { useStore } from "zustand";

import HostFilePickerDialog from "@/components/HostFilePickerDialog";
import Workspace from "@/components/Workspace";
import { AnchoredToastProvider, ToastProvider } from "@/components/ui";
import type { HostFilePickerMode } from "@/lib/contracts";
import { makeSourceKey } from "@/lib/core";
import { createHostApi } from "@/lib/host";
import { appStore, setSource, setWorkspacePath } from "@/lib/store";

const hostApi = createHostApi();

export default function App() {
  const workspacePath = useStore(appStore, (state) => state.workspacePath);
  const source = useStore(appStore, (state) => state.source);
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

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <div className="h-full overflow-hidden bg-background">
          <Workspace
            key={source ? `source:${makeSourceKey(source)}` : "source:none"}
            workspacePath={workspacePath}
            source={source}
            api={hostApi}
            onPickWorkspace={handlePickWorkspace}
            onOpenNd2={handlePickNd2}
            onOpenCzi={handlePickCzi}
            onClearSource={() => setSource(null)}
          />
        </div>

        <HostFilePickerDialog
          open={filePicker.open}
          onOpenChange={(open) => {
            setFilePicker((prev) => ({ ...prev, open }));
            if (!open) pickerModeRef.current = null;
          }}
          api={hostApi}
          mode={filePicker.mode}
          title={filePicker.title}
          onPickDirectory={applyHostPickDirectory}
          onPickFile={applyHostPickFile}
        />
      </AnchoredToastProvider>
    </ToastProvider>
  );
}
