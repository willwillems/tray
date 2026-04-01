/**
 * `tray list` / `tray ls` -- List and filter parts.
 */

import { Command } from "@cliffy/command";
import { getClient, cleanup } from "../client.ts";
import { output, outputError, detectFormat } from "../output/format.ts";

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
  .action(async (options) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });

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

      if (!res.ok) {
        const err = await res.json();
        outputError("list_failed", (err as { message?: string }).message ?? "Failed to list parts", format);
        Deno.exit(1);
      }

      const parts = await res.json();
      output(parts, {
        format,
        columns: ["id", "name", "stock", "category_path", "manufacturer", "mpn", "tags"],
      });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });
