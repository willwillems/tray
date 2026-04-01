/**
 * Stock domain: lot-based operations.
 *
 * All stock changes go through lots. Part.stock is a cached column
 * updated by SQLite triggers. Only lots with status='ok' count toward stock.
 *
 * Operations:
 *   addStock     - Add quantity to a part (creates or updates a lot)
 *   adjustStock  - Adjust lot quantity with a reason (for corrections, consumption)
 *   moveStock    - Move quantity between locations
 *   getStockLots - List all lots for a part
 */

import type { Kysely } from "kysely";
import { recordAudit } from "./audit.ts";
import type { Database, StockLot } from "./schema.ts";

export interface StockLotWithLocation extends StockLot {
  location_name: string | null;
  location_path: string | null;
}

/**
 * Add stock to a part. Creates a new lot or adds to an existing lot
 * at the same location with status 'ok'.
 */
export async function addStock(
  db: Kysely<Database>,
  input: {
    part_id: number;
    quantity: number;
    location_id?: number | null;
    location?: string; // slash-delimited path, resolved
    status?: string;
    expiry_date?: string;
    notes?: string;
  },
): Promise<StockLot> {
  const now = new Date().toISOString();

  // Verify part exists
  const part = await db
    .selectFrom("parts")
    .select("id")
    .where("id", "=", input.part_id)
    .executeTakeFirst();
  if (!part) throw new Error(`Part ${input.part_id} not found`);

  // Resolve location path if provided
  let locationId = input.location_id ?? null;
  if (input.location && !locationId) {
    locationId = await resolveOrCreateLocationPath(db, input.location);
  }

  const status = input.status ?? "ok";

  // Try to find an existing lot at the same location with same status
  let existingLot;
  if (locationId === null) {
    existingLot = await db
      .selectFrom("stock_lots")
      .selectAll()
      .where("part_id", "=", input.part_id)
      .where("location_id", "is", null)
      .where("status", "=", status)
      .executeTakeFirst();
  } else {
    existingLot = await db
      .selectFrom("stock_lots")
      .selectAll()
      .where("part_id", "=", input.part_id)
      .where("location_id", "=", locationId)
      .where("status", "=", status)
      .executeTakeFirst();
  }

  let lot: StockLot;

  if (existingLot) {
    // Add to existing lot
    lot = await db
      .updateTable("stock_lots")
      .set({
        quantity: existingLot.quantity + input.quantity,
        updated_at: now,
        notes: input.notes ?? existingLot.notes,
        expiry_date: input.expiry_date ?? existingLot.expiry_date,
      })
      .where("id", "=", existingLot.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  } else {
    // Create new lot
    lot = await db
      .insertInto("stock_lots")
      .values({
        part_id: input.part_id,
        location_id: locationId,
        quantity: input.quantity,
        status,
        expiry_date: input.expiry_date ?? null,
        notes: input.notes ?? null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Audit
  await recordAudit(db, {
    entity_type: "stock_lot",
    entity_id: lot.id,
    action: existingLot ? "update" : "create",
    old_values: existingLot ? { quantity: existingLot.quantity } : null,
    new_values: { quantity: lot.quantity, part_id: lot.part_id },
  });

  return lot;
}

/**
 * Adjust stock in a specific lot. The quantity can be negative (removal)
 * or positive (correction). A reason is required for traceability.
 *
 * If lot_id is not specified:
 *   - For negative adjustments: picks the largest 'ok' lot
 *   - For positive adjustments: picks the null-location 'ok' lot (or creates one)
 */
export async function adjustStock(
  db: Kysely<Database>,
  input: {
    part_id: number;
    quantity: number; // delta (positive = add, negative = remove)
    reason: string;
    lot_id?: number;
  },
): Promise<StockLot> {
  const now = new Date().toISOString();

  // Verify part exists
  const part = await db
    .selectFrom("parts")
    .select(["id", "name"])
    .where("id", "=", input.part_id)
    .executeTakeFirst();
  if (!part) throw new Error(`Part ${input.part_id} not found`);

  let lot: StockLot | undefined;

  if (input.lot_id) {
    lot = await db
      .selectFrom("stock_lots")
      .selectAll()
      .where("id", "=", input.lot_id)
      .where("part_id", "=", input.part_id)
      .executeTakeFirst();
    if (!lot) throw new Error(`Stock lot ${input.lot_id} not found for part ${input.part_id}`);
  } else if (input.quantity < 0) {
    // Negative adjustment: pick the largest 'ok' lot
    lot = await db
      .selectFrom("stock_lots")
      .selectAll()
      .where("part_id", "=", input.part_id)
      .where("status", "=", "ok")
      .orderBy("quantity", "desc")
      .executeTakeFirst();
    if (!lot) throw new Error(`No stock lots available for part '${part.name}'`);
  } else {
    // Positive adjustment: pick the null-location 'ok' lot, or create one
    lot = await db
      .selectFrom("stock_lots")
      .selectAll()
      .where("part_id", "=", input.part_id)
      .where("location_id", "is", null)
      .where("status", "=", "ok")
      .executeTakeFirst();

    if (!lot) {
      // Create a new lot with null location
      lot = await db
        .insertInto("stock_lots")
        .values({
          part_id: input.part_id,
          location_id: null,
          quantity: 0,
          status: "ok",
          expiry_date: null,
          notes: null,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    }
  }

  const newQuantity = lot.quantity + input.quantity;
  if (newQuantity < 0) {
    throw new Error(
      `Cannot adjust: lot #${lot.id} has ${lot.quantity}, tried to remove ${Math.abs(input.quantity)}`,
    );
  }

  const oldQuantity = lot.quantity;

  const updated = await db
    .updateTable("stock_lots")
    .set({
      quantity: newQuantity,
      updated_at: now,
    })
    .where("id", "=", lot.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  // Audit with reason
  await recordAudit(db, {
    entity_type: "stock_lot",
    entity_id: lot.id,
    action: "update",
    old_values: { quantity: oldQuantity },
    new_values: { quantity: newQuantity, reason: input.reason },
  });

  return updated;
}

/**
 * Move stock between locations. Removes from one lot, adds to another.
 */
export async function moveStock(
  db: Kysely<Database>,
  input: {
    part_id: number;
    quantity: number;
    from_lot_id?: number;
    from_location?: string; // slash-delimited path
    to_location: string; // slash-delimited path
    notes?: string;
  },
): Promise<{ from: StockLot; to: StockLot }> {
  if (input.quantity <= 0) throw new Error("Move quantity must be positive");

  const now = new Date().toISOString();

  // Verify part exists
  const part = await db
    .selectFrom("parts")
    .select(["id", "name"])
    .where("id", "=", input.part_id)
    .executeTakeFirst();
  if (!part) throw new Error(`Part ${input.part_id} not found`);

  // Find source lot
  let fromLot: StockLot | undefined;
  if (input.from_lot_id) {
    fromLot = await db
      .selectFrom("stock_lots")
      .selectAll()
      .where("id", "=", input.from_lot_id)
      .where("part_id", "=", input.part_id)
      .executeTakeFirst();
    if (!fromLot) throw new Error(`Source lot ${input.from_lot_id} not found`);
  } else if (input.from_location) {
    const fromLocId = await findLocationByPath(db, input.from_location);
    if (!fromLocId) throw new Error(`Source location '${input.from_location}' not found`);
    fromLot = await db
      .selectFrom("stock_lots")
      .selectAll()
      .where("part_id", "=", input.part_id)
      .where("location_id", "=", fromLocId)
      .where("status", "=", "ok")
      .executeTakeFirst();
    if (!fromLot) throw new Error(`No stock at location '${input.from_location}' for part '${part.name}'`);
  } else {
    // Pick the largest lot
    fromLot = await db
      .selectFrom("stock_lots")
      .selectAll()
      .where("part_id", "=", input.part_id)
      .where("status", "=", "ok")
      .orderBy("quantity", "desc")
      .executeTakeFirst();
    if (!fromLot) throw new Error(`No stock lots available for part '${part.name}'`);
  }

  if (fromLot.quantity < input.quantity) {
    throw new Error(
      `Cannot move: lot #${fromLot.id} has ${fromLot.quantity}, tried to move ${input.quantity}`,
    );
  }

  // Resolve destination location
  const toLocId = await resolveOrCreateLocationPath(db, input.to_location);

  // Deduct from source
  const updatedFrom = await db
    .updateTable("stock_lots")
    .set({ quantity: fromLot.quantity - input.quantity, updated_at: now })
    .where("id", "=", fromLot.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  // Add to destination (find existing lot or create new one)
  let toLot = await db
    .selectFrom("stock_lots")
    .selectAll()
    .where("part_id", "=", input.part_id)
    .where("location_id", "=", toLocId)
    .where("status", "=", "ok")
    .executeTakeFirst();

  let updatedTo: StockLot;
  if (toLot) {
    updatedTo = await db
      .updateTable("stock_lots")
      .set({ quantity: toLot.quantity + input.quantity, updated_at: now })
      .where("id", "=", toLot.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  } else {
    updatedTo = await db
      .insertInto("stock_lots")
      .values({
        part_id: input.part_id,
        location_id: toLocId,
        quantity: input.quantity,
        status: "ok",
        expiry_date: null,
        notes: input.notes ?? null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Audit
  await recordAudit(db, {
    entity_type: "stock_lot",
    entity_id: fromLot.id,
    action: "update",
    old_values: { quantity: fromLot.quantity },
    new_values: {
      quantity: updatedFrom.quantity,
      reason: `moved ${input.quantity} to lot #${updatedTo.id}`,
    },
  });

  return { from: updatedFrom, to: updatedTo };
}

/**
 * Get all stock lots for a part, with location info.
 */
export async function getStockLots(
  db: Kysely<Database>,
  partId: number,
): Promise<StockLotWithLocation[]> {
  const lots = await db
    .selectFrom("stock_lots")
    .selectAll()
    .where("part_id", "=", partId)
    .orderBy("id")
    .execute();

  // Batch load location names
  const locationIds = [
    ...new Set(lots.map((l) => l.location_id).filter((id): id is number => id !== null)),
  ];

  const locationPaths = new Map<number, { name: string; path: string }>();
  if (locationIds.length > 0) {
    const allLocations = await db
      .selectFrom("storage_locations")
      .selectAll()
      .execute();
    const locMap = new Map(allLocations.map((l) => [l.id, l]));

    for (const locId of locationIds) {
      const segments: string[] = [];
      let currentId: number | null = locId;
      while (currentId !== null) {
        const loc = locMap.get(currentId);
        if (!loc) break;
        segments.unshift(loc.name);
        currentId = loc.parent_id;
      }
      const loc = locMap.get(locId);
      locationPaths.set(locId, {
        name: loc?.name ?? "",
        path: segments.join("/"),
      });
    }
  }

  return lots.map((lot) => ({
    ...lot,
    location_name: lot.location_id ? (locationPaths.get(lot.location_id)?.name ?? null) : null,
    location_path: lot.location_id ? (locationPaths.get(lot.location_id)?.path ?? null) : null,
  }));
}

// ---------------------------------------------------------------------------
// Location helpers (also used by parts.ts via resolveOrCreateLocationPath)
// ---------------------------------------------------------------------------

/**
 * Resolve a slash-delimited location path, creating missing locations.
 */
export async function resolveOrCreateLocationPath(
  db: Kysely<Database>,
  path: string,
): Promise<number> {
  const segments = path.split("/").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) throw new Error("Location path cannot be empty");

  let parentId: number | null = null;

  for (const name of segments) {
    let existing;
    if (parentId === null) {
      existing = await db
        .selectFrom("storage_locations")
        .selectAll()
        .where("name", "=", name)
        .where("parent_id", "is", null)
        .executeTakeFirst();
    } else {
      existing = await db
        .selectFrom("storage_locations")
        .selectAll()
        .where("name", "=", name)
        .where("parent_id", "=", parentId)
        .executeTakeFirst();
    }

    if (existing) {
      parentId = existing.id;
    } else {
      const result = await db
        .insertInto("storage_locations")
        .values({ name, parent_id: parentId, description: null })
        .returning("id")
        .executeTakeFirstOrThrow();
      parentId = result.id;
    }
  }

  return parentId!;
}

/**
 * Find a location by its full slash-delimited path. Returns null if not found.
 */
async function findLocationByPath(
  db: Kysely<Database>,
  path: string,
): Promise<number | null> {
  const segments = path.split("/").map((s) => s.trim()).filter(Boolean);
  let parentId: number | null = null;

  for (const name of segments) {
    let query = db
      .selectFrom("storage_locations")
      .select("id")
      .where("name", "=", name);

    if (parentId === null) {
      query = query.where("parent_id", "is", null);
    } else {
      query = query.where("parent_id", "=", parentId);
    }

    const row = await query.executeTakeFirst();
    if (!row) return null;
    parentId = row.id;
  }

  return parentId;
}
