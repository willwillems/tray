/**
 * `tray edit` -- Edit a part's fields.
 */

import { Command } from "@cliffy/command";
import { getClient, cleanup } from "../client.ts";
import { output, outputError, detectFormat } from "../output/format.ts";

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
  .action(async (options, id) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });

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
        outputError("no_changes", "No fields to update. Use --name, --description, etc.", format);
        Deno.exit(1);
      }

      const res = await client.api.parts[":id"].$patch({
        param: { id: String(id) },
        json: updates,
      });

      if (!res.ok) {
        const err = await res.json();
        outputError("update_failed", (err as { message?: string }).message ?? "Failed to update part", format);
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
