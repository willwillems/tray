/**
 * Supplier domain: suppliers, supplier parts, and price breaks.
 *
 * A Supplier is a vendor (DigiKey, Mouser, etc.).
 * A SupplierPart links a Part to a Supplier with a SKU and optional URL.
 * PriceBreaks define quantity-based pricing tiers for a SupplierPart.
 */

import type { Kysely } from "kysely";
import { recordAudit } from "./audit.ts";
import type {
  Database,
  PriceBreak,
  Supplier,
  SupplierPart,
} from "./schema.ts";

// ---------------------------------------------------------------------------
// Enriched types for API responses
// ---------------------------------------------------------------------------

export interface SupplierPartWithDetails extends SupplierPart {
  supplier_name: string;
  part_name: string;
  price_breaks: PriceBreak[];
}

export interface SupplierWithPartCount extends Supplier {
  part_count: number;
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function createSupplier(
  db: Kysely<Database>,
  input: { name: string; url?: string; notes?: string },
): Promise<Supplier> {
  const supplier = await db
    .insertInto("suppliers")
    .values({
      name: input.name,
      url: input.url ?? null,
      notes: input.notes ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await recordAudit(db, {
    entity_type: "supplier",
    entity_id: supplier.id,
    action: "create",
    new_values: supplier as unknown as Record<string, unknown>,
  });

  return supplier;
}

export async function getSupplier(
  db: Kysely<Database>,
  id: number,
): Promise<SupplierWithPartCount | undefined> {
  const supplier = await db
    .selectFrom("suppliers")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  if (!supplier) return undefined;

  const countRow = await db
    .selectFrom("supplier_parts")
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("supplier_id", "=", id)
    .executeTakeFirstOrThrow();

  return { ...supplier, part_count: Number(countRow.count) };
}

export async function listSuppliers(
  db: Kysely<Database>,
): Promise<SupplierWithPartCount[]> {
  const suppliers = await db
    .selectFrom("suppliers")
    .selectAll()
    .orderBy("name")
    .execute();

  // Batch load part counts
  const counts = await db
    .selectFrom("supplier_parts")
    .select(["supplier_id"])
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .groupBy("supplier_id")
    .execute();

  const countMap = new Map(counts.map((r) => [r.supplier_id, Number(r.count)]));

  return suppliers.map((s) => ({
    ...s,
    part_count: countMap.get(s.id) ?? 0,
  }));
}

export async function updateSupplier(
  db: Kysely<Database>,
  id: number,
  input: { name?: string; url?: string | null; notes?: string | null },
): Promise<Supplier> {
  const existing = await db
    .selectFrom("suppliers")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!existing) throw new Error(`Supplier ${id} not found`);

  const updated = await db
    .updateTable("suppliers")
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.url !== undefined && { url: input.url }),
      ...(input.notes !== undefined && { notes: input.notes }),
    })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await recordAudit(db, {
    entity_type: "supplier",
    entity_id: id,
    action: "update",
    old_values: existing as unknown as Record<string, unknown>,
    new_values: updated as unknown as Record<string, unknown>,
  });

  return updated;
}

