/**
 * Core unit tests: Parts CRUD.
 *
 * Each test gets its own in-memory database -- zero shared state.
 */

import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { setupDb } from "../src/db.ts";
import { createPart, deletePart, getPart, listParts, updatePart } from "../src/parts.ts";

async function freshDb() {
  return await setupDb(":memory:");
}

Deno.test("createPart - basic part with name only", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });

  assertEquals(part.name, "NE555");
  assertEquals(part.stock, 0);
  assertEquals(part.tags, []);
  assertEquals(part.category_path, null);
  assertEquals(part.parameters, []);
  assertExists(part.created_at);
  assertExists(part.updated_at);
  assertEquals(part.manufacturing_status, "unknown");

  await db.destroy();
});

Deno.test("createPart - with stock creates a lot", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 25 });

  assertEquals(part.stock, 25);

  // Verify lot exists
  const lots = await db.selectFrom("stock_lots").selectAll()
    .where("part_id", "=", part.id).execute();
  assertEquals(lots.length, 1);
  assertEquals(lots[0].quantity, 25);
  assertEquals(lots[0].location_id, null);
  assertEquals(lots[0].status, "ok");

  await db.destroy();
});

Deno.test("createPart - with stock + location creates lot at location", async () => {
  const db = await freshDb();
  const part = await createPart(db, {
    name: "10k Resistor",
    stock: 100,
    location: "Shelf 1/Drawer 3",
  });

  assertEquals(part.stock, 100);

  const lots = await db.selectFrom("stock_lots").selectAll()
    .where("part_id", "=", part.id).execute();
  assertEquals(lots.length, 1);
  assertExists(lots[0].location_id);

  // Verify location hierarchy was created
  const locations = await db.selectFrom("storage_locations").selectAll()
    .orderBy("id").execute();
  assertEquals(locations.length, 2); // "Shelf 1" and "Drawer 3"
  assertEquals(locations[0].name, "Shelf 1");
  assertEquals(locations[0].parent_id, null);
  assertEquals(locations[1].name, "Drawer 3");
  assertEquals(locations[1].parent_id, locations[0].id);

  await db.destroy();
});

Deno.test("createPart - without stock creates no lot", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "LM7805" });

  assertEquals(part.stock, 0);

  const lots = await db.selectFrom("stock_lots").selectAll()
    .where("part_id", "=", part.id).execute();
  assertEquals(lots.length, 0);

  await db.destroy();
});

Deno.test("createPart - with category auto-creates hierarchy", async () => {
  const db = await freshDb();
  const part = await createPart(db, {
    name: "NE555",
    category: "ICs/Timers",
  });

  assertEquals(part.category_path, "ICs/Timers");
  assertExists(part.category_id);

  // Verify categories
  const cats = await db.selectFrom("categories").selectAll()
    .orderBy("id").execute();
  assertEquals(cats.length, 2);
  assertEquals(cats[0].name, "ICs");
  assertEquals(cats[0].parent_id, null);
  assertEquals(cats[1].name, "Timers");
  assertEquals(cats[1].parent_id, cats[0].id);

  await db.destroy();
});

Deno.test("createPart - with tags sets junction table rows", async () => {
  const db = await freshDb();
  const part = await createPart(db, {
    name: "NE555",
    tags: ["dip", "timer", "Timer"], // duplicates should be deduped
  });

  assertEquals(part.tags.sort(), ["dip", "timer"]);

  // Verify junction table
  const tagRows = await db.selectFrom("part_tags").selectAll()
    .where("part_id", "=", part.id).execute();
  assertEquals(tagRows.length, 2);

  await db.destroy();
});

Deno.test("createPart - with parameters stores parsed values", async () => {
  const db = await freshDb();
  const part = await createPart(db, {
    name: "10k Resistor",
    parameters: [
      { key: "resistance", value: "10k", unit: "ohm" },
      { key: "tolerance", value: "5%" },
    ],
  });

  assertEquals(part.parameters.length, 2);
  assertEquals(part.parameters[0].key, "resistance");
  assertEquals(part.parameters[0].value, "10k");

  // Verify numeric parsing
  const params = await db.selectFrom("part_parameters").selectAll()
    .where("part_id", "=", part.id).orderBy("key").execute();
  assertEquals(params[0].key, "resistance");
  assertEquals(params[0].value_numeric, 10000);
  assertEquals(params[0].unit, "ohm");

  await db.destroy();
});

