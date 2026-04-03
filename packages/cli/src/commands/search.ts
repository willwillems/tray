/**
 * `tray search` -- Full-text search across parts.
 */

import { Command } from "@cliffy/command";
import { withClient } from "../client.ts";
import { output, assertOk } from "../output/format.ts";

export const searchCommand = new Command()
  .name("search")
  .description("Full-text search across parts")
  .arguments("<query:string>")
  .option("--limit <n:integer>", "Max results", { default: 50 })
  .option("--offset <n:integer>", "Skip results", { default: 0 })
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .example("Full-text search", "tray search 555")
  .example("Search with limit", "tray search resistor --limit 10")
  .action(async (options, query) => {
    await withClient(options.db, async (client) => {
      const res = await client.api.search.$get({
        query: {
          q: query,
          limit: String(options.limit),
          offset: String(options.offset),
        },
      });

      await assertOk(res, "search_failed", "Search failed");

      const results = await res.json();
      // deno-lint-ignore no-explicit-any
      const parts = (results as any[]).map((r) => ({
        ...r.part,
        tags: r.tags,
        rank: r.rank,
      }));
      output(parts, {
        format: options.format,
        columns: ["id", "name", "stock", "manufacturer", "mpn", "tags"],
      });
    });
  });
