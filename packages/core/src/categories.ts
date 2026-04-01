/**
 * Category domain: hierarchical tree operations.
 *
 * Categories use slash-delimited paths ("ICs/Timers") with auto-creation of parents.
 */

import type { Kysely } from "kysely";
import type { Category, Database, NewCategory } from "./schema.ts";

/**
 * Resolve a slash-delimited category path to a category ID,
 * creating any missing categories along the way.
 *
 * "ICs/Timers" -> creates "ICs" (if needed), then "Timers" under it.
 */
export async function resolveOrCreateCategoryPath(
  db: Kysely<Database>,
  path: string,
): Promise<number> {
  const segments = path.split("/").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) {
    throw new Error("Category path cannot be empty");
  }

  let parentId: number | null = null;

  for (const name of segments) {
    // Look for existing category with this name under this parent
    let existing;
    if (parentId === null) {
      existing = await db
        .selectFrom("categories")
        .selectAll()
        .where("name", "=", name)
        .where("parent_id", "is", null)
        .executeTakeFirst();
    } else {
      existing = await db
        .selectFrom("categories")
        .selectAll()
        .where("name", "=", name)
        .where("parent_id", "=", parentId)
        .executeTakeFirst();
    }

    if (existing) {
      parentId = existing.id;
    } else {
      const result = await db
        .insertInto("categories")
        .values({
          name,
          parent_id: parentId,
          description: null,
          reference_prefix: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      parentId = result.id;
    }
  }

  return parentId!;
}

/**
 * Get a category by ID.
 */
export async function getCategory(
  db: Kysely<Database>,
  id: number,
): Promise<Category | undefined> {
  return await db
    .selectFrom("categories")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

/**
 * Get the full path string for a category (e.g. "ICs/Timers").
 */
export async function getCategoryPath(
  db: Kysely<Database>,
  id: number,
): Promise<string> {
  const segments: string[] = [];
  let currentId: number | null = id;

  while (currentId !== null) {
    const cat = await db
      .selectFrom("categories")
      .select(["name", "parent_id"])
      .where("id", "=", currentId)
      .executeTakeFirst();

    if (!cat) break;
    segments.unshift(cat.name);
    currentId = cat.parent_id;
  }

  return segments.join("/");
}

/**
 * List all categories, optionally filtered by parent.
 */
export async function listCategories(
  db: Kysely<Database>,
  parentId?: number | null,
): Promise<Category[]> {
  let query = db.selectFrom("categories").selectAll();

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
 * Create a category directly (not via path resolution).
 */
export async function createCategory(
  db: Kysely<Database>,
  input: NewCategory,
): Promise<Category> {
  return await db
    .insertInto("categories")
    .values(input)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * Update a category.
 */
export async function updateCategory(
  db: Kysely<Database>,
  id: number,
  updates: Partial<Pick<Category, "name" | "description" | "reference_prefix" | "parent_id">>,
): Promise<Category> {
  return await db
    .updateTable("categories")
    .set(updates)
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/**
 * Delete a category. Children are re-parented to the deleted category's parent.
 */
export async function deleteCategory(
  db: Kysely<Database>,
  id: number,
): Promise<void> {
  const cat = await getCategory(db, id);
  if (!cat) throw new Error(`Category ${id} not found`);

  // Re-parent children to this category's parent
  await db
    .updateTable("categories")
    .set({ parent_id: cat.parent_id })
    .where("parent_id", "=", id)
    .execute();

  // Unlink parts from this category
  await db
    .updateTable("parts")
    .set({ category_id: null })
    .where("category_id", "=", id)
    .execute();

  await db
    .deleteFrom("categories")
    .where("id", "=", id)
    .execute();
}

/**
 * Build a full category tree structure.
 */
export interface CategoryTreeNode {
  category: Category;
  children: CategoryTreeNode[];
  path: string;
}

export async function getCategoryTree(
  db: Kysely<Database>,
): Promise<CategoryTreeNode[]> {
  const all = await db
    .selectFrom("categories")
    .selectAll()
    .orderBy("name")
    .execute();

  const byParent = new Map<number | null, Category[]>();
  for (const cat of all) {
    const key = cat.parent_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(cat);
  }

  function buildTree(parentId: number | null, prefix: string): CategoryTreeNode[] {
    const children = byParent.get(parentId) ?? [];
    return children.map((cat) => {
      const path = prefix ? `${prefix}/${cat.name}` : cat.name;
      return {
        category: cat,
        children: buildTree(cat.id, path),
        path,
      };
    });
  }

  return buildTree(null, "");
}
