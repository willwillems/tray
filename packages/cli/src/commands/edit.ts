/**
 * `tray edit` -- Edit a part's fields.
 */

import { Command } from "@cliffy/command";
import { withClient } from "../client.ts";
import { output, assertOk, CliError } from "../output/format.ts";

export const editCommand = new Command()
  .name("edit")
  .description("Edit a part's fields")
  .arguments("<id:integer>")
  .option("--name <name:string>", "Part name")
  .option("--description <desc:string>", "Description")
  .option("--category <cat:string>", "Category path")
  .option("--manufacturer <mfr:string>", "Manufacturer")
  .option("--mpn <mpn:string>", "Manufacturer part number")
  .option("--ipn <ipn:string>", "Internal part number")
  .option("--footprint <fp:string>", "Footprint")
  .option("--keywords <kw:string>", "Keywords")
  .option("--tags <tags:string>", "Tags (comma-separated)")
  .option("--min-stock <min:integer>", "Minimum stock threshold")
  .option("--favorite", "Mark as favorite")
  .option("--no-favorite", "Unmark as favorite")
  .option("--datasheet <url:string>", "Datasheet URL")
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .example("Rename a part", "tray edit 1 --name 'NE555P Timer'")
  .example("Update category and tags", "tray edit 1 --category 'ICs/Timers' --tags 'timer,oscillator'")
  .action(async (options, id) => {
    await withClient(options.db, async (client) => {
      // Build update payload -- only include provided fields
      // deno-lint-ignore no-explicit-any
      const updates: Record<string, any> = {};
      if (options.name) updates.name = options.name;
      if (options.description !== undefined) updates.description = options.description;
      if (options.category) updates.category = options.category;
      if (options.manufacturer !== undefined) updates.manufacturer = options.manufacturer;
      if (options.mpn !== undefined) updates.mpn = options.mpn;
      if (options.ipn !== undefined) updates.ipn = options.ipn;
      if (options.footprint !== undefined) updates.footprint = options.footprint;
      if (options.keywords !== undefined) updates.keywords = options.keywords;
      if (options.tags) updates.tags = options.tags.split(",").map((t: string) => t.trim());
      if (options.minStock !== undefined) updates.min_stock = options.minStock;
      if (options.favorite === true) updates.favorite = true;
      if (options.favorite === false) updates.favorite = false;
      if (options.datasheet) updates.datasheet_url = options.datasheet;

      if (Object.keys(updates).length === 0) {
        throw new CliError("no_changes", "No fields to update. Use --name, --description, etc.");
      }

      const res = await client.api.parts[":id"].$patch({
        param: { id: String(id) },
        json: updates,
      });

      await assertOk(res, "update_failed", "Failed to update part");
      output(await res.json(), { format: options.format });
    });
  });
