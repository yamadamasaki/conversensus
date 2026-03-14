/**
 * useTauriFiles — the SOLE module permitted to call Tauri `invoke`.
 * All file I/O goes through here. When platform step 1 replaces Tauri
 * with an HTTP backend, only this file needs to be swapped out.
 */
import { invoke } from "@tauri-apps/api/core";
import { useGraphStore, buildFileForSave } from "./useGraphStore";
import type { ConversensusFile } from "../types/graph";

interface TauriError {
  message: string;
}

function isTauriError(e: unknown): e is TauriError {
  return typeof e === "object" && e !== null && "message" in e;
}

function errorMessage(e: unknown): string {
  if (isTauriError(e)) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function useTauriFiles() {
  const store = useGraphStore.getState();

  async function newFile() {
    if (store.isDirty) {
      const confirmed = await confirmDiscardChanges();
      if (!confirmed) return;
    }
    store.newFile();
  }

  async function openFile() {
    if (store.isDirty) {
      const confirmed = await confirmDiscardChanges();
      if (!confirmed) return;
    }
    try {
      const result = await invoke<{ file: ConversensusFile; path: string }>(
        "open_file"
      );
      useGraphStore.getState().loadFile(result.file, result.path);
    } catch (e) {
      alert(`Failed to open file:\n${errorMessage(e)}`);
    }
  }

  async function saveFile(): Promise<boolean> {
    const state = useGraphStore.getState();
    const fileData = buildFileForSave(state);
    if (!fileData) {
      alert("No file to save.");
      return false;
    }
    try {
      const savedPath = await invoke<string>("save_file", {
        file: fileData,
        currentPath: state.filePath ?? null,
      });
      useGraphStore.getState().markSaved(savedPath);
      return true;
    } catch (e) {
      alert(`Failed to save file:\n${errorMessage(e)}`);
      return false;
    }
  }

  return { newFile, openFile, saveFile };
}

async function confirmDiscardChanges(): Promise<boolean> {
  // In a real app we'd use Tauri's dialog plugin for a native dialog.
  // For Step 0, a simple confirm is acceptable within the webview.
  return window.confirm(
    "You have unsaved changes. Discard and continue?"
  );
}
