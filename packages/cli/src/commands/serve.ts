/**
 * `tray serve` -- Start HTTP server for remote access + KiCad integration.
 * `tray kicad config` -- Generate a .kicad_httplib configuration file.
 *
 * Plugins (including the web UI) provide middleware that runs before the API
 * router. The first middleware that returns a Response handles the request.
 */

import { Command } from "@cliffy/command";
import { createApp } from "@tray/api";
import { createPluginEngine, setupDb } from "@tray/core";
import type { MiddlewareHandler } from "@tray/core";
import { webUiPlugin, isWebUiAvailable } from "@tray/plugin-web";
import { getDbPath } from "../client.ts";

/**
 * Create a request handler that runs plugin middleware first,
 * then falls back to the Hono API app.
 */
function createHandler(
  apiApp: ReturnType<typeof createApp>,
  middleware: MiddlewareHandler[],
): (req: Request) => Promise<Response> | Response {
  return async (req: Request): Promise<Response> => {
    // Try each plugin middleware in order
    for (const handler of middleware) {
      const response = await handler(req);
      if (response) return response;
    }

    // No middleware handled it -- forward to the API router
    return apiApp.fetch(req);
  };
}

export const serveCommand = new Command()
  .name("serve")
  .description(
    "Start HTTP server for remote access, web UI, and KiCad integration",
  )
  .option("--port <port:integer>", "Port to listen on", { default: 8080 })
  .option("--host <host:string>", "Host to bind to", { default: "127.0.0.1" })
  .option("--db <path:string>", "Database path")
  .option("--no-ui", "Disable the built-in web UI plugin")
  .example("Start server", "tray serve")
  .example("Custom port", "tray serve --port 3000 --host 0.0.0.0")
  .example("API only (no web UI)", "tray serve --no-ui")
  .action(async (options) => {
    const dbPath = options.db ?? getDbPath();
    const db = await setupDb(dbPath);
    const app = createApp(db);

    // Load user plugins from ~/.tray/config.ts
    const engine = await createPluginEngine(db);

    // Register the built-in web UI plugin (unless --no-ui)
    const showUi = options.ui !== false;
    const webAvailable = showUi && isWebUiAvailable();

    if (showUi) {
      // Web UI plugin goes last so user plugins can intercept routes first
      engine.addPlugin(webUiPlugin());
    }

    // Collect middleware from all plugins
    const middleware = engine.getMiddleware();

    const base = `http://${options.host}:${options.port}`;
    console.log(`Tray server starting on ${base}`);
    console.log(`Database: ${dbPath}`);
    console.log(`\nPlugins: ${engine.plugins.map((p) => p.name).join(", ") || "(none)"}`);
    console.log(`\nEndpoints:`);
    if (webAvailable) {
      console.log(`  Web UI: ${base}/`);
    } else if (showUi) {
      console.log(
        `  Web UI: not available (build with: cd packages/web && npm run build)`,
      );
    } else {
      console.log(`  Web UI: disabled (--no-ui)`);
    }
    console.log(`  API:    ${base}/api/`);
    console.log(`  KiCad:  ${base}/kicad/v1/`);
    console.log(`\nKiCad HTTP Library config:`);
    console.log(`  tray kicad config --url ${base}`);
    console.log(`\nPress Ctrl+C to stop.\n`);

    const handler = createHandler(app, middleware);

    Deno.serve({
      port: options.port,
      hostname: options.host,
      handler,
    });
  });

const kicadConfigCommand = new Command()
  .name("config")
  .description("Generate a .kicad_httplib configuration file")
  .option("--url <url:string>", "Server URL", {
    default: "http://127.0.0.1:8080",
  })
  .option("--name <name:string>", "Library name", {
    default: "Tray Inventory",
  })
  .option("--token <token:string>", "Authentication token")
  .action((options) => {
    const config = {
      meta: {
        version: 1.0,
      },
      name: options.name,
      description: "Parts inventory managed by Tray",
      source: {
        type: "REST_API",
        api_version: "v1",
        root_url: `${options.url}/kicad`,
        token: options.token ?? "",
        timeout_parts_seconds: 60,
        timeout_categories_seconds: 600,
      },
    };
    console.log(JSON.stringify(config, null, 4));
  });

export const kicadCommand = new Command()
  .name("kicad")
  .description("KiCad integration")
  .example(
    "Generate KiCad config",
    "tray kicad config > ~/my-inventory.kicad_httplib",
  )
  .command("config", kicadConfigCommand);
