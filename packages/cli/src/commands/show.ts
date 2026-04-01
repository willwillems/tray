/**
 * `tray show` -- Show detailed info for a single part.
 */

import { Command } from "@cliffy/command";
import { getClient, cleanup } from "../client.ts";
import { output, outputError, detectFormat } from "../output/format.ts";

export const showCommand = new Command()
  .name("show")
  .description("Show detailed information for a part")
  .arguments("<id:string>")
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .action(async (options, idOrName) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const res = await client.api.parts[":id"].$get({
        param: { id: idOrName },
      });

      if (!res.ok) {
        const err = await res.json();
        outputError("not_found", (err as { message?: string }).message ?? `Part '${idOrName}' not found`, format);
        Deno.exit(1);
      }

      const part = await res.json();
      output(part, { format });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });
