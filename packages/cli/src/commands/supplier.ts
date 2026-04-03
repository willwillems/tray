/**
 * `tray supplier` -- Supplier management subcommands.
 *
 *   tray supplier add "DigiKey" --url https://digikey.com
 *   tray supplier list
 *   tray supplier show <id>
 *   tray supplier link <part> <supplier> --sku "296-1411-5-ND" --price 0.58
 *   tray supplier buy <part> --qty 100
 */

import { Command } from "@cliffy/command";
import { withClient, resolvePart } from "../client.ts";
import { output, assertOk, CliError } from "../output/format.ts";

const supplierAddCommand = new Command()
  .name("add")
  .description("Add a new supplier")
  .arguments("<name:string>")
  .option("--url <url:string>", "Supplier website URL")
  .option("--notes <notes:string>", "Notes")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, name) => {
    await withClient(options.db, async (client) => {
      const res = await client.api.suppliers.$post({
        json: { name, url: options.url, notes: options.notes },
      });
      await assertOk(res, "error", "Failed");
      output(await res.json(), { format: options.format });
    });
  });

const supplierListCommand = new Command()
  .name("list")
  .description("List all suppliers")
  .alias("ls")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options) => {
    await withClient(options.db, async (client) => {
      const res = await client.api.suppliers.$get();
      await assertOk(res, "error", "Failed to list suppliers");
      output(await res.json(), {
        format: options.format,
        columns: ["id", "name", "url", "part_count"],
      });
    });
  });

const supplierShowCommand = new Command()
  .name("show")
  .description("Show supplier details and linked parts")
  .arguments("<id:integer>")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, id) => {
    await withClient(options.db, async (client) => {
      const res = await client.api.suppliers[":id"].$get({
        param: { id: String(id) },
      });
      await assertOk(res, "not_found", `Supplier ${id} not found`);
      const supplier = await res.json();

      // Also fetch linked parts
      const partsRes = await client.api.suppliers[":id"].parts.$get({
        param: { id: String(id) },
      });
      const parts = partsRes.ok ? await partsRes.json() : [];

      if (options.format === "json") {
        output({ ...supplier, supplier_parts: parts }, { format: options.format });
      } else {
        output(supplier, { format: options.format });
        if ((parts as unknown[]).length > 0) {
          console.log("\nLinked parts:");
          output(parts, {
            format: options.format,
            columns: ["id", "part_name", "sku", "price_breaks"],
          });
        }
      }
    });
  });

const supplierLinkCommand = new Command()
  .name("link")
  .description("Link a part to a supplier with SKU and pricing")
  .arguments("<part:string> <supplier:integer>")
  .option("--sku <sku:string>", "Supplier SKU / order code")
  .option("--url <url:string>", "Product page URL")
  .option("--price <price:number>", "Unit price (qty 1)")
  .option("--currency <currency:string>", "Currency code", { default: "USD" })
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, partIdOrName, supplierId) => {
    await withClient(options.db, async (client) => {
      const part = await resolvePart(client, partIdOrName);

      // Build price breaks if price provided
      const priceBreaks = options.price
        ? [{ min_quantity: 1, price: options.price, currency: options.currency }]
        : undefined;

      const res = await client.api["supplier-parts"].$post({
        json: {
          part_id: part.id as number,
          supplier_id: supplierId,
          sku: options.sku,
          url: options.url,
          price_breaks: priceBreaks,
        },
      });

      await assertOk(res, "error", "Failed to link");
      output(await res.json(), { format: options.format });
    });
  });

const buyCommand = new Command()
  .name("buy")
  .description("Find the best price for a part across all suppliers")
  .arguments("<part:string>")
  .option("--qty <quantity:integer>", "Quantity to buy", { default: 1 })
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, partIdOrName) => {
    await withClient(options.db, async (client) => {
      const part = await resolvePart(client, partIdOrName);

      const res = await client.api.parts[":id"]["best-price"].$get({
        param: { id: String(part.id) },
        query: { quantity: String(options.qty) },
      });

      if (!res.ok) {
        if (options.format === "json") {
          const err = await res.json();
          output(err, { format: options.format });
        } else {
          console.log(`No pricing found for '${partIdOrName}' at qty ${options.qty}`);
          console.log("Tip: use 'tray supplier link' to add supplier pricing.");
        }
        Deno.exit(1);
      }

      const result = await res.json();
      if (options.format === "json") {
        output(result, { format: options.format });
      } else {
        // deno-lint-ignore no-explicit-any
        const r = result as any;
        console.log(`Best price for ${(part as { name: string }).name} x${options.qty}:`);
        console.log(`  Supplier:   ${r.supplier_part.supplier_name}`);
        console.log(`  SKU:        ${r.supplier_part.sku ?? "N/A"}`);
        console.log(`  Unit price: ${r.price_break.currency} ${r.unit_price.toFixed(4)}`);
        console.log(`  Total:      ${r.price_break.currency} ${r.total_price.toFixed(2)}`);
        if (r.supplier_part.url) {
          console.log(`  URL:        ${r.supplier_part.url}`);
        }
      }
    });
  });

export const supplierCommand = new Command()
  .name("supplier")
  .description("Supplier management")
  .example("Add a supplier", "tray supplier add 'DigiKey' --url 'https://digikey.com'")
  .example("List suppliers", "tray supplier list")
  .example("Link part to supplier", "tray supplier link NE555 1 --sku '296-1411-5-ND' --price 0.58")
  .example("Find best price", "tray supplier buy NE555 --qty 100")
  .command("add", supplierAddCommand)
  .command("list", supplierListCommand)
  .command("show", supplierShowCommand)
  .command("link", supplierLinkCommand)
  .command("buy", buyCommand);