export async function deleteSupplier(
  db: Kysely<Database>,
  id: number,
): Promise<void> {
  const existing = await db
    .selectFrom("suppliers")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!existing) throw new Error(`Supplier ${id} not found`);

  // CASCADE will delete supplier_parts and their price_breaks
  await db.deleteFrom("suppliers").where("id", "=", id).execute();

  await recordAudit(db, {
    entity_type: "supplier",
    entity_id: id,
    action: "delete",
    old_values: existing as unknown as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// Supplier Parts (linking a Part to a Supplier)
// ---------------------------------------------------------------------------

export async function createSupplierPart(
  db: Kysely<Database>,
  input: {
    part_id: number;
    supplier_id: number;
    sku?: string;
    url?: string;
    notes?: string;
    price_breaks?: { min_quantity: number; price: number; currency?: string }[];
  },
): Promise<SupplierPartWithDetails> {
  // Verify part and supplier exist
  const part = await db.selectFrom("parts").select(["id", "name"]).where("id", "=", input.part_id).executeTakeFirst();
  if (!part) throw new Error(`Part ${input.part_id} not found`);

  const supplier = await db.selectFrom("suppliers").select(["id", "name"]).where("id", "=", input.supplier_id).executeTakeFirst();
  if (!supplier) throw new Error(`Supplier ${input.supplier_id} not found`);

  const sp = await db
    .insertInto("supplier_parts")
    .values({
      part_id: input.part_id,
      supplier_id: input.supplier_id,
      sku: input.sku ?? null,
      url: input.url ?? null,
      notes: input.notes ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // Insert price breaks
  const breaks: PriceBreak[] = [];
  if (input.price_breaks && input.price_breaks.length > 0) {
    for (const pb of input.price_breaks) {
      const row = await db
        .insertInto("price_breaks")
        .values({
          supplier_part_id: sp.id,
          min_quantity: pb.min_quantity,
          price: pb.price,
          currency: pb.currency ?? "USD",
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      breaks.push(row);
    }
  }

  await recordAudit(db, {
    entity_type: "supplier_part",
    entity_id: sp.id,
    action: "create",
    new_values: { ...sp, price_breaks: breaks },
  });

  return {
    ...sp,
    supplier_name: supplier.name,
    part_name: part.name,
    price_breaks: breaks,
  };
}

export async function getSupplierPartsForPart(
  db: Kysely<Database>,
  partId: number,
): Promise<SupplierPartWithDetails[]> {
  const sps = await db
    .selectFrom("supplier_parts")
    .selectAll()
    .where("part_id", "=", partId)
    .execute();

  return await enrichSupplierParts(db, sps);
}

export async function getSupplierPartsForSupplier(
  db: Kysely<Database>,
  supplierId: number,
): Promise<SupplierPartWithDetails[]> {
  const sps = await db
    .selectFrom("supplier_parts")
    .selectAll()
    .where("supplier_id", "=", supplierId)
    .execute();

  return await enrichSupplierParts(db, sps);
}

export async function deleteSupplierPart(
  db: Kysely<Database>,
  id: number,
): Promise<void> {
  const existing = await db
    .selectFrom("supplier_parts")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!existing) throw new Error(`Supplier part ${id} not found`);

  await db.deleteFrom("supplier_parts").where("id", "=", id).execute();

  await recordAudit(db, {
    entity_type: "supplier_part",
    entity_id: id,
    action: "delete",
    old_values: existing as unknown as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// Price Breaks
// ---------------------------------------------------------------------------

export async function addPriceBreak(
  db: Kysely<Database>,
  supplierPartId: number,
  input: { min_quantity: number; price: number; currency?: string },
): Promise<PriceBreak> {
  const sp = await db.selectFrom("supplier_parts").select("id").where("id", "=", supplierPartId).executeTakeFirst();
  if (!sp) throw new Error(`Supplier part ${supplierPartId} not found`);

  return await db
    .insertInto("price_breaks")
    .values({
      supplier_part_id: supplierPartId,
      min_quantity: input.min_quantity,
      price: input.price,
      currency: input.currency ?? "USD",
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function getPriceBreaks(
  db: Kysely<Database>,
  supplierPartId: number,
): Promise<PriceBreak[]> {
  return await db
    .selectFrom("price_breaks")
    .selectAll()
    .where("supplier_part_id", "=", supplierPartId)
    .orderBy("min_quantity")
    .execute();
}

/**
 * Get the best price for a given quantity across all suppliers for a part.
 */
export async function getBestPrice(
  db: Kysely<Database>,
  partId: number,
  quantity: number,
): Promise<{
  supplier_part: SupplierPartWithDetails;
  price_break: PriceBreak;
  unit_price: number;
  total_price: number;
} | null> {
  const sps = await getSupplierPartsForPart(db, partId);
  if (sps.length === 0) return null;

  let best: {
    supplier_part: SupplierPartWithDetails;
    price_break: PriceBreak;
    unit_price: number;
    total_price: number;
  } | null = null;

  for (const sp of sps) {
    // Find the applicable price break (largest min_quantity <= requested quantity)
    const applicable = sp.price_breaks
      .filter((pb) => pb.min_quantity <= quantity)
      .sort((a, b) => b.min_quantity - a.min_quantity);

    if (applicable.length > 0) {
      const pb = applicable[0];
      const total = pb.price * quantity;
      if (!best || pb.price < best.unit_price) {
        best = {
          supplier_part: sp,
          price_break: pb,
          unit_price: pb.price,
          total_price: total,
        };
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function enrichSupplierParts(
  db: Kysely<Database>,
  sps: SupplierPart[],
): Promise<SupplierPartWithDetails[]> {
  if (sps.length === 0) return [];

  const ids = sps.map((sp) => sp.id);

  // Batch load price breaks
  const allBreaks = await db
    .selectFrom("price_breaks")
    .selectAll()
    .where("supplier_part_id", "in", ids)
    .orderBy("min_quantity")
    .execute();

  const breaksBySpId = new Map<number, PriceBreak[]>();
  for (const pb of allBreaks) {
    if (!breaksBySpId.has(pb.supplier_part_id)) breaksBySpId.set(pb.supplier_part_id, []);
    breaksBySpId.get(pb.supplier_part_id)!.push(pb);
  }

  // Batch load supplier and part names
  const supplierIds = [...new Set(sps.map((sp) => sp.supplier_id))];
  const partIds = [...new Set(sps.map((sp) => sp.part_id))];

  const suppliers = await db
    .selectFrom("suppliers")
    .select(["id", "name"])
    .where("id", "in", supplierIds)
    .execute();
  const supplierMap = new Map(suppliers.map((s) => [s.id, s.name]));

  const parts = await db
    .selectFrom("parts")
    .select(["id", "name"])
    .where("id", "in", partIds)
    .execute();
  const partMap = new Map(parts.map((p) => [p.id, p.name]));

  return sps.map((sp) => ({
    ...sp,
    supplier_name: supplierMap.get(sp.supplier_id) ?? "",
    part_name: partMap.get(sp.part_id) ?? "",
    price_breaks: breaksBySpId.get(sp.id) ?? [],
  }));
}
