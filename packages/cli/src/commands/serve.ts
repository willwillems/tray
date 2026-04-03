/**
 * `tray serve` -- Start HTTP server for remote access + KiCad integration.
 * `tray kicad config` -- Generate a .kicad_httplib configuration file.
 */

import { Command } from "@cliffy/command";
import { createApp } from "@tray/api";
import { setupDb } from "@tray/core";
import { getDbPath } from "../client.ts";

export const serveCommand = new Command()
  .name("serve")
  .description("Start HTTP server for remote access and KiCad integration")
  .option("--port <port:integer>", "Port to listen on", { default: 8080 })
  .option("--host <host:string>", "Host to bind to", { default: "127.0.0.1" })
  .option("--db <path:string>", "Database path")
  .example("Start server", "tray serve")
  .example("Custom port", "tray serve --port 3000 --host 0.0.0.0")
  .action(async (options) => {
    const dbPath = options.db ?? getDbPath();
    const db = await setupDb(dbPath);
    const app = createApp(db);

    console.log(`Tray server starting on http://${options.host}:${options.port}`);
    console.log(`Database: ${dbPath}`);
    console.log(`\nEndpoints:`);
    console.log(`  API:   http://${options.host}:${options.port}/api/`);
    console.log(`  KiCad: http://${options.host}:${options.port}/kicad/v1/`);
    console.log(`\nKiCad HTTP Library config:`);
    console.log(`  tray kicad config --url http://${options.host}:${options.port}`);
    console.log(`\nPress Ctrl+C to stop.\n`);

    Deno.serve({
      port: options.port,
      hostname: options.host,
      handler: app.fetch,
    });
  });

const kicadConfigCommand = new Command()
  .name("config")
  .description("Generate a .kicad_httplib configuration file")
  .option("--url <url:string>", "Server URL", { default: "http://127.0.0.1:8080" })
  .option("--name <name:string>", "Library name", { default: "Tray Inventory" })
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
  .example("Generate KiCad config", "tray kicad config > ~/my-inventory.kicad_httplib")
  .command("config", kicadConfigCommand);
