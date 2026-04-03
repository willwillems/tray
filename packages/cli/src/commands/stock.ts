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
import { withClient, resolvePart } from "../client.ts";
import { output, assertOk } from "../output/format.ts";

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
    await withClient(options.db, async (client) => {
      const part = await resolvePart(client, partIdOrName);

      const res = await client.api.stock.add.$post({
        json: {
          part_id: part.id as number,
          quantity: options.qty,
          location: options.location,
          notes: options.notes,
        },
      });

      await assertOk(res, "stock_error", "Failed to add stock");

      const lot = await res.json();
      output(lot, { format: options.format });
    });
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
    await withClient(options.db, async (client) => {
      const part = await resolvePart(client, partIdOrName);

      const res = await client.api.stock.adjust.$post({
        json: {
          part_id: part.id as number,
          quantity: options.qty,
          reason: options.reason,
          lot_id: options.lot,
        },
      });

      await assertOk(res, "stock_error", "Failed to adjust stock");

      const lot = await res.json();
      output(lot, { format: options.format });
    });
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
    await withClient(options.db, async (client) => {
      const part = await resolvePart(client, partIdOrName);

      const res = await client.api.stock.move.$post({
        json: {
          part_id: part.id as number,
          quantity: options.qty,
          from_location: options.from,
          to_location: options.to,
        },
      });

      await assertOk(res, "stock_error", "Failed to move stock");

      const result = await res.json();
      output(result, { format: options.format });
    });
  });

const stockListCommand = new Command()
  .name("list")
  .description("List stock lots for a part")
  .alias("ls")
  .arguments("<part:string>")
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .action(async (options, partIdOrName) => {
    await withClient(options.db, async (client) => {
      const part = await resolvePart(client, partIdOrName);

      const res = await client.api.stock[":part_id"].$get({
        param: { part_id: String(part.id) },
      });

      await assertOk(res, "error", "Failed to list stock");

      const lots = await res.json();
      output(lots, {
        format: options.format,
        columns: ["id", "quantity", "status", "location_path", "expiry_date", "notes"],
      });
    });
  });

const lowCommand = new Command()
  .name("low")
  .description("List parts below minimum stock")
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .action(async (options) => {
    await withClient(options.db, async (client) => {
      const res = await client.api.parts.$get({
        query: { low: "true" },
      });

      await assertOk(res, "error", "Failed to list low stock");

      const parts = await res.json();
      output(parts, {
        format: options.format,
        columns: ["id", "name", "stock", "min_stock", "category_path", "manufacturer"],
      });
    });
  });

export const stockCommand = new Command()
  .name("stock")
  .description("Stock management")
  .example("Add stock", "tray stock add NE555 --qty 10 --location 'Shelf 1'")
  .example("Adjust stock", "tray stock adjust NE555 --qty -5 --reason 'used in project'")
  .example("Move stock", "tray stock move NE555 --qty 5 --from 'Shelf 1' --to 'Shelf 2'")
  .example("List lots", "tray stock list NE555")
  .example("Low stock report", "tray stock low")
  .command("add", stockAddCommand)
  .command("adjust", stockAdjustCommand)
  .command("move", stockMoveCommand)
  .command("list", stockListCommand)
  .command("low", lowCommand);
