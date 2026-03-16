import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useGraphStore } from "./hooks/useGraphStore";
import { useTauriFiles } from "./hooks/useTauriFiles";
import { FileManager } from "./components/FileManager";
import { GraphCanvas } from "./components/GraphCanvas";
import "./App.css";

export default function App() {
  const fileName = useGraphStore((s) => s.fileName);
  const isDirty = useGraphStore((s) => s.isDirty);
  const { saveFile } = useTauriFiles();

  // Auto-create a new file on startup so the canvas is immediately usable
  useEffect(() => {
    if (!useGraphStore.getState().file) {
      useGraphStore.getState().newFile();
    }
  }, []);

  const title = `conversensus${fileName ? ` — ${fileName}` : ""}${isDirty ? " •" : ""}`;

  // Update window title
  if (typeof document !== "undefined") {
    document.title = title;
  }

  // Guard window close: prompt to save if dirty
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    win.onCloseRequested(async (event) => {
      const dirty = useGraphStore.getState().isDirty;
      if (dirty) {
        event.preventDefault();
        const save = window.confirm(
          "You have unsaved changes. Save before closing?"
        );
        if (save) {
          const saved = await saveFile();
          if (saved) await win.close();
        } else {
          // Discard and close
          await win.close();
        }
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ReactFlowProvider>
      <div className="app">
        <FileManager />
        <GraphCanvas />
      </div>
    </ReactFlowProvider>
  );
}
