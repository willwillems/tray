/**
 * `tray show` -- Show detailed info for a single part.
 */

import { Command } from "@cliffy/command";
import { withClient, resolvePart } from "../client.ts";
import { output } from "../output/format.ts";

export const showCommand = new Command()
  .name("show")
  .description("Show detailed information for a part")
  .arguments("<id:string>")
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .example("Show by name", "tray show NE555")
  .example("Show by ID", "tray show 1")
  .action(async (options, idOrName) => {
    await withClient(options.db, async (client) => {
      const part = await resolvePart(client, idOrName);
      output(part, { format: options.format });
    });
  });
