/**
 * Core unit tests: Audit log operations.
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { setupDb } from "../src/db.ts";
import { queryAuditLog, getAuditEntry } from "../src/audit.ts";
import { createPart, updatePart } from "../src/parts.ts";
import {
  createCategory,
  updateCategory,
  deleteCategory,
} from "../src/categories.ts";

async function freshDb() {
  return await setupDb(":memory:");
}

// --- queryAuditLog ---

Deno.test("queryAuditLog - returns entries after part creation", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555" });

  const entries = await queryAuditLog(db);
  assertEquals(entries.length >= 1, true);

  const partEntry = entries.find((e) => e.entity_type === "part");
  assertExists(partEntry);
  assertEquals(partEntry!.action, "create");

  await db.destroy();
});

Deno.test("queryAuditLog - filters by entity_type", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", category: "ICs/Timers" });

  // Should have "part" and "category" entries (resolveOrCreateCategoryPath doesn't audit,
  // but createPart does for the part itself)
  const partEntries = await queryAuditLog(db, { entity_type: "part" });
  assertEquals(partEntries.length, 1);
  assertEquals(partEntries[0].action, "create");

  await db.destroy();
});

Deno.test("queryAuditLog - filters by action", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });
  await updatePart(db, part.id, { name: "NE555P" });

  const creates = await queryAuditLog(db, { entity_type: "part", action: "create" });
  assertEquals(creates.length, 1);

  const updates = await queryAuditLog(db, { entity_type: "part", action: "update" });
  assertEquals(updates.length, 1);

  await db.destroy();
});

Deno.test("getAuditEntry - returns a single entry by ID", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555" });

  const entries = await queryAuditLog(db);
  const firstEntry = entries[0];

  const fetched = await getAuditEntry(db, firstEntry.id);
  assertExists(fetched);
  assertEquals(fetched!.id, firstEntry.id);
  assertEquals(fetched!.entity_type, firstEntry.entity_type);
  assertEquals(fetched!.action, firstEntry.action);

  await db.destroy();
});

Deno.test("getAuditEntry - returns undefined for missing ID", async () => {
  const db = await freshDb();

  const result = await getAuditEntry(db, 99999);
  assertEquals(result, undefined);

  await db.destroy();
});

Deno.test("queryAuditLog - pagination with limit and offset", async () => {
  const db = await freshDb();
  // Create multiple parts to generate multiple audit entries
  await createPart(db, { name: "Part1" });
  await createPart(db, { name: "Part2" });
  await createPart(db, { name: "Part3" });

  const allEntries = await queryAuditLog(db, { entity_type: "part" });
  assertEquals(allEntries.length, 3);

  const page1 = await queryAuditLog(db, { entity_type: "part", limit: 2 });
  assertEquals(page1.length, 2);

  const page2 = await queryAuditLog(db, { entity_type: "part", limit: 2, offset: 2 });
  assertEquals(page2.length, 1);

  // Pages should not overlap
  const page1Ids = page1.map((e) => e.id);
  const page2Ids = page2.map((e) => e.id);
  for (const id of page2Ids) {
    assertEquals(page1Ids.includes(id), false);
  }

  await db.destroy();
});

// --- Category mutations create audit entries ---

Deno.test("createCategory - creates audit entry", async () => {
  const db = await freshDb();
  const cat = await createCategory(db, {
    name: "Resistors",
    parent_id: null,
    description: null,
    reference_prefix: null,
  });

  const entries = await queryAuditLog(db, { entity_type: "category", action: "create" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].entity_id, cat.id);

  const newValues = JSON.parse(entries[0].new_values!);
  assertEquals(newValues.name, "Resistors");

  await db.destroy();
});

Deno.test("updateCategory - creates audit entry with old and new values", async () => {
  const db = await freshDb();
  const cat = await createCategory(db, {
    name: "Old Name",
    parent_id: null,
    description: null,
    reference_prefix: null,
  });

  await updateCategory(db, cat.id, { name: "New Name" });

  const entries = await queryAuditLog(db, { entity_type: "category", action: "update" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].entity_id, cat.id);

  const oldValues = JSON.parse(entries[0].old_values!);
  assertEquals(oldValues.name, "Old Name");

  const newValues = JSON.parse(entries[0].new_values!);
  assertEquals(newValues.name, "New Name");

  await db.destroy();
});

Deno.test("deleteCategory - creates audit entry", async () => {
  const db = await freshDb();
  const cat = await createCategory(db, {
    name: "ToDelete",
    parent_id: null,
    description: null,
    reference_prefix: null,
  });

  await deleteCategory(db, cat.id);

  const entries = await queryAuditLog(db, { entity_type: "category", action: "delete" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].entity_id, cat.id);

  const oldValues = JSON.parse(entries[0].old_values!);
  assertEquals(oldValues.name, "ToDelete");

  await db.destroy();
});
