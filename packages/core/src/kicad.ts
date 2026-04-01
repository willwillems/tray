/**
 * KiCad HTTP Library adapter.
 *
 * Transforms internal Tray data into the exact JSON shapes KiCad expects.
 * Critical rule: ALL values must be strings. No numbers, no booleans, no nulls.
 *
 * Contract source: https://dev-docs.kicad.org/en/apis-and-binding/http-libraries/
 */

import type { Kysely } from "kysely";
import type { Database } from "./schema.ts";

// ---------------------------------------------------------------------------
// KiCad contract types (what KiCad expects)
// ---------------------------------------------------------------------------

/** Root endpoint validation response */
export interface KicadRoot {
  categories: string;
  parts: string;
}

/** Category as KiCad expects it */
export interface KicadCategory {
  id: string;
  name: string;
  description: string;
}

/** Part summary for category listing (Symbol Chooser) */
export interface KicadPartSummary {
  id: string;
  name: string;
  description: string;
}

/** Field value with optional visibility */
export interface KicadFieldValue {
  value: string;
  visible?: string;
}

/** Full part detail response */
export interface KicadPartDetail {
  id: string;
  name: string;
  symbolIdStr: string;
  exclude_from_bom: string;
  exclude_from_board: string;
  exclude_from_sim: string;
  fields: Record<string, KicadFieldValue>;
}

// ---------------------------------------------------------------------------
// Adapter functions
// ---------------------------------------------------------------------------

/**
 * Root endpoint: returns the endpoint map KiCad uses for validation.
 */
export function getKicadRoot(): KicadRoot {
  return {
    categories: "",
    parts: "",
  };
}

/**
 * Fetch all categories formatted for KiCad.
 */
export async function getKicadCategories(
  db: Kysely<Database>,
): Promise<KicadCategory[]> {
  const categories = await db
    .selectFrom("categories")
    .selectAll()
    .orderBy("name")
    .execute();

  // Build full path names for categories
  const catMap = new Map(categories.map((c) => [c.id, c]));

  function getPath(id: number): string {
    const segments: string[] = [];
    let currentId: number | null = id;
    while (currentId !== null) {
      const cat = catMap.get(currentId);
      if (!cat) break;
      segments.unshift(cat.name);
      currentId = cat.parent_id;
    }
    return segments.join("/");
  }

  return categories.map((cat) => ({
    id: String(cat.id),
    name: getPath(cat.id),
    description: cat.description ?? "",
  }));
}

/**
 * Fetch parts in a category formatted for KiCad's Symbol Chooser.
 * Only returns minimal data (id, name, description) for performance.
 */
export async function getKicadPartsForCategory(
  db: Kysely<Database>,
  categoryId: string,
): Promise<KicadPartSummary[]> {
  const catId = parseInt(categoryId, 10);

  // If the category ID is not numeric, try to find by name
  let categoryIds: number[];
  if (isNaN(catId)) {
    const cat = await db
      .selectFrom("categories")
      .select("id")
      .where("name", "=", categoryId)
      .executeTakeFirst();
    categoryIds = cat ? [cat.id] : [];
  } else {
    // Include this category and all descendants
    categoryIds = await getCategoryDescendantIds(db, catId);
  }

  if (categoryIds.length === 0) return [];

  const parts = await db
    .selectFrom("parts")
    .select(["id", "name", "description"])
    .where("category_id", "in", categoryIds)
    .where("is_template", "=", 0)
    .orderBy("name")
    .execute();

  return parts.map((p) => ({
    id: String(p.id),
    name: p.name,
    description: p.description ?? "",
  }));
}

/**
 * Fetch full part detail formatted for KiCad.
 * All values are strings. Fields include footprint, datasheet, value, reference,
 * and any custom parameters.
 */
export async function getKicadPartDetail(
  db: Kysely<Database>,
  partId: string,
): Promise<KicadPartDetail | null> {
  const id = parseInt(partId, 10);
  if (isNaN(id)) return null;

  const part = await db
    .selectFrom("parts")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  if (!part) return null;

  // Build fields dict
  const fields: Record<string, KicadFieldValue> = {};

  // Standard KiCad fields
  fields["reference"] = {
    value: part.ipn ?? "U",
  };

  fields["value"] = {
    value: part.name,
  };

  fields["footprint"] = {
    value: part.kicad_footprint ?? part.footprint ?? "",
    visible: "False",
  };

  fields["datasheet"] = {
    value: part.datasheet_url ?? "",
    visible: "False",
  };

  fields["description"] = {
    value: part.description ?? "",
    visible: "False",
  };

  fields["keywords"] = {
    value: part.keywords ?? "",
    visible: "False",
  };

  // Manufacturer info as custom fields
  if (part.manufacturer) {
    fields["manufacturer"] = {
      value: part.manufacturer,
      visible: "False",
    };
  }

  if (part.mpn) {
    fields["mpn"] = {
      value: part.mpn,
      visible: "False",
    };
  }

  if (part.ipn) {
    fields["ipn"] = {
      value: part.ipn,
      visible: "False",
    };
  }

  // Stock as a custom field (informational)
  fields["stock"] = {
    value: String(part.stock),
    visible: "False",
  };

  // Part parameters as custom fields
  const params = await db
    .selectFrom("part_parameters")
    .select(["key", "value"])
    .where("part_id", "=", id)
    .execute();

  for (const param of params) {
    fields[param.key] = {
      value: param.value,
      visible: "False",
    };
  }

  return {
    id: String(part.id),
    name: part.name,
    symbolIdStr: part.kicad_symbol_id ?? "",
    exclude_from_bom: "False",
    exclude_from_board: "False",
    exclude_from_sim: "True",
    fields,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { sql } from "kysely";

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
