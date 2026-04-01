/**
 * Purchase Order domain: create POs, add lines, receive stock.
 *
 * A PurchaseOrder is placed with a Supplier. It has PO lines that
 * reference SupplierParts. When items are received, stock is added.
 */

import type { Kysely } from "kysely";
import { recordAudit } from "./audit.ts";
import { addStock } from "./stock.ts";
import type {
  Database,
  PoLine,
  PurchaseOrder,
} from "./schema.ts";

// ---------------------------------------------------------------------------
// Enriched types
// ---------------------------------------------------------------------------

export interface PoLineWithDetails extends PoLine {
  part_name: string;
  supplier_part_sku: string | null;
}

export interface PurchaseOrderWithDetails extends PurchaseOrder {
  supplier_name: string;
  lines: PoLineWithDetails[];
  total_cost: number;
}

// ---------------------------------------------------------------------------
// Purchase Orders
// ---------------------------------------------------------------------------

export async function createPurchaseOrder(
  db: Kysely<Database>,
  input: { supplier_id: number; notes?: string },
): Promise<PurchaseOrder> {
  const supplier = await db.selectFrom("suppliers").select("id").where("id", "=", input.supplier_id).executeTakeFirst();
  if (!supplier) throw new Error(`Supplier ${input.supplier_id} not found`);

  const now = new Date().toISOString();
  const po = await db
    .insertInto("purchase_orders")
    .values({
      supplier_id: input.supplier_id,
      status: "draft",
      notes: input.notes ?? null,
      created_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await recordAudit(db, {
    entity_type: "purchase_order",
    entity_id: po.id,
    action: "create",
    new_values: po as unknown as Record<string, unknown>,
  });

  return po;
}

export async function getPurchaseOrder(
  db: Kysely<Database>,
  id: number,
): Promise<PurchaseOrderWithDetails | undefined> {
  const po = await db.selectFrom("purchase_orders").selectAll().where("id", "=", id).executeTakeFirst();
  if (!po) return undefined;
  return await enrichPO(db, po);
}

export async function listPurchaseOrders(
  db: Kysely<Database>,
  status?: string,
): Promise<PurchaseOrderWithDetails[]> {
  let query = db.selectFrom("purchase_orders").selectAll().orderBy("created_at", "desc");
  if (status) query = query.where("status", "=", status);
  const pos = await query.execute();

  const result: PurchaseOrderWithDetails[] = [];
  for (const po of pos) {
    result.push(await enrichPO(db, po));
  }
  return result;
}

export async function updatePurchaseOrderStatus(
  db: Kysely<Database>,
  id: number,
  status: string,
): Promise<PurchaseOrder> {
  const existing = await db.selectFrom("purchase_orders").selectAll().where("id", "=", id).executeTakeFirst();
  if (!existing) throw new Error(`Purchase order ${id} not found`);

  const updated = await db
    .updateTable("purchase_orders")
    .set({ status })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await recordAudit(db, {
    entity_type: "purchase_order",
    entity_id: id,
    action: "update",
    old_values: { status: existing.status },
    new_values: { status },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// PO Lines
// ---------------------------------------------------------------------------

export async function addPoLine(
  db: Kysely<Database>,
  input: {
    purchase_order_id: number;
    supplier_part_id: number;
    quantity_ordered: number;
    unit_price?: number;
    currency?: string;
  },
): Promise<PoLine> {
  // Verify PO exists
  const po = await db.selectFrom("purchase_orders").select("id").where("id", "=", input.purchase_order_id).executeTakeFirst();
  if (!po) throw new Error(`Purchase order ${input.purchase_order_id} not found`);

  // Verify supplier part exists
  const sp = await db.selectFrom("supplier_parts").select("id").where("id", "=", input.supplier_part_id).executeTakeFirst();
  if (!sp) throw new Error(`Supplier part ${input.supplier_part_id} not found`);

  return await db
    .insertInto("po_lines")
    .values({
      purchase_order_id: input.purchase_order_id,
      supplier_part_id: input.supplier_part_id,
      quantity_ordered: input.quantity_ordered,
      quantity_received: 0,
      unit_price: input.unit_price ?? null,
      currency: input.currency ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * Receive items on a PO line. Creates stock lots for the received quantity.
 */
export async function receivePOLine(
  db: Kysely<Database>,
  input: {
    po_line_id: number;
    quantity_received: number;
    location?: string;
  },
): Promise<PoLine> {
  const line = await db.selectFrom("po_lines").selectAll().where("id", "=", input.po_line_id).executeTakeFirst();
  if (!line) throw new Error(`PO line ${input.po_line_id} not found`);

  const totalReceived = line.quantity_received + input.quantity_received;
  if (totalReceived > line.quantity_ordered) {
    throw new Error(
      `Cannot receive ${input.quantity_received}: would exceed ordered qty (${line.quantity_ordered}, already received ${line.quantity_received})`,
    );
  }

  // Get the part_id from the supplier part
  const sp = await db
    .selectFrom("supplier_parts")
    .select("part_id")
    .where("id", "=", line.supplier_part_id)
    .executeTakeFirstOrThrow();

  // Add stock
  await addStock(db, {
    part_id: sp.part_id,
    quantity: input.quantity_received,
    location: input.location,
    notes: `PO line #${line.id} received`,
  });

  // Update received quantity
  const updated = await db
    .updateTable("po_lines")
    .set({ quantity_received: totalReceived })
    .where("id", "=", line.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  // Check if all lines are fully received -> mark PO as received
  const po = await db.selectFrom("purchase_orders").selectAll()
    .where("id", "=", line.purchase_order_id).executeTakeFirstOrThrow();

  const allLines = await db.selectFrom("po_lines").selectAll()
    .where("purchase_order_id", "=", line.purchase_order_id).execute();

  const allReceived = allLines.every((l) =>
    l.id === line.id
      ? totalReceived >= l.quantity_ordered
      : l.quantity_received >= l.quantity_ordered
  );
  const someReceived = allLines.some((l) =>
    l.id === line.id ? totalReceived > 0 : l.quantity_received > 0
  );

  if (allReceived && po.status !== "received") {
    await updatePurchaseOrderStatus(db, po.id, "received");
  } else if (someReceived && po.status !== "partial" && po.status !== "received") {
    await updatePurchaseOrderStatus(db, po.id, "partial");
  }

  await recordAudit(db, {
    entity_type: "po_line",
    entity_id: line.id,
    action: "update",
    old_values: { quantity_received: line.quantity_received },
    new_values: { quantity_received: totalReceived },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function enrichPO(
  db: Kysely<Database>,
  po: PurchaseOrder,
): Promise<PurchaseOrderWithDetails> {
  const supplier = await db
    .selectFrom("suppliers")
    .select("name")
    .where("id", "=", po.supplier_id)
    .executeTakeFirst();

  const lines = await db
    .selectFrom("po_lines")
    .selectAll()
    .where("purchase_order_id", "=", po.id)
    .orderBy("id")
    .execute();

  // Enrich lines with part names and SKUs
  const spIds = lines.map((l) => l.supplier_part_id);
  let spMap = new Map<number, { part_id: number; sku: string | null }>();
  let partMap = new Map<number, string>();

  if (spIds.length > 0) {
    const sps = await db
      .selectFrom("supplier_parts")
      .select(["id", "part_id", "sku"])
      .where("id", "in", spIds)
      .execute();
    spMap = new Map(sps.map((sp) => [sp.id, { part_id: sp.part_id, sku: sp.sku }]));

    const partIds = [...new Set(sps.map((sp) => sp.part_id))];
    if (partIds.length > 0) {
      const parts = await db
        .selectFrom("parts")
        .select(["id", "name"])
        .where("id", "in", partIds)
        .execute();
      partMap = new Map(parts.map((p) => [p.id, p.name]));
    }
  }

  const enrichedLines: PoLineWithDetails[] = lines.map((line) => {
    const sp = spMap.get(line.supplier_part_id);
    return {
      ...line,
      part_name: sp ? (partMap.get(sp.part_id) ?? "") : "",
      supplier_part_sku: sp?.sku ?? null,
    };
  });

  const totalCost = lines.reduce((sum, l) => sum + (l.unit_price ?? 0) * l.quantity_ordered, 0);

  return {
    ...po,
    supplier_name: supplier?.name ?? "",
    lines: enrichedLines,
    total_cost: totalCost,
  };
}
