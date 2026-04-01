/**
 * `tray rm` -- Remove a part.
 */

import { Command } from "@cliffy/command";
import { getClient, cleanup } from "../client.ts";
import { output, outputError, detectFormat } from "../output/format.ts";

export const rmCommand = new Command()
  .name("rm")
  .description("Remove a part from inventory")
  .alias("remove")
  .arguments("<id:integer>")
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .action(async (options, id) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const res = await client.api.parts[":id"].$delete({
        param: { id: String(id) },
      });

      if (!res.ok) {
        const err = await res.json();
        outputError("delete_failed", (err as { message?: string }).message ?? "Failed to delete part", format);
        Deno.exit(1);
      }

      const result = await res.json();
      output(result, { format });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });
