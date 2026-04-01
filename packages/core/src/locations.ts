/**
 * Storage location domain: hierarchical tree operations.
 *
 * Same pattern as categories: slash-delimited paths, auto-create parents.
 */

import type { Kysely } from "kysely";
import type { Database, StorageLocation } from "./schema.ts";

export interface LocationTreeNode {
  location: StorageLocation;
  children: LocationTreeNode[];
  path: string;
}

/**
 * Get a location by ID.
 */
export async function getLocation(
  db: Kysely<Database>,
  id: number,
): Promise<StorageLocation | undefined> {
  return await db
    .selectFrom("storage_locations")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

/**
 * Get the full path string for a location.
 */
export async function getLocationPath(
  db: Kysely<Database>,
  id: number,
): Promise<string> {
  const segments: string[] = [];
  let currentId: number | null = id;

  while (currentId !== null) {
    const loc = await db
      .selectFrom("storage_locations")
      .select(["name", "parent_id"])
      .where("id", "=", currentId)
      .executeTakeFirst();

    if (!loc) break;
    segments.unshift(loc.name);
    currentId = loc.parent_id;
  }

  return segments.join("/");
}

/**
 * List all locations, optionally filtered by parent.
 */
export async function listLocations(
  db: Kysely<Database>,
  parentId?: number | null,
): Promise<StorageLocation[]> {
  let query = db.selectFrom("storage_locations").selectAll();

  if (parentId !== undefined) {
    if (parentId === null) {
      query = query.where("parent_id", "is", null);
    } else {
      query = query.where("parent_id", "=", parentId);
    }
  }

  return await query.orderBy("name").execute();
}

/**
 * Build a full location tree structure.
 */
export async function getLocationTree(
  db: Kysely<Database>,
): Promise<LocationTreeNode[]> {
  const all = await db
    .selectFrom("storage_locations")
    .selectAll()
    .orderBy("name")
    .execute();

  const byParent = new Map<number | null, StorageLocation[]>();
  for (const loc of all) {
    const key = loc.parent_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(loc);
  }

  function buildTree(parentId: number | null, prefix: string): LocationTreeNode[] {
    const children = byParent.get(parentId) ?? [];
    return children.map((loc) => {
      const path = prefix ? `${prefix}/${loc.name}` : loc.name;
      return {
        location: loc,
        children: buildTree(loc.id, path),
        path,
      };
    });
  }

  return buildTree(null, "");
}

/**
 * Delete a location. Re-parents children. Stock lots at this location
 * have their location_id set to NULL (via FK ON DELETE SET NULL).
 */
export async function deleteLocation(
  db: Kysely<Database>,
  id: number,
): Promise<void> {
  const loc = await getLocation(db, id);
  if (!loc) throw new Error(`Location ${id} not found`);

  // Re-parent children
  await db
    .updateTable("storage_locations")
    .set({ parent_id: loc.parent_id })
    .where("parent_id", "=", id)
    .execute();

  await db
    .deleteFrom("storage_locations")
    .where("id", "=", id)
    .execute();
}
