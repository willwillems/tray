/**
 * Core unit tests: Categories.
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { setupDb } from "../src/db.ts";
import {
  createCategory,
  deleteCategory,
  getCategory,
  getCategoryPath,
  getCategoryTree,
  listCategories,
  resolveOrCreateCategoryPath,
  updateCategory,
} from "../src/categories.ts";

async function freshDb() {
  return await setupDb(":memory:");
}

Deno.test("resolveOrCreateCategoryPath - creates single category", async () => {
  const db = await freshDb();
  const id = await resolveOrCreateCategoryPath(db, "ICs");

  const cat = await getCategory(db, id);
  assertExists(cat);
  assertEquals(cat!.name, "ICs");
  assertEquals(cat!.parent_id, null);

  await db.destroy();
});

Deno.test("resolveOrCreateCategoryPath - creates hierarchy", async () => {
  const db = await freshDb();
  const id = await resolveOrCreateCategoryPath(db, "ICs/Timers");

  const path = await getCategoryPath(db, id);
  assertEquals(path, "ICs/Timers");

  const all = await listCategories(db);
  assertEquals(all.length, 2);

  await db.destroy();
});

Deno.test("resolveOrCreateCategoryPath - idempotent", async () => {
  const db = await freshDb();
  const id1 = await resolveOrCreateCategoryPath(db, "ICs/Timers");
  const id2 = await resolveOrCreateCategoryPath(db, "ICs/Timers");

  assertEquals(id1, id2);

  const all = await listCategories(db);
  assertEquals(all.length, 2); // Still just 2, not 4

  await db.destroy();
});

Deno.test("resolveOrCreateCategoryPath - reuses existing parents", async () => {
  const db = await freshDb();
  await resolveOrCreateCategoryPath(db, "ICs/Timers");
  await resolveOrCreateCategoryPath(db, "ICs/Regulators");

  const all = await listCategories(db);
  assertEquals(all.length, 3); // ICs, Timers, Regulators

  const roots = await listCategories(db, null);
  assertEquals(roots.length, 1);
  assertEquals(roots[0].name, "ICs");

  await db.destroy();
});

Deno.test("getCategoryPath - builds full path", async () => {
  const db = await freshDb();
  const id = await resolveOrCreateCategoryPath(db, "Electronics/ICs/Timers");
  const path = await getCategoryPath(db, id);
  assertEquals(path, "Electronics/ICs/Timers");
  await db.destroy();
});

Deno.test("getCategoryTree - builds complete tree", async () => {
  const db = await freshDb();
  await resolveOrCreateCategoryPath(db, "ICs/Timers");
  await resolveOrCreateCategoryPath(db, "ICs/Regulators");
  await resolveOrCreateCategoryPath(db, "Passives/Resistors");

  const tree = await getCategoryTree(db);
  assertEquals(tree.length, 2); // ICs, Passives

  const ics = tree.find((n) => n.category.name === "ICs");
  assertExists(ics);
  assertEquals(ics!.children.length, 2);
  assertEquals(ics!.path, "ICs");

  const timers = ics!.children.find((n) => n.category.name === "Timers");
  assertExists(timers);
  assertEquals(timers!.path, "ICs/Timers");
  assertEquals(timers!.children.length, 0);

  await db.destroy();
});

Deno.test("updateCategory - updates name", async () => {
  const db = await freshDb();
  const cat = await createCategory(db, {
    name: "Old Name",
    parent_id: null,
    description: null,
    reference_prefix: null,
  });

  const updated = await updateCategory(db, cat.id, { name: "New Name" });
  assertEquals(updated.name, "New Name");

  await db.destroy();
});

Deno.test("deleteCategory - re-parents children", async () => {
  const db = await freshDb();
  const parentId = await resolveOrCreateCategoryPath(db, "Electronics/ICs");
  const childId = await resolveOrCreateCategoryPath(db, "Electronics/ICs/Timers");

  // Get the ICs category id
  const icsId = (await getCategory(db, parentId))!.parent_id
    ? parentId
    : parentId;

  // Delete "Electronics" (root)
  const electronics = await listCategories(db, null);
  const elecId = electronics[0].id;
  await deleteCategory(db, elecId);

  // ICs should now be a root
  const ics = await getCategory(db, parentId);
  assertExists(ics);
  assertEquals(ics!.parent_id, null);

  await db.destroy();
});
