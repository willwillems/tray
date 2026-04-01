/**
 * CLI client factory.
 *
 * In local mode: boots an in-process Hono server (~2ms), creates hc client.
 * In remote mode: creates hc client pointing at remote URL.
 *
 * The CLI never imports core directly -- it always goes through the API.
 */

import { hc } from "hono/client";
import { type AppType, createApp } from "@tray/api";
import { setupDb } from "@tray/core";

type HonoClient = ReturnType<typeof hc<AppType>>;
export type { HonoClient as Client };

// deno-lint-ignore no-explicit-any
let _db: any = null;
// deno-lint-ignore no-explicit-any
let _app: any = null;

/**
 * Get a typed Hono RPC client.
 *
 * In local mode, starts an in-process server.
 * The client returned has full type inference from the API routes.
 */
export async function getClient(
  options?: { dbPath?: string; remoteUrl?: string },
): Promise<HonoClient> {
  // Remote mode
  if (options?.remoteUrl) {
    return hc<AppType>(options.remoteUrl);
  }

  // Local mode: in-process server
  const dbPath = options?.dbPath ?? getDbPath();
  const db = await setupDb(dbPath);
  _db = db;

  const app = createApp(db);
  _app = app;

  // Create client that uses app.fetch directly (no real HTTP server)
  return hc<AppType>("http://localhost", {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      return app.fetch(req);
    },
  });
}

/**
 * Raw fetch against the in-process app.
 * Used for multipart uploads that Hono RPC can't handle.
 */
export async function rawFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (!_app) throw new Error("Client not initialized. Call getClient() first.");
  const req = new Request(`http://localhost${path}`, init);
  return await _app.fetch(req);
}

/**
 * Clean up resources (close database connection).
 */
export async function cleanup(): Promise<void> {
  if (_db) {
    await _db.destroy();
    _db = null;
  }
}

/**
 * Determine the database path from env or default.
 */
function getDbPath(): string {
  // Check env vars
  const envPath = Deno.env.get("TRAY_DB");
  if (envPath) return envPath;

  // Default: ~/.tray/data.db
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
  const dir = `${home}/.tray`;

  // Ensure directory exists
  try {
    Deno.mkdirSync(dir, { recursive: true });
  } catch {
    // Directory already exists
  }

  return `${dir}/data.db`;
}
