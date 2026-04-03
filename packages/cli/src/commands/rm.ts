/**
 * `tray rm` -- Remove a part.
 */

import { Command } from "@cliffy/command";
import { withClient } from "../client.ts";
import { output, assertOk } from "../output/format.ts";

export const rmCommand = new Command()
  .name("rm")
  .description("Remove a part from inventory")
  .alias("remove")
  .arguments("<id:integer>")
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .example("Remove a part", "tray rm 1")
  .action(async (options, id) => {
    await withClient(options.db, async (client) => {
      const res = await client.api.parts[":id"].$delete({
        param: { id: String(id) },
      });
      await assertOk(res, "delete_failed", "Failed to delete part");
      output(await res.json(), { format: options.format });
    });
  });
