/**
 * Core unit tests: KiCad HTTP Library adapter.
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { setupDb } from "../src/db.ts";
import { createPart } from "../src/parts.ts";
import { resolveOrCreateCategoryPath } from "../src/categories.ts";
import {
  getKicadRoot,
  getKicadCategories,
  getKicadPartsForCategory,
  getKicadPartDetail,
} from "../src/kicad.ts";

async function freshDb() {
  return await setupDb(":memory:");
}

// --- getKicadRoot ---

Deno.test("getKicadRoot - returns valid schema with categories and parts keys", () => {
  const root = getKicadRoot();
  assertEquals(typeof root.categories, "string");
  assertEquals(typeof root.parts, "string");
});

// --- getKicadCategories ---

Deno.test("getKicadCategories - returns categories with id and name as strings", async () => {
  const db = await freshDb();
  await resolveOrCreateCategoryPath(db, "ICs/Timers");
  await resolveOrCreateCategoryPath(db, "Passives/Resistors");

  const categories = await getKicadCategories(db);
  assertEquals(categories.length, 4); // ICs, Timers, Passives, Resistors

  for (const cat of categories) {
    assertEquals(typeof cat.id, "string");
    assertEquals(typeof cat.name, "string");
    assertEquals(typeof cat.description, "string");
  }

  // Verify hierarchical names are built correctly
  const timers = categories.find((c) => c.name === "ICs/Timers");
  assertExists(timers);

  const ics = categories.find((c) => c.name === "ICs");
  assertExists(ics);

  await db.destroy();
});

// --- getKicadPartsForCategory ---

Deno.test("getKicadPartsForCategory - returns parts for a category with all values as strings", async () => {
  const db = await freshDb();
  const catId = await resolveOrCreateCategoryPath(db, "ICs/Timers");
  await createPart(db, { name: "NE555", category: "ICs/Timers", description: "Timer IC" });
  await createPart(db, { name: "LM556", category: "ICs/Timers" });

  const parts = await getKicadPartsForCategory(db, String(catId));
  assertEquals(parts.length, 2);

  for (const part of parts) {
    assertEquals(typeof part.id, "string");
    assertEquals(typeof part.name, "string");
    assertEquals(typeof part.description, "string");
  }

  const ne555 = parts.find((p) => p.name === "NE555");
  assertExists(ne555);
  assertEquals(ne555!.description, "Timer IC");

  await db.destroy();
});

Deno.test("getKicadPartsForCategory - returns empty array for empty category", async () => {
  const db = await freshDb();
  const catId = await resolveOrCreateCategoryPath(db, "EmptyCategory");

  const parts = await getKicadPartsForCategory(db, String(catId));
  assertEquals(parts.length, 0);

  await db.destroy();
});

Deno.test("getKicadPartsForCategory - returns empty for nonexistent category ID", async () => {
  const db = await freshDb();

  const parts = await getKicadPartsForCategory(db, "99999");
  assertEquals(parts.length, 0);

  await db.destroy();
});

// --- getKicadPartDetail ---

Deno.test("getKicadPartDetail - returns a single part with all fields as strings", async () => {
  const db = await freshDb();
  await resolveOrCreateCategoryPath(db, "ICs");
  const part = await createPart(db, {
    name: "NE555",
    description: "Timer IC",
    category: "ICs",
    manufacturer: "Texas Instruments",
    mpn: "NE555P",
    ipn: "TI-NE555",
  });

  const detail = await getKicadPartDetail(db, String(part.id));
  assertExists(detail);

  // All top-level values must be strings
  assertEquals(typeof detail!.id, "string");
  assertEquals(typeof detail!.name, "string");
  assertEquals(typeof detail!.symbolIdStr, "string");
  assertEquals(typeof detail!.exclude_from_bom, "string");
  assertEquals(typeof detail!.exclude_from_board, "string");
  assertEquals(typeof detail!.exclude_from_sim, "string");

  // Check specific values
  assertEquals(detail!.id, String(part.id));
  assertEquals(detail!.name, "NE555");

  // Fields should be present with string values
  assertEquals(typeof detail!.fields, "object");
  assertEquals(detail!.fields["value"].value, "NE555");
  assertEquals(detail!.fields["description"].value, "Timer IC");
  assertEquals(detail!.fields["manufacturer"].value, "Texas Instruments");
  assertEquals(detail!.fields["mpn"].value, "NE555P");
  assertEquals(detail!.fields["ipn"].value, "TI-NE555");
  assertEquals(detail!.fields["reference"].value, "TI-NE555"); // ipn used as reference
  assertEquals(typeof detail!.fields["stock"].value, "string");

  await db.destroy();
});

Deno.test("getKicadPartDetail - returns null for nonexistent part", async () => {
  const db = await freshDb();

  const detail = await getKicadPartDetail(db, "99999");
  assertEquals(detail, null);

  await db.destroy();
});

Deno.test("getKicadPartDetail - returns null for non-numeric ID", async () => {
  const db = await freshDb();

  const detail = await getKicadPartDetail(db, "not-a-number");
  assertEquals(detail, null);

  await db.destroy();
});
