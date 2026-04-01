/**
 * `tray search` -- Full-text search across parts.
 */

import { Command } from "@cliffy/command";
import { getClient, cleanup } from "../client.ts";
import { output, outputError, detectFormat } from "../output/format.ts";

export const searchCommand = new Command()
  .name("search")
  .description("Full-text search across parts")
  .arguments("<query:string>")
  .option("--limit <n:integer>", "Max results", { default: 50 })
  .option("--offset <n:integer>", "Skip results", { default: 0 })
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .action(async (options, query) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const res = await client.api.search.$get({
        query: {
          q: query,
          limit: String(options.limit),
          offset: String(options.offset),
        },
      });

      if (!res.ok) {
        const err = await res.json();
        outputError("search_failed", (err as { message?: string }).message ?? "Search failed", format);
        Deno.exit(1);
      }

      const results = await res.json();
      // Flatten search results for display
      // deno-lint-ignore no-explicit-any
      const parts = (results as any[]).map((r) => ({
        ...r.part,
        tags: r.tags,
        rank: r.rank,
      }));
      output(parts, {
        format,
        columns: ["id", "name", "stock", "manufacturer", "mpn", "tags"],
      });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });
