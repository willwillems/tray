/**
 * Part domain: CRUD, filtering, parametric search.
 *
 * Every function takes `db` as first parameter for test isolation.
 * Tags are managed via part_tags junction table.
 * Stock is a field on Part (hybrid: simple field + optional lots).
 */

import { type Kysely, sql } from "kysely";
import { recordAudit } from "./audit.ts";
import { generateThumbnail, readAttachmentFile } from "./attachments.ts";
import type { BlobStore } from "./storage.ts";
import { resolveOrCreateCategoryPath } from "./categories.ts";
import { resolveOrCreateLocationPath } from "./stock.ts";
import { parseParameterValue } from "./parameters.ts";
import { getPartTags, setPartTags } from "./search.ts";
import {
  createPartSchema,
  type CreatePartRawInput,
  type Database,
  type ListPartsRawInput,
  listPartsSchema,
  type Part,
  type UpdatePartInput,
} from "./schema.ts";

/** Part with computed fields for API responses */
export interface PartWithDetails extends Part {
  tags: string[];
  category_path: string | null;
  parameters: { key: string; value: string; unit: string | null }[];
}

/**
 * Create a new part.
 */
export async function createPart(
  db: Kysely<Database>,
  rawInput: CreatePartRawInput,
): Promise<PartWithDetails> {
  // Parse through Zod to apply defaults
  const input = createPartSchema.parse(rawInput);
  const now = new Date().toISOString();

  // Resolve category path if provided
  let categoryId = input.category_id ?? null;
  if (input.category && !categoryId) {
    categoryId = await resolveOrCreateCategoryPath(db, input.category);
  }

  // Resolve location and create stock lot if stock + location provided
  let locationId: number | null = null;
  if (input.location) {
    locationId = await resolveOrCreateLocationPath(db, input.location);
  }

  const part = await db
    .insertInto("parts")
    .values({
      name: input.name,
      description: input.description ?? null,
      category_id: categoryId,
      template_id: input.template_id ?? null,
      is_template: input.is_template ? 1 : 0,
      keywords: input.keywords ?? null,
      footprint: input.footprint ?? null,
      manufacturer: input.manufacturer ?? null,
      mpn: input.mpn ?? null,
      ipn: input.ipn ?? null,
      manufacturing_status: input.manufacturing_status ?? "unknown",
      stock: 0, // Always start at 0; trigger updates from lots
      min_stock: input.min_stock ?? 0,
      favorite: input.favorite ? 1 : 0,
      datasheet_url: input.datasheet_url ?? null,
      kicad_symbol_id: input.kicad_symbol_id ?? null,
      kicad_footprint: input.kicad_footprint ?? null,
      thumbnail: null,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // Set tags
  if (input.tags && input.tags.length > 0) {
    await setPartTags(db, part.id, input.tags);
  }

  // Insert parameters
  if (input.parameters && input.parameters.length > 0) {
    for (const param of input.parameters) {
      const parsed = parseParameterValue(param.value, param.unit);
      await db
        .insertInto("part_parameters")
        .values({
          part_id: part.id,
          key: param.key,
          value: param.value,
          value_numeric: parsed.numeric,
          unit: parsed.unit,
        })
        .execute();
    }
  }

  // Create stock lot (lot-centric: always create a lot when stock > 0)
  // The SQLite trigger will update Part.stock automatically.
  if (input.stock && input.stock > 0) {
    await db
      .insertInto("stock_lots")
      .values({
        part_id: part.id,
        location_id: locationId, // null if no location specified
        quantity: input.stock,
        status: "ok",
        notes: null,
        expiry_date: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  // Re-read the part to get the trigger-updated stock value
  const freshPart = await db
    .selectFrom("parts")
    .selectAll()
    .where("id", "=", part.id)
    .executeTakeFirstOrThrow();

  // Audit log
  await recordAudit(db, {
    entity_type: "part",
    entity_id: freshPart.id,
    action: "create",
    new_values: { ...freshPart, tags: input.tags ?? [] },
  });

  return await enrichPart(db, freshPart);
}

/**
 * Get a single part by ID or name.
 */
export async function getPart(
  db: Kysely<Database>,
  idOrName: number | string,
): Promise<PartWithDetails | undefined> {
  let part: Part | undefined;

  if (typeof idOrName === "number") {
    part = await db
      .selectFrom("parts")
      .selectAll()
      .where("id", "=", idOrName)
      .executeTakeFirst();
  } else {
    // Try exact name match first, then case-insensitive
    part = await db
      .selectFrom("parts")
      .selectAll()
      .where("name", "=", idOrName)
      .executeTakeFirst();

    if (!part) {
      // Case-insensitive fallback
      part = await db
        .selectFrom("parts")
        .selectAll()
        .where("name", "like", idOrName)
        .executeTakeFirst();
    }
  }

  if (!part) return undefined;
  return await enrichPart(db, part);
}

/**
 * List parts with optional filters.
 */
export async function listParts(
  db: Kysely<Database>,
  rawFilters?: ListPartsRawInput,
): Promise<PartWithDetails[]> {
  const filters = rawFilters ? listPartsSchema.parse(rawFilters) : undefined;
  let query = db.selectFrom("parts").selectAll();

  if (filters?.category_id) {
    query = query.where("category_id", "=", filters.category_id);
  }

  if (filters?.category) {
    // Resolve category path to ID, then include all descendants
    const catId = await findCategoryByPath(db, filters.category);
    if (catId) {
      const descendantIds = await getCategoryDescendantIds(db, catId);
      query = query.where("category_id", "in", descendantIds);
    } else {
      return []; // Category not found
    }
  }

  if (filters?.manufacturer) {
    query = query.where("manufacturer", "like", `%${filters.manufacturer}%`);
  }

  if (filters?.low) {
    // Parts where stock <= min_stock
    query = query.whereRef("stock", "<=", "min_stock");
  }

  if (filters?.favorites) {
    query = query.where("favorite", "=", 1);
  }

  const limit = filters?.limit ?? 100;
  const offset = filters?.offset ?? 0;
  query = query.orderBy("name").limit(limit).offset(offset);

  const parts = await query.execute();

  // Filter by tag if needed (requires join on part_tags)
  let filteredParts = parts;
  if (filters?.tag) {
    const taggedIds = await db
      .selectFrom("part_tags")
      .select("part_id")
      .where("tag", "=", filters.tag.toLowerCase())
      .execute();
    const idSet = new Set(taggedIds.map((r) => r.part_id));
    filteredParts = parts.filter((p) => idSet.has(p.id));
  }

  // Batch enrich with tags, category paths, parameters (3 queries total)
  return await enrichParts(db, filteredParts);
}

/**
 * Update a part.
 */
export async function updatePart(
  db: Kysely<Database>,
  id: number,
  input: UpdatePartInput,
): Promise<PartWithDetails> {
  const existing = await db
    .selectFrom("parts")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  if (!existing) throw new Error(`Part ${id} not found`);

  const now = new Date().toISOString();

  // Resolve category if needed
  let categoryId = input.category_id;
  if (input.category) {
    categoryId = await resolveOrCreateCategoryPath(db, input.category);
  }

  // Build update object, only including provided fields
  // deno-lint-ignore no-explicit-any
  const updates: Record<string, any> = { updated_at: now };

  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (categoryId !== undefined) updates.category_id = categoryId;
  if (input.template_id !== undefined) updates.template_id = input.template_id;
  if (input.is_template !== undefined) updates.is_template = input.is_template ? 1 : 0;
  if (input.keywords !== undefined) updates.keywords = input.keywords;
  if (input.footprint !== undefined) updates.footprint = input.footprint;
  if (input.manufacturer !== undefined) updates.manufacturer = input.manufacturer;
  if (input.mpn !== undefined) updates.mpn = input.mpn;
  if (input.ipn !== undefined) updates.ipn = input.ipn;
  if (input.manufacturing_status !== undefined) {
    updates.manufacturing_status = input.manufacturing_status;
  }
  if (input.min_stock !== undefined) updates.min_stock = input.min_stock;
  if (input.favorite !== undefined) updates.favorite = input.favorite ? 1 : 0;
  if (input.datasheet_url !== undefined) updates.datasheet_url = input.datasheet_url;
  if (input.kicad_symbol_id !== undefined) updates.kicad_symbol_id = input.kicad_symbol_id;
  if (input.kicad_footprint !== undefined) updates.kicad_footprint = input.kicad_footprint;

  const updated = await db
    .updateTable("parts")
    .set(updates)
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow();

  // Update tags if provided
  if (input.tags !== undefined) {
    await setPartTags(db, id, input.tags);
  }

  // Audit log
  await recordAudit(db, {
    entity_type: "part",
    entity_id: id,
    action: "update",
    old_values: existing as unknown as Record<string, unknown>,
    new_values: updated as unknown as Record<string, unknown>,
  });

  return await enrichPart(db, updated);
}

/**
 * Delete a part and all related data.
 */
export async function deletePart(
  db: Kysely<Database>,
  id: number,
): Promise<void> {
  const existing = await db
    .selectFrom("parts")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  if (!existing) throw new Error(`Part ${id} not found`);

  // Tags, stock lots, parameters, etc. are CASCADE deleted
  await db.deleteFrom("parts").where("id", "=", id).execute();

  // Audit log
  await recordAudit(db, {
    entity_type: "part",
    entity_id: id,
    action: "delete",
    old_values: existing as unknown as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// Thumbnail Management
// ---------------------------------------------------------------------------

/**
 * Set a part's thumbnail from an existing attachment.
 * Reads the attachment file, generates a 128x128 JPEG thumbnail, and stores it.
 * The attachment must belong to this part.
 */
export async function setPartThumbnail(
  db: Kysely<Database>,
  partId: number,
  attachmentId: number,
  store: BlobStore,
): Promise<PartWithDetails> {
  const part = await db.selectFrom("parts").selectAll().where("id", "=", partId).executeTakeFirst();
  if (!part) throw new Error(`Part ${partId} not found`);

  const attachment = await db.selectFrom("attachments").selectAll()
    .where("id", "=", attachmentId).executeTakeFirst();
  if (!attachment) throw new Error(`Attachment ${attachmentId} not found`);

  if (attachment.entity_type !== "part" || attachment.entity_id !== partId) {
    throw new Error(`Attachment ${attachmentId} does not belong to part ${partId}`);
  }

  const fileData = await readAttachmentFile(store, attachment.storage_key);
  const thumbBase64 = await generateThumbnail(fileData);
  if (!thumbBase64) {
    throw new Error(`Could not generate thumbnail from attachment ${attachmentId} (unsupported format or corrupt image)`);
  }

  await db.updateTable("parts").set({ thumbnail: thumbBase64 }).where("id", "=", partId).execute();

  await recordAudit(db, {
    entity_type: "part",
    entity_id: partId,
    action: "update",
    old_values: { thumbnail: part.thumbnail ? "<base64>" : null },
    new_values: { thumbnail: "<base64>", source_attachment_id: attachmentId },
  });

  const updated = await db.selectFrom("parts").selectAll().where("id", "=", partId).executeTakeFirstOrThrow();
  return await enrichPart(db, updated);
}

/**
 * Clear a part's thumbnail.
 */
export async function clearPartThumbnail(
  db: Kysely<Database>,
  partId: number,
): Promise<PartWithDetails> {
  const part = await db.selectFrom("parts").selectAll().where("id", "=", partId).executeTakeFirst();
  if (!part) throw new Error(`Part ${partId} not found`);

  await db.updateTable("parts").set({ thumbnail: null }).where("id", "=", partId).execute();

  await recordAudit(db, {
    entity_type: "part",
    entity_id: partId,
    action: "update",
    old_values: { thumbnail: part.thumbnail ? "<base64>" : null },
    new_values: { thumbnail: null },
  });

  const updated = await db.selectFrom("parts").selectAll().where("id", "=", partId).executeTakeFirstOrThrow();
  return await enrichPart(db, updated);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Enrich a single Part row. Delegates to batch enrichment.
 */
async function enrichPart(
  db: Kysely<Database>,
  part: Part,
): Promise<PartWithDetails> {
  const results = await enrichParts(db, [part]);
  return results[0];
}

/**
 * Batch-enrich Part rows with tags, category paths, and parameters.
 * Uses 3 queries total regardless of how many parts, instead of 3N.
 */
async function enrichParts(
  db: Kysely<Database>,
  parts: Part[],
): Promise<PartWithDetails[]> {
  if (parts.length === 0) return [];

  const ids = parts.map((p) => p.id);

  // Batch load all tags for these parts (1 query)
  const allTags = await db
    .selectFrom("part_tags")
    .select(["part_id", "tag"])
    .where("part_id", "in", ids)
    .orderBy("tag")
    .execute();

  const tagsByPart = new Map<number, string[]>();
  for (const row of allTags) {
    if (!tagsByPart.has(row.part_id)) tagsByPart.set(row.part_id, []);
    tagsByPart.get(row.part_id)!.push(row.tag);
  }

  // Batch load all parameters for these parts (1 query)
  const allParams = await db
    .selectFrom("part_parameters")
    .select(["part_id", "key", "value", "unit"])
    .where("part_id", "in", ids)
    .execute();

  const paramsByPart = new Map<number, { key: string; value: string; unit: string | null }[]>();
  for (const row of allParams) {
    if (!paramsByPart.has(row.part_id)) paramsByPart.set(row.part_id, []);
    paramsByPart.get(row.part_id)!.push({ key: row.key, value: row.value, unit: row.unit });
  }

  // Build category path lookup: load all categories once, resolve in memory
  const categoryIds = [...new Set(parts.map((p) => p.category_id).filter((id): id is number => id !== null))];
  const categoryPaths = new Map<number, string>();

  if (categoryIds.length > 0) {
    const allCategories = await db
      .selectFrom("categories")
      .selectAll()
      .execute();

    const catMap = new Map(allCategories.map((c) => [c.id, c]));

    for (const catId of categoryIds) {
      const segments: string[] = [];
      let currentId: number | null = catId;
      while (currentId !== null) {
        const cat = catMap.get(currentId);
        if (!cat) break;
        segments.unshift(cat.name);
        currentId = cat.parent_id;
      }
      categoryPaths.set(catId, segments.join("/"));
    }
  }

  // Assemble enriched parts
  return parts.map((part) => ({
    ...part,
    tags: tagsByPart.get(part.id) ?? [],
    category_path: part.category_id ? (categoryPaths.get(part.category_id) ?? null) : null,
    parameters: paramsByPart.get(part.id) ?? [],
  }));
}

/**
 * Find a category ID by its full path (e.g. "ICs/Timers").
 * Returns null if not found (does NOT create).
 */
async function findCategoryByPath(
  db: Kysely<Database>,
  path: string,
): Promise<number | null> {
  const segments = path.split("/").map((s) => s.trim()).filter(Boolean);
  let parentId: number | null = null;

  for (const name of segments) {
    let query = db
      .selectFrom("categories")
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

/**
 * Get a category ID and all its descendant IDs via recursive CTE.
 * Used for filtering: `--category "ICs"` includes parts in ICs/Timers, ICs/Regulators, etc.
 */
async function getCategoryDescendantIds(
  db: Kysely<Database>,
  rootId: number,
): Promise<number[]> {
  const rows = await sql<{ id: number }>`
    WITH RECURSIVE cat_tree AS (
      SELECT id FROM categories WHERE id = ${rootId}
      UNION ALL
      SELECT c.id FROM categories c
      JOIN cat_tree ct ON c.parent_id = ct.id
    )
    SELECT id FROM cat_tree
  `.execute(db);

  return rows.rows.map((r) => r.id);
}

// resolveOrCreateLocationPath is imported from stock.ts
