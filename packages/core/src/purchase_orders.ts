/**
 * Purchase Order domain: create POs, add lines, receive stock.
 *
 * A PurchaseOrder is placed with a Supplier. It has PO lines that
 * reference SupplierParts. When items are received, stock is added.
 */

import type { Kysely } from "kysely";
import { recordAudit } from "./audit.ts";
import { addStock } from "./stock.ts";
import { createSupplierPart, getPriceBreaks } from "./suppliers.ts";
import type {
  Database,
  PoLine,
  PurchaseOrder,
  Supplier,
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

/**
 * Update a purchase order's mutable fields (status, notes).
 */
export async function updatePurchaseOrder(
  db: Kysely<Database>,
  id: number,
  input: { status?: string; notes?: string },
): Promise<PurchaseOrder> {
  const existing = await db.selectFrom("purchase_orders").selectAll().where("id", "=", id).executeTakeFirst();
  if (!existing) throw new Error(`Purchase order ${id} not found`);

  const updates: Record<string, unknown> = {};
  if (input.status !== undefined) updates.status = input.status;
  if (input.notes !== undefined) updates.notes = input.notes;

  if (Object.keys(updates).length === 0) return existing;

  const updated = await db
    .updateTable("purchase_orders")
    .set(updates)
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow();

  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  if (input.status !== undefined) {
    oldValues.status = existing.status;
    newValues.status = input.status;
  }
  if (input.notes !== undefined) {
    oldValues.notes = existing.notes;
    newValues.notes = input.notes;
  }

  await recordAudit(db, {
    entity_type: "purchase_order",
    entity_id: id,
    action: "update",
    old_values: oldValues,
    new_values: newValues,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Supplier / Part Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a supplier by name or numeric ID string.
 * Throws if not found.
 */
export async function resolveSupplier(
  db: Kysely<Database>,
  nameOrId: string,
): Promise<Supplier> {
  // Try numeric ID first
  const asNum = Number(nameOrId);
  if (Number.isInteger(asNum) && asNum > 0) {
    const byId = await db.selectFrom("suppliers").selectAll().where("id", "=", asNum).executeTakeFirst();
    if (byId) return byId;
  }

  // Try exact name match (case-insensitive)
  const byName = await db
    .selectFrom("suppliers")
    .selectAll()
    .where((eb) => eb.fn("lower", ["name"]), "=", nameOrId.toLowerCase())
    .executeTakeFirst();
  if (byName) return byName;

  throw new Error(`Supplier '${nameOrId}' not found`);
}

/**
 * Find an existing supplier_part for a part+supplier combo, or create one.
 * Returns { supplier_part_id, created } so callers can report auto-linking.
 */
async function resolveOrCreateSupplierPart(
  db: Kysely<Database>,
  partId: number,
  supplierId: number,
): Promise<{ supplier_part_id: number; created: boolean }> {
  // Look for existing link
  const existing = await db
    .selectFrom("supplier_parts")
    .select("id")
    .where("part_id", "=", partId)
    .where("supplier_id", "=", supplierId)
    .executeTakeFirst();

  if (existing) return { supplier_part_id: existing.id, created: false };

  // Auto-create a minimal supplier_part link
  const sp = await createSupplierPart(db, {
    part_id: partId,
    supplier_id: supplierId,
  });

  return { supplier_part_id: sp.id, created: true };
}

/**
 * Look up the best price break for a supplier_part at a given quantity.
 * Returns the unit price and currency, or undefined if no breaks exist.
 */
async function autoFillPrice(
  db: Kysely<Database>,
  supplierPartId: number,
  quantity: number,
): Promise<{ unit_price: number; currency: string } | undefined> {
  const breaks = await getPriceBreaks(db, supplierPartId);
  if (breaks.length === 0) return undefined;

  // Find the applicable break: largest min_quantity <= requested qty
  const applicable = breaks
    .filter((pb) => pb.min_quantity <= quantity)
    .sort((a, b) => b.min_quantity - a.min_quantity);

  if (applicable.length === 0) return undefined;
  return { unit_price: applicable[0].price, currency: applicable[0].currency };
}

// ---------------------------------------------------------------------------
// PO Lines
// ---------------------------------------------------------------------------

/** Result of adding a PO line, with extra context for the caller. */
export interface AddPoLineResult extends PoLine {
  part_name: string;
  supplier_part_sku: string | null;
  supplier_part_created: boolean;
  price_auto_filled: boolean;
}

/**
 * Add a line to a purchase order.
 *
 * Accepts either `supplier_part_id` (direct) or `part_id` (resolved
 * server-side to the supplier_part for this PO's supplier, auto-creating
 * the link if needed). When `part_id` is used and no explicit `unit_price`
 * is provided, price is auto-filled from price breaks.
 */
export async function addPoLine(
  db: Kysely<Database>,
  input: {
    purchase_order_id: number;
    quantity_ordered: number;
    unit_price?: number;
    currency?: string;
  } & ({ supplier_part_id: number } | { part_id: number }),
): Promise<AddPoLineResult> {
  // Verify PO exists and get supplier_id
  const po = await db.selectFrom("purchase_orders").selectAll()
    .where("id", "=", input.purchase_order_id).executeTakeFirst();
  if (!po) throw new Error(`Purchase order ${input.purchase_order_id} not found`);

  let supplierPartId: number;
  let supplierPartCreated = false;

  if ("supplier_part_id" in input && input.supplier_part_id !== undefined) {
    // Direct supplier_part_id -- verify it exists
    const sp = await db.selectFrom("supplier_parts").select("id")
      .where("id", "=", input.supplier_part_id).executeTakeFirst();
    if (!sp) throw new Error(`Supplier part ${input.supplier_part_id} not found`);
    supplierPartId = input.supplier_part_id;
  } else if ("part_id" in input && input.part_id !== undefined) {
    // Resolve part_id to supplier_part for this PO's supplier
    const part = await db.selectFrom("parts").select("id")
      .where("id", "=", input.part_id).executeTakeFirst();
    if (!part) throw new Error(`Part ${input.part_id} not found`);

    const resolved = await resolveOrCreateSupplierPart(db, input.part_id, po.supplier_id);
    supplierPartId = resolved.supplier_part_id;
    supplierPartCreated = resolved.created;
  } else {
    throw new Error("Either supplier_part_id or part_id is required");
  }

  // Auto-fill price from price breaks if not explicitly provided
  let unitPrice = input.unit_price ?? null;
  let currency = input.currency ?? null;
  let priceAutoFilled = false;

  if (unitPrice === null || unitPrice === undefined) {
    const autoPrice = await autoFillPrice(db, supplierPartId, input.quantity_ordered);
    if (autoPrice) {
      unitPrice = autoPrice.unit_price;
      currency = currency ?? autoPrice.currency;
      priceAutoFilled = true;
    }
  }

  if (currency === null && unitPrice !== null) {
    currency = "USD"; // default currency when price is set
  }

  const line = await db
    .insertInto("po_lines")
    .values({
      purchase_order_id: input.purchase_order_id,
      supplier_part_id: supplierPartId,
      quantity_ordered: input.quantity_ordered,
      quantity_received: 0,
      unit_price: unitPrice,
      currency,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // Look up part name and SKU for the response
  const sp = await db.selectFrom("supplier_parts")
    .select(["part_id", "sku"]).where("id", "=", supplierPartId).executeTakeFirstOrThrow();
  const part = await db.selectFrom("parts")
    .select("name").where("id", "=", sp.part_id).executeTakeFirstOrThrow();

  return {
    ...line,
    part_name: part.name,
    supplier_part_sku: sp.sku,
    supplier_part_created: supplierPartCreated,
    price_auto_filled: priceAutoFilled,
  };
}

/**
 * Update a PO line's mutable fields (quantity_ordered, unit_price, currency).
 * Only allowed on POs in draft or ordered status.
 */
export async function updatePoLine(
  db: Kysely<Database>,
  id: number,
  input: { quantity_ordered?: number; unit_price?: number | null; currency?: string | null },
): Promise<PoLine> {
  const line = await db.selectFrom("po_lines").selectAll().where("id", "=", id).executeTakeFirst();
  if (!line) throw new Error(`PO line ${id} not found`);

  // Verify PO is in an editable state
  const po = await db.selectFrom("purchase_orders").select("status")
    .where("id", "=", line.purchase_order_id).executeTakeFirstOrThrow();
  if (po.status === "received" || po.status === "cancelled") {
    throw new Error(`Cannot edit lines on a ${po.status} purchase order`);
  }

  // Don't allow reducing quantity below already-received amount
  if (input.quantity_ordered !== undefined && input.quantity_ordered < line.quantity_received) {
    throw new Error(
      `Cannot set quantity to ${input.quantity_ordered}: already received ${line.quantity_received}`,
    );
  }

  const updates: Record<string, unknown> = {};
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  if (input.quantity_ordered !== undefined) {
    oldValues.quantity_ordered = line.quantity_ordered;
    newValues.quantity_ordered = input.quantity_ordered;
    updates.quantity_ordered = input.quantity_ordered;
  }
  if (input.unit_price !== undefined) {
    oldValues.unit_price = line.unit_price;
    newValues.unit_price = input.unit_price;
    updates.unit_price = input.unit_price;
  }
  if (input.currency !== undefined) {
    oldValues.currency = line.currency;
    newValues.currency = input.currency;
    updates.currency = input.currency;
  }

  if (Object.keys(updates).length === 0) return line;

  const updated = await db
    .updateTable("po_lines")
    .set(updates)
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await recordAudit(db, {
    entity_type: "po_line",
    entity_id: id,
    action: "update",
    old_values: oldValues,
    new_values: newValues,
  });

  return updated;
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
