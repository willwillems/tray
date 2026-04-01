/**
 * `tray add` -- Add a new part.
 */

import { Command } from "@cliffy/command";
import { getClient, cleanup } from "../client.ts";
import { output, outputError, detectFormat } from "../output/format.ts";

export const addCommand = new Command()
  .name("add")
  .description("Add a new part to inventory")
  .arguments("<name:string>")
  .option("--description <desc:string>", "Part description (markdown)")
  .option("--category <cat:string>", "Category path (e.g. 'ICs/Timers')")
  .option("--stock <qty:integer>", "Initial stock quantity", { default: 0 })
  .option("--location <loc:string>", "Storage location (e.g. 'Shelf 1/Drawer 3')")
  .option("--manufacturer <mfr:string>", "Manufacturer name")
  .option("--mpn <mpn:string>", "Manufacturer part number")
  .option("--ipn <ipn:string>", "Internal part number")
  .option("--footprint <fp:string>", "Footprint (e.g. '0805', 'DIP-8')")
  .option("--keywords <kw:string>", "Search keywords (space-separated)")
  .option("--tags <tags:string>", "Tags (comma-separated)")
  .option("--min-stock <min:integer>", "Minimum stock threshold", { default: 0 })
  .option("--favorite", "Mark as favorite")
  .option("--datasheet <url:string>", "Datasheet URL")
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path (overrides TRAY_DB)")
  .action(async (options, name) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const res = await client.api.parts.$post({
        json: {
          name,
          description: options.description,
          category: options.category,
          stock: options.stock,
          location: options.location,
          manufacturer: options.manufacturer,
          mpn: options.mpn,
          ipn: options.ipn,
          footprint: options.footprint,
          keywords: options.keywords,
          tags: options.tags?.split(",").map((t: string) => t.trim()),
          min_stock: options.minStock,
          favorite: options.favorite ?? false,
          datasheet_url: options.datasheet,
        },
      });

      if (!res.ok) {
        const err = await res.json();
        outputError("create_failed", (err as { message?: string }).message ?? "Failed to create part", format);
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
