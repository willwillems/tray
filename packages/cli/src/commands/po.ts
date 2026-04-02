/**
 * `tray po` -- Purchase order management.
 *
 *   tray po create --supplier "Mouser" --notes "Synth restock"
 *   tray po list [--status draft|ordered|partial|received|cancelled]
 *   tray po show <id>
 *   tray po add <po_id> <part> --qty 100 [--price 0.58] [--currency USD]
 *   tray po submit <po_id>
 *   tray po cancel <po_id>
 *   tray po receive <po_id> [--line <line_id> --qty N] [--location "Shelf A"]
 */

import { Command } from "@cliffy/command";
import { getClient, cleanup } from "../client.ts";
import { output, outputError, detectFormat } from "../output/format.ts";

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

const poCreateCommand = new Command()
  .name("create")
  .description("Create a new purchase order for a supplier")
  .option("--supplier <supplier:string>", "Supplier name or ID", { required: true })
  .option("--notes <notes:string>", "Notes")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const res = await client.api["purchase-orders"].$post({
        json: { supplier: options.supplier, notes: options.notes },
      });
      if (!res.ok) {
        const err = await res.json();
        outputError("error", (err as { message?: string }).message ?? "Failed to create PO", format);
        Deno.exit(1);
      }
      const po = await res.json();
      if (format !== "json") {
        // deno-lint-ignore no-explicit-any
        const p = po as any;
        console.log(`PO #${p.id} (draft) created for supplier ${options.supplier}`);
      } else {
        output(po, { format });
      }
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

const poListCommand = new Command()
  .name("list")
  .description("List purchase orders")
  .alias("ls")
  .option("--status <status:string>", "Filter by status (draft, ordered, partial, received, cancelled)")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const query: Record<string, string> = {};
      if (options.status) query.status = options.status;
      const res = await client.api["purchase-orders"].$get({ query });
      if (!res.ok) {
        outputError("error", "Failed to list purchase orders", format);
        Deno.exit(1);
      }
      output(await res.json(), {
        format,
        columns: ["id", "status", "supplier_name", "total_cost", "created_at"],
      });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

const poShowCommand = new Command()
  .name("show")
  .description("Show purchase order details with lines")
  .arguments("<id:integer>")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, id) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const res = await client.api["purchase-orders"][":id"].$get({
        param: { id: String(id) },
      });
      if (!res.ok) {
        outputError("not_found", `Purchase order ${id} not found`, format);
        Deno.exit(1);
      }
      const po = await res.json();
      if (format === "json") {
        output(po, { format });
      } else {
        // deno-lint-ignore no-explicit-any
        const p = po as any;
        console.log(`Purchase Order #${p.id} [${p.status}]`);
        console.log(`  Supplier: ${p.supplier_name}`);
        if (p.notes) console.log(`  Notes:    ${p.notes}`);
        console.log(`  Created:  ${p.created_at.split("T")[0]}`);
        console.log();

        if (p.lines.length > 0) {
          console.log("Lines:");
          output(p.lines, {
            format: "table",
            columns: ["id", "part_name", "supplier_part_sku", "quantity_ordered", "quantity_received", "unit_price", "currency"],
          });
          console.log();
          const costStr = p.total_cost > 0 ? `$${p.total_cost.toFixed(2)}` : "(no pricing)";
          console.log(`Total: ${costStr}`);
        } else {
          console.log("  (no lines)");
        }
      }
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

const poAddCommand = new Command()
  .name("add")
  .description("Add a part line to a purchase order")
  .arguments("<po_id:integer> <part:string>")
  .option("--qty <quantity:integer>", "Quantity to order", { required: true })
  .option("--price <price:number>", "Unit price (overrides auto-fill from price breaks)")
  .option("--currency <currency:string>", "Currency code", { default: "USD" })
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, poId, partIdOrName) => {
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

      // Add line via part_id (server resolves supplier_part + auto-fills price)
      const res = await client.api["purchase-orders"][":id"].lines.$post({
        param: { id: String(poId) },
        json: {
          part_id: part.id as number,
          quantity_ordered: options.qty,
          unit_price: options.price,
          currency: options.currency,
        },
      });

      if (!res.ok) {
        const err = await res.json();
        outputError("error", (err as { message?: string }).message ?? "Failed to add line", format);
        Deno.exit(1);
      }

      const line = await res.json();

      if (format === "json") {
        output(line, { format });
      } else {
        // deno-lint-ignore no-explicit-any
        const l = line as any;
        if (l.supplier_part_created) {
          console.log(`Linked "${l.part_name}" to PO supplier (no SKU)`);
        }
        const priceStr = l.unit_price != null
          ? ` @ ${l.currency ?? "USD"} ${Number(l.unit_price).toFixed(4)}${l.price_auto_filled ? " (from price breaks)" : ""}`
          : " (no price)";
        const skuStr = l.supplier_part_sku ? ` (SKU: ${l.supplier_part_sku})` : "";
        console.log(`Added: ${l.part_name} x${l.quantity_ordered}${priceStr}${skuStr}`);
      }
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

const poSubmitCommand = new Command()
  .name("submit")
  .description("Mark a purchase order as ordered")
  .arguments("<po_id:integer>")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, poId) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const res = await client.api["purchase-orders"][":id"].$patch({
        param: { id: String(poId) },
        json: { status: "ordered" },
      });
      if (!res.ok) {
        const err = await res.json();
        outputError("error", (err as { message?: string }).message ?? "Failed to submit PO", format);
        Deno.exit(1);
      }
      const po = await res.json();
      if (format === "json") {
        output(po, { format });
      } else {
        console.log(`PO #${poId}: draft -> ordered`);
      }
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });

