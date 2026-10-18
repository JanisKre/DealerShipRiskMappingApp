import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { DOC_PAGES } from "./src/lib/docs-pages";

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
// its own HTML entry (docs/<slug>/index.html per docs page), so GitHub Pages
// needs no SPA fallback.
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
        ...Object.fromEntries(
          DOC_PAGES.map((p) => [`docs/${p.slug}`, page(`./docs/${p.slug}/index.html`)]),
        ),
      },
    },
  },
});
