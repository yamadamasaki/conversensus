/// <reference types="vitest/globals" />
// Vitest global setup
// Mock Tauri invoke so tests can run without the native backend
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
