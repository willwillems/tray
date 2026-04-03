/**
 * `tray list` / `tray ls` -- List and filter parts.
 */

import { Command } from "@cliffy/command";
import { withClient } from "../client.ts";
import { output, assertOk } from "../output/format.ts";

export const listCommand = new Command()
  .name("list")
  .description("List and filter parts")
  .alias("ls")
  .option("--category <cat:string>", "Filter by category path")
  .option("--tag <tag:string>", "Filter by tag")
  .option("--manufacturer <mfr:string>", "Filter by manufacturer")
  .option("--low", "Show only parts below min_stock")
  .option("--favorites", "Show only favorites")
  .option("--limit <n:integer>", "Max results", { default: 100 })
  .option("--offset <n:integer>", "Skip results", { default: 0 })
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .example("List all parts", "tray list")
  .example("Filter by category", "tray list --category 'ICs/Timers'")
  .example("Show low stock only", "tray list --low")
  .action(async (options) => {
    await withClient(options.db, async (client) => {
      // Build query params
      // deno-lint-ignore no-explicit-any
      const query: Record<string, any> = {};
      if (options.category) query.category = options.category;
      if (options.tag) query.tag = options.tag;
      if (options.manufacturer) query.manufacturer = options.manufacturer;
      if (options.low) query.low = "true";
      if (options.favorites) query.favorites = "true";
      query.limit = String(options.limit);
      query.offset = String(options.offset);

      const res = await client.api.parts.$get({ query });
      await assertOk(res, "list_failed", "Failed to list parts");

      output(await res.json(), {
        format: options.format,
        columns: ["id", "name", "stock", "category_path", "manufacturer", "mpn", "tags"],
      });
    });
  });
