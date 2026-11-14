import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Training studio UI (training/studio.py serves it). Reuses the app's React,
 * Tailwind theme and shadcn/ui components; it is never part of the Electron
 * app. Output goes to training/studio-dist/, which is git-ignored.
 */
export default defineConfig({
  root: resolve(__dirname, "src/studio"),
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "src/renderer/src"),
      "@shared": resolve(__dirname, "src/shared"),
      "@studio": resolve(__dirname, "src/studio"),
    },
  },
  build: {
    outDir: resolve(__dirname, "../training/studio-dist"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
