import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// GitHub Pages cannot set response headers, so the policy ships as a meta tag.
// Build only: the dev server injects an inline React Refresh preamble.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
        injectTo: "head-prepend",
      },
    ],
  };
}

const page = (path: string): string =>
  fileURLToPath(new URL(path, import.meta.url));

// Relative base so the build works under the GitHub Pages project path
// (/DealerShipRiskMappingApp/) as well as on a custom domain. Each page is
// its own HTML entry, so /docs/ needs no SPA fallback on GitHub Pages.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  resolve: {
    alias: { "@": page("./src") },
  },
  build: {
    rollupOptions: {
      input: {
        home: page("./index.html"),
        docs: page("./docs/index.html"),
      },
    },
  },
});
