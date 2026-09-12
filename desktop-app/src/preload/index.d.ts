import type { DrmApi } from "./index";

declare global {
  interface Window {
    api: DrmApi;
  }
}

export {};
