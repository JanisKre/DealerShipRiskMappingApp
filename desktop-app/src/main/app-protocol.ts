import { protocol } from "electron";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

/**
 * The renderer is served from its own `app://` scheme instead of `file://`
 * (Electron security checklist, "Use a custom protocol"): the page then has
 * a real origin, only files below the renderer folder can be read through
 * it, `file://` needs no extra privileges, and the Content Security Policy
 * comes as a response header, where `frame-ancestors` takes effect.
 */

export const APP_SCHEME = "app";
export const APP_HOST = "bundle";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

/** Same policy as the meta tag in index.html, which still covers dev runs. */
export const RENDERER_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
].join("; ");

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

export function contentTypeFor(path: string): string {
  return (
    CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream"
  );
}

/**
 * The file below `rootDir` that an `app://bundle/…` URL names, or null for
 * any other host or scheme and for a path that leaves `rootDir`.
 */
export function resolveAppPath(rootDir: string, rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;
  const root = resolve(rootDir);
  const target = resolve(
    root,
    `.${pathname === "/" ? "/index.html" : pathname}`,
  );
  return target === root || !target.startsWith(root + sep) ? null : target;
}

/** Must run before `app.whenReady()`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        codeCache: true,
      },
    },
  ]);
}

/** Serves the files of `rootDir` under `app://bundle/` (after ready). */
export function serveRenderer(rootDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405 });
    }
    const path = resolveAppPath(rootDir, request.url);
    if (!path) return new Response(null, { status: 404 });
    try {
      const body = await readFile(path);
      return new Response(request.method === "HEAD" ? null : body, {
        status: 200,
        headers: {
          "Content-Type": contentTypeFor(path),
          "Content-Security-Policy": RENDERER_CSP,
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Opener-Policy": "same-origin",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