// ---------------------------------------------------------------------------
// cancel
// ---------------------------------------------------------------------------

const poCancelCommand = new Command()
  .name("cancel")
  .description("Cancel a purchase order")
  .arguments("<po_id:integer>")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, poId) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const res = await client.api["purchase-orders"][":id"].$patch({
        param: { id: String(poId) },
        json: { status: "cancelled" },
      });
      if (!res.ok) {
        const err = await res.json();
        outputError("error", (err as { message?: string }).message ?? "Failed to cancel PO", format);
        Deno.exit(1);
      }
      const po = await res.json();
      if (format === "json") {
        output(po, { format });
      } else {
        console.log(`PO #${poId}: cancelled`);
      }
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });

// ---------------------------------------------------------------------------
// receive
// ---------------------------------------------------------------------------

const poReceiveCommand = new Command()
  .name("receive")
  .description("Receive items on a purchase order")
  .arguments("<po_id:integer>")
  .option("--line <line_id:integer>", "Receive a specific PO line (by line ID)")
  .option("--qty <quantity:integer>", "Quantity to receive (required with --line for partial)")
  .option("--location <location:string>", "Storage location for received stock")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, poId) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });

      if (options.line) {
        // Single line receive
        const qty = options.qty;
        if (!qty) {
          outputError("validation", "--qty is required when using --line", format);
          Deno.exit(1);
        }

        const res = await client.api["po-lines"][":id"].receive.$post({
          param: { id: String(options.line) },
          json: { quantity_received: qty, location: options.location },
        });
        if (!res.ok) {
          const err = await res.json();
          outputError("receive_error", (err as { message?: string }).message ?? "Failed to receive", format);
          Deno.exit(1);
        }
        const line = await res.json();
        if (format === "json") {
          output(line, { format });
        } else {
          // deno-lint-ignore no-explicit-any
          const l = line as any;
          const locStr = options.location ? ` -> ${options.location}` : "";
          console.log(`Received: line #${l.id} x${qty}${locStr}`);
        }
      } else {
        // Receive all outstanding lines on the PO
        const poRes = await client.api["purchase-orders"][":id"].$get({
          param: { id: String(poId) },
        });
        if (!poRes.ok) {
          outputError("not_found", `Purchase order ${poId} not found`, format);
          Deno.exit(1);
        }
        // deno-lint-ignore no-explicit-any
        const po = (await poRes.json()) as any;
        const outstandingLines = po.lines.filter(
          // deno-lint-ignore no-explicit-any
          (l: any) => l.quantity_received < l.quantity_ordered,
        );

        if (outstandingLines.length === 0) {
          if (format === "json") {
            output({ message: "All lines already received", po_id: poId }, { format });
          } else {
            console.log(`PO #${poId}: all lines already received`);
          }
          return;
        }

        const results = [];
        // deno-lint-ignore no-explicit-any
        for (const line of outstandingLines as any[]) {
          const remaining = line.quantity_ordered - line.quantity_received;
          const qty = options.qty ?? remaining; // --qty without --line caps per-line
          const actual = Math.min(qty, remaining);

          const res = await client.api["po-lines"][":id"].receive.$post({
            param: { id: String(line.id) },
            json: { quantity_received: actual, location: options.location },
          });
          if (!res.ok) {
            const err = await res.json();
            outputError("receive_error", (err as { message?: string }).message ?? `Failed to receive line ${line.id}`, format);
            Deno.exit(1);
          }
          results.push({ line_id: line.id, part_name: line.part_name, quantity: actual });
        }

        if (format === "json") {
          output({ po_id: poId, received: results }, { format });
        } else {
          const locStr = options.location ? ` -> ${options.location}` : "";
          for (const r of results) {
            console.log(`Received: ${r.part_name} x${r.quantity}${locStr}`);
          }
          // Fetch updated PO to show new status
          const updatedRes = await client.api["purchase-orders"][":id"].$get({
            param: { id: String(poId) },
          });
          if (updatedRes.ok) {
            // deno-lint-ignore no-explicit-any
            const updated = (await updatedRes.json()) as any;
            console.log(`PO #${poId}: ${po.status} -> ${updated.status}`);
          }
        }
      }
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

export const poCommand = new Command()
  .name("po")
  .description("Purchase order management")
  .command("create", poCreateCommand)
  .command("list", poListCommand)
  .command("show", poShowCommand)
  .command("add", poAddCommand)
  .command("submit", poSubmitCommand)
  .command("cancel", poCancelCommand)
  .command("receive", poReceiveCommand);
