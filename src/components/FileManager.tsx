import { useEffect } from "react";
import { useTauriFiles } from "../hooks/useTauriFiles";
import "./FileManager.css";

export function FileManager() {
  const { newFile, openFile, saveFile } = useTauriFiles();

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        newFile();
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        openFile();
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        saveFile();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [newFile, openFile, saveFile]);

  return (
    <div className="file-manager">
      <span className="app-name">conversensus</span>
      <div className="file-actions">
        <button onClick={newFile} title="New file (⌘N)">New</button>
        <button onClick={openFile} title="Open file (⌘O)">Open</button>
        <button onClick={saveFile} title="Save file (⌘S)">Save</button>
      </div>
    </div>
  );
}
