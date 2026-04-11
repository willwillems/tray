/**
 * @tray/plugin-web -- Web UI plugin for Tray.
 *
 * Serves the built Vue SPA (packages/plugin-web/dist) as middleware.
 * This plugin handles all non-API routes: static asset serving with
 * cache headers, and SPA fallback (index.html) for client-side routing.
 *
 * @example
 * ```ts
 * import { webUiPlugin } from "@tray/plugin-web";
 *
 * // In tray serve:
 * const plugin = webUiPlugin();
 * // or with a custom dist path:
 * const plugin = webUiPlugin({ distDir: "/path/to/dist" });
 * ```
 */

import type { TrayPlugin } from "@tray/core";
import { resolve, normalize, join } from "node:path";

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function getMimeType(path: string): string {
  const ext = path.substring(path.lastIndexOf("."));
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Dist directory resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the web UI dist directory.
 *
 * Search order:
 *   1. TRAY_WEB_DIR env var       (explicit override)
 *   2. Relative to this module    (works in both dev and `deno compile --include`)
 *
 * This module lives at packages/plugin-web/src/plugin.ts and the dist
 * is at packages/plugin-web/dist -- one directory up. When compiled with
 * `deno compile --include`, the embedded filesystem preserves the same
 * relative layout.
 */
function resolveDistDir(): string | null {
  const candidates = [
    // Explicit override via environment variable
    Deno.env.get("TRAY_WEB_DIR"),
    // Relative to this module: src/plugin.ts -> ../dist
    import.meta.dirname ? join(import.meta.dirname, "..", "dist") : null,
  ];

  for (const dir of candidates) {
    if (!dir) continue;
    try {
      const stat = Deno.statSync(dir);
      if (stat.isDirectory) return dir;
    } catch {
      // Not found, try next
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface WebUiPluginOptions {
  /** Explicit path to the web dist directory. Auto-detected if omitted. */
  distDir?: string;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create the web UI plugin.
 *
 * Returns a TrayPlugin whose middleware serves the built SPA.
 * If the dist directory doesn't exist (not built yet), the middleware
 * passes through all requests (returns null).
 */
export function webUiPlugin(options?: WebUiPluginOptions): TrayPlugin {
  const distDir = options?.distDir ?? resolveDistDir();

  // Pre-load index.html for SPA fallback
  let indexHtml: Uint8Array | null = null;
  if (distDir) {
    try {
      indexHtml = Deno.readFileSync(`${distDir}/index.html`);
    } catch {
      // No index.html found -- SPA fallback won't work
    }
  }

  return {
    name: "web-ui",

    middleware: (req: Request): Response | null => {
      if (!distDir) return null;

      const url = new URL(req.url);
      const path = url.pathname;

      // Don't handle API, KiCad, or health routes
      if (
        path.startsWith("/api/") ||
        path.startsWith("/kicad/") ||
        path === "/health"
      ) {
        return null;
      }

      // Try to serve a static file from dist
      const rawPath = path.replace(/^\/+/, "");

      if (rawPath !== "" && rawPath !== "/") {
        // Resolve the full path and verify it stays within distDir
        // to prevent path traversal attacks (e.g. ....// -> ../)
        const normalizedDist = resolve(distDir);
        const filePath = resolve(distDir, normalize(rawPath));
        if (!filePath.startsWith(normalizedDist + "/")) {
          return null; // Path traversal attempt
        }
        try {
          const data = Deno.readFileSync(filePath);
          return new Response(data, {
            headers: {
              "Content-Type": getMimeType(filePath),
              "Cache-Control": rawPath.startsWith("assets/")
                ? "public, max-age=31536000, immutable"
                : "public, max-age=0, must-revalidate",
            },
          });
        } catch {
          // File not found, fall through to SPA fallback
        }
      }

      // SPA fallback: serve index.html for all non-file routes
      if (indexHtml) {
        return new Response(indexHtml, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=0, must-revalidate",
          },
        });
      }

      return null;
    },
  };
}

/** Check whether the web dist directory exists (for status reporting). */
export function isWebUiAvailable(options?: WebUiPluginOptions): boolean {
  const distDir = options?.distDir ?? resolveDistDir();
  return distDir !== null;
}
