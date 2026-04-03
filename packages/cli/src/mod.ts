/**
 * Tray CLI entry point.
 *
 * Uses Cliffy for command parsing. Every command is a thin HTTP client
 * that talks to the Hono API (in-process or remote).
 *
 * Error handling is centralized here -- commands throw CliError (or any
 * Error) and the global .error() handler formats and exits.
 */

import { Command } from "@cliffy/command";
import { CompletionsCommand } from "@cliffy/command/completions";
import rootConfig from "../../../deno.json" with { type: "json" };
import { CliError, outputError, detectFormat } from "./output/format.ts";
import { cleanup } from "./client.ts";
import { addCommand } from "./commands/add.ts";
import { listCommand } from "./commands/list.ts";
import { showCommand } from "./commands/show.ts";
import { searchCommand } from "./commands/search.ts";
import { editCommand } from "./commands/edit.ts";
import { rmCommand } from "./commands/rm.ts";
import { stockCommand } from "./commands/stock.ts";
import { supplierCommand } from "./commands/supplier.ts";
import { attachCommand, attachmentsCommand, detachCommand } from "./commands/attach.ts";
import { projectCommand } from "./commands/project.ts";
import { serveCommand, kicadCommand } from "./commands/serve.ts";
import { exportCommand, importCommand, bomImportCommand } from "./commands/io.ts";
import { backupCommand, restoreCommand } from "./commands/backup.ts";
import { poCommand } from "./commands/po.ts";

const tray = new Command()
  .name("tray")
  .version(rootConfig.version)
  .description("CLI-first inventory management for makers")
  .globalEnv("TRAY_DB=<path:string>", "Database file path", { prefix: "TRAY_" })
  .error(async (error, _cmd) => {
    const format = detectFormat();
    if (error instanceof CliError) {
      outputError(error.code, error.message, format);
    } else {
      outputError("error", error instanceof Error ? error.message : String(error), format);
    }
    await cleanup();
    Deno.exit(1);
  })
  .command("add", addCommand)
  .command("list", listCommand)
  .command("show", showCommand)
  .command("search", searchCommand)
  .command("edit", editCommand)
  .command("rm", rmCommand)
  .command("stock", stockCommand)
  .command("supplier", supplierCommand)
  .command("attach", attachCommand)
  .command("attachments", attachmentsCommand)
  .command("detach", detachCommand)
  .command("project", projectCommand)
  .command("serve", serveCommand)
  .command("kicad", kicadCommand)
  .command("export", exportCommand)
  .command("import", importCommand)
  .command("bom-import", bomImportCommand)
  .command("po", poCommand)
  .command("backup", backupCommand)
  .command("restore", restoreCommand)
  .command("completions", new CompletionsCommand());

// Parse and run
await tray.parse(Deno.args);