Deno.test("createPart - with all fields", async () => {
  const db = await freshDb();
  const part = await createPart(db, {
    name: "NE555",
    description: "Timer IC",
    category: "ICs/Timers",
    manufacturer: "Texas Instruments",
    mpn: "NE555P",
    ipn: "IC-001",
    footprint: "DIP-8",
    keywords: "timer oscillator",
    tags: ["dip", "timer"],
    stock: 25,
    location: "Shelf 1",
    min_stock: 5,
    favorite: true,
    manufacturing_status: "active",
    datasheet_url: "https://example.com/ne555.pdf",
    kicad_symbol_id: "Timer:NE555",
    kicad_footprint: "Package_DIP:DIP-8_W7.62mm",
  });

  assertEquals(part.name, "NE555");
  assertEquals(part.description, "Timer IC");
  assertEquals(part.manufacturer, "Texas Instruments");
  assertEquals(part.mpn, "NE555P");
  assertEquals(part.ipn, "IC-001");
  assertEquals(part.footprint, "DIP-8");
  assertEquals(part.keywords, "timer oscillator");
  assertEquals(part.stock, 25);
  assertEquals(part.min_stock, 5);
  assertEquals(part.favorite, 1);
  assertEquals(part.manufacturing_status, "active");
  assertEquals(part.category_path, "ICs/Timers");
  assertEquals(part.tags.sort(), ["dip", "timer"]);

  await db.destroy();
});

Deno.test("getPart - by ID", async () => {
  const db = await freshDb();
  const created = await createPart(db, { name: "NE555" });
  const found = await getPart(db, created.id);

  assertExists(found);
  assertEquals(found!.id, created.id);
  assertEquals(found!.name, "NE555");

  await db.destroy();
});

Deno.test("getPart - by name", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555" });
  const found = await getPart(db, "NE555");

  assertExists(found);
  assertEquals(found!.name, "NE555");

  await db.destroy();
});

Deno.test("getPart - not found returns undefined", async () => {
  const db = await freshDb();
  const found = await getPart(db, "DOESNT_EXIST");
  assertEquals(found, undefined);

  const foundById = await getPart(db, 999);
  assertEquals(foundById, undefined);

  await db.destroy();
});

Deno.test("listParts - returns all parts sorted by name", async () => {
  const db = await freshDb();
  await createPart(db, { name: "Zebra" });
  await createPart(db, { name: "Alpha" });
  await createPart(db, { name: "Middle" });

  const parts = await listParts(db);
  assertEquals(parts.length, 3);
  assertEquals(parts[0].name, "Alpha");
  assertEquals(parts[1].name, "Middle");
  assertEquals(parts[2].name, "Zebra");

  await db.destroy();
});

Deno.test("listParts - filter by category", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", category: "ICs/Timers" });
  await createPart(db, { name: "LM7805", category: "ICs/Regulators" });
  await createPart(db, { name: "10k", category: "Passives/Resistors" });

  const ics = await listParts(db, { category: "ICs/Timers" });
  assertEquals(ics.length, 1);
  assertEquals(ics[0].name, "NE555");

  await db.destroy();
});

Deno.test("listParts - filter by tag", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", tags: ["dip", "timer"] });
  await createPart(db, { name: "LM7805", tags: ["through-hole"] });
  await createPart(db, { name: "10k", tags: ["smd"] });

  const dip = await listParts(db, { tag: "dip" });
  assertEquals(dip.length, 1);
  assertEquals(dip[0].name, "NE555");

  await db.destroy();
});

Deno.test("listParts - filter by low stock", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", stock: 25, min_stock: 10 });
  await createPart(db, { name: "LM7805", stock: 2, min_stock: 5 }); // low
  await createPart(db, { name: "10k", stock: 0, min_stock: 10 }); // low

  const low = await listParts(db, { low: true });
  assertEquals(low.length, 2);
  const names = low.map((p) => p.name).sort();
  assertEquals(names, ["10k", "LM7805"]);

  await db.destroy();
});

Deno.test("listParts - filter by favorites", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", favorite: true });
  await createPart(db, { name: "LM7805", favorite: false });

  const favs = await listParts(db, { favorites: true });
  assertEquals(favs.length, 1);
  assertEquals(favs[0].name, "NE555");

  await db.destroy();
});

