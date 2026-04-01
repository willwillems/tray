/**
 * `tray stock` -- Stock management subcommands.
 *
 *   tray stock add <part> --qty 10 --location "Shelf 1"
 *   tray stock adjust <part> --qty -5 --reason "used in project"
 *   tray stock move <part> --qty 5 --from "Shelf 1" --to "Shelf 2"
 *   tray stock list <part>
 *   tray stock low
 */

import { Command } from "@cliffy/command";
import { getClient, cleanup } from "../client.ts";
import { output, outputError, detectFormat } from "../output/format.ts";

const stockAddCommand = new Command()
  .name("add")
  .description("Add stock to a part")
  .arguments("<part:string>")
  .option("--qty <quantity:integer>", "Quantity to add", { required: true })
  .option("--location <loc:string>", "Storage location path")
  .option("--notes <notes:string>", "Notes for this lot")
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .action(async (options, partIdOrName) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });

      // Resolve part name to ID
      const partRes = await client.api.parts[":id"].$get({
        param: { id: partIdOrName },
      });
      if (!partRes.ok) {
        outputError("not_found", `Part '${partIdOrName}' not found`, format);
        Deno.exit(1);
      }
      const part = await partRes.json();

      const res = await client.api.stock.add.$post({
        json: {
          part_id: part.id as number,
          quantity: options.qty,
          location: options.location,
          notes: options.notes,
        },
      });

      if (!res.ok) {
        const err = await res.json();
        outputError("stock_error", (err as { message?: string }).message ?? "Failed to add stock", format);
        Deno.exit(1);
      }

      const lot = await res.json();
      output(lot, { format });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });

const stockAdjustCommand = new Command()
  .name("adjust")
  .description("Adjust stock quantity (positive or negative)")
  .arguments("<part:string>")
  .option("--qty <quantity:integer>", "Quantity delta (negative to remove)", { required: true })
  .option("--reason <reason:string>", "Reason for adjustment", { required: true })
  .option("--lot <lot_id:integer>", "Specific lot ID to adjust")
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .action(async (options, partIdOrName) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });

      const partRes = await client.api.parts[":id"].$get({
        param: { id: partIdOrName },
      });
      if (!partRes.ok) {
        outputError("not_found", `Part '${partIdOrName}' not found`, format);
        Deno.exit(1);
      }
      const part = await partRes.json();

      const res = await client.api.stock.adjust.$post({
        json: {
          part_id: part.id as number,
          quantity: options.qty,
          reason: options.reason,
          lot_id: options.lot,
        },
      });

      if (!res.ok) {
        const err = await res.json();
        outputError("stock_error", (err as { message?: string }).message ?? "Failed to adjust stock", format);
        Deno.exit(1);
      }

      const lot = await res.json();
      output(lot, { format });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });

const stockMoveCommand = new Command()
  .name("move")
  .description("Move stock between locations")
  .arguments("<part:string>")
  .option("--qty <quantity:integer>", "Quantity to move", { required: true })
  .option("--from <from:string>", "Source location path")
  .option("--to <to:string>", "Destination location path", { required: true })
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .action(async (options, partIdOrName) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });

      const partRes = await client.api.parts[":id"].$get({
        param: { id: partIdOrName },
      });
      if (!partRes.ok) {
        outputError("not_found", `Part '${partIdOrName}' not found`, format);
        Deno.exit(1);
      }
      const part = await partRes.json();

      const res = await client.api.stock.move.$post({
        json: {
          part_id: part.id as number,
          quantity: options.qty,
          from_location: options.from,
          to_location: options.to,
        },
      });

      if (!res.ok) {
        const err = await res.json();
        outputError("stock_error", (err as { message?: string }).message ?? "Failed to move stock", format);
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

const stockListCommand = new Command()
  .name("list")
  .description("List stock lots for a part")
  .alias("ls")
  .arguments("<part:string>")
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .action(async (options, partIdOrName) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });

      const partRes = await client.api.parts[":id"].$get({
        param: { id: partIdOrName },
      });
      if (!partRes.ok) {
        outputError("not_found", `Part '${partIdOrName}' not found`, format);
        Deno.exit(1);
      }
      const part = await partRes.json();

      const res = await client.api.stock[":part_id"].$get({
        param: { part_id: String(part.id) },
      });

      if (!res.ok) {
        const err = await res.json();
        outputError("error", (err as { message?: string }).message ?? "Failed to list stock", format);
        Deno.exit(1);
      }

      const lots = await res.json();
      output(lots, {
        format,
        columns: ["id", "quantity", "status", "location_path", "expiry_date", "notes"],
      });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });

const lowCommand = new Command()
  .name("low")
  .description("List parts below minimum stock")
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .action(async (options) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const res = await client.api.parts.$get({
        query: { low: "true" },
      });

      if (!res.ok) {
        const err = await res.json();
        outputError("error", (err as { message?: string }).message ?? "Failed to list low stock", format);
        Deno.exit(1);
      }

      const parts = await res.json();
      output(parts, {
        format,
        columns: ["id", "name", "stock", "min_stock", "category_path", "manufacturer"],
      });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });

export const stockCommand = new Command()
  .name("stock")
  .description("Stock management")
  .command("add", stockAddCommand)
  .command("adjust", stockAdjustCommand)
  .command("move", stockMoveCommand)
  .command("list", stockListCommand)
  .command("low", lowCommand);
