/**
 * `tray add` -- Add a new part.
 */

import { Command } from "@cliffy/command";
import { withClient } from "../client.ts";
import { output, assertOk } from "../output/format.ts";

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
  .option("--db <path:string>", "Database path")
  .example("Add a resistor", "tray add '10k Resistor' --category 'Passives/Resistors' --stock 100")
  .example("Add an IC with details", "tray add NE555 --category 'ICs/Timers' --manufacturer 'Texas Instruments' --mpn NE555P --footprint DIP-8 --stock 25")
  .action(async (options, name) => {
    await withClient(options.db, async (client) => {
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

      await assertOk(res, "create_failed", "Failed to create part");
      output(await res.json(), { format: options.format });
    });
  });