Deno.test("updatePart - updates fields", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });

  const updated = await updatePart(db, part.id, {
    description: "Timer IC",
    manufacturer: "Texas Instruments",
    mpn: "NE555P",
  });

  assertEquals(updated.description, "Timer IC");
  assertEquals(updated.manufacturer, "Texas Instruments");
  assertEquals(updated.mpn, "NE555P");
  assertEquals(updated.name, "NE555"); // unchanged

  await db.destroy();
});

Deno.test("updatePart - updates tags", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", tags: ["dip"] });
  assertEquals(part.tags, ["dip"]);

  const updated = await updatePart(db, part.id, { tags: ["smd", "timer"] });
  assertEquals(updated.tags.sort(), ["smd", "timer"]);

  await db.destroy();
});

Deno.test("updatePart - creates audit log entry", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });

  await updatePart(db, part.id, { description: "Timer IC" });

  const logs = await db.selectFrom("audit_log").selectAll()
    .where("entity_type", "=", "part")
    .where("entity_id", "=", part.id)
    .where("action", "=", "update")
    .execute();
  assertEquals(logs.length, 1);
  assertExists(logs[0].old_values);
  assertExists(logs[0].new_values);

  await db.destroy();
});

Deno.test("updatePart - not found throws", async () => {
  const db = await freshDb();
  await assertRejects(
    () => updatePart(db, 999, { name: "test" }),
    Error,
    "Part 999 not found",
  );
  await db.destroy();
});

Deno.test("deletePart - removes part and cascades", async () => {
  const db = await freshDb();
  const part = await createPart(db, {
    name: "NE555",
    stock: 25,
    tags: ["dip"],
    parameters: [{ key: "resistance", value: "10k" }],
  });

  await deletePart(db, part.id);

  // Part gone
  const found = await getPart(db, part.id);
  assertEquals(found, undefined);

  // Lots cascaded
  const lots = await db.selectFrom("stock_lots").selectAll()
    .where("part_id", "=", part.id).execute();
  assertEquals(lots.length, 0);

  // Tags cascaded
  const tags = await db.selectFrom("part_tags").selectAll()
    .where("part_id", "=", part.id).execute();
  assertEquals(tags.length, 0);

  // Parameters cascaded
  const params = await db.selectFrom("part_parameters").selectAll()
    .where("part_id", "=", part.id).execute();
  assertEquals(params.length, 0);

  await db.destroy();
});

Deno.test("deletePart - creates audit log entry", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });
  await deletePart(db, part.id);

  const logs = await db.selectFrom("audit_log").selectAll()
    .where("entity_type", "=", "part")
    .where("entity_id", "=", part.id)
    .where("action", "=", "delete")
    .execute();
  assertEquals(logs.length, 1);

  await db.destroy();
});

Deno.test("deletePart - not found throws", async () => {
  const db = await freshDb();
  await assertRejects(
    () => deletePart(db, 999),
    Error,
    "Part 999 not found",
  );
  await db.destroy();
});

// --- Stock trigger tests ---

Deno.test("stock trigger - lot update recalculates Part.stock", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 25 });

  await db.updateTable("stock_lots")
    .set({ quantity: 20 })
    .where("part_id", "=", part.id)
    .execute();

  const updated = await db.selectFrom("parts").select("stock")
    .where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(updated.stock, 20);

  await db.destroy();
});

Deno.test("stock trigger - multiple lots sum correctly", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 20 });

  const now = new Date().toISOString();
  await db.insertInto("stock_lots").values({
    part_id: part.id, location_id: null, quantity: 10,
    status: "ok", created_at: now, updated_at: now,
  }).execute();

  const after = await db.selectFrom("parts").select("stock")
    .where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(after.stock, 30); // 20 + 10

  await db.destroy();
});

Deno.test("stock trigger - damaged lots excluded from stock", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 25 });

  await db.updateTable("stock_lots")
    .set({ status: "damaged" })
    .where("part_id", "=", part.id)
    .execute();

  const after = await db.selectFrom("parts").select("stock")
    .where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(after.stock, 0); // damaged lots don't count

  await db.destroy();
});

Deno.test("stock trigger - deleting lot recalculates", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 25 });

  await db.deleteFrom("stock_lots")
    .where("part_id", "=", part.id)
    .execute();

  const after = await db.selectFrom("parts").select("stock")
    .where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(after.stock, 0);

  await db.destroy();
});
