/**
 * Tray CLI entry point.
 *
 * Uses Cliffy for command parsing. Every command is a thin HTTP client
 * that talks to the Hono API (in-process or remote).
 */

import { Command } from "@cliffy/command";
import rootConfig from "../../../deno.json" with { type: "json" };
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
  .command("restore", restoreCommand);

// Parse and run
await tray.parse(Deno.args);
