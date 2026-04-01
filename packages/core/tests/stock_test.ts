/**
 * Core unit tests: Stock operations + Location operations.
 */

import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { setupDb } from "../src/db.ts";
import { createPart } from "../src/parts.ts";
import { addStock, adjustStock, moveStock, getStockLots } from "../src/stock.ts";
import {
  getLocation,
  getLocationPath,
  getLocationTree,
  listLocations,
  deleteLocation,
} from "../src/locations.ts";

async function freshDb() {
  return await setupDb(":memory:");
}

// --- addStock ---

Deno.test("addStock - creates a new lot", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });

  const lot = await addStock(db, { part_id: part.id, quantity: 10 });
  assertEquals(lot.quantity, 10);
  assertEquals(lot.part_id, part.id);
  assertEquals(lot.location_id, null);
  assertEquals(lot.status, "ok");

  // Part.stock should be updated by trigger
  const p = await db.selectFrom("parts").select("stock").where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(p.stock, 10);

  await db.destroy();
});

Deno.test("addStock - merges into existing lot at same location", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 10 });

  // Add more to the same null-location lot
  const lot = await addStock(db, { part_id: part.id, quantity: 5 });
  assertEquals(lot.quantity, 15); // 10 + 5

  // Should still be just 1 lot
  const lots = await getStockLots(db, part.id);
  assertEquals(lots.length, 1);

  const p = await db.selectFrom("parts").select("stock").where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(p.stock, 15);

  await db.destroy();
});

Deno.test("addStock - creates separate lot at different location", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 10 });

  await addStock(db, { part_id: part.id, quantity: 5, location: "Shelf 1" });

  const lots = await getStockLots(db, part.id);
  assertEquals(lots.length, 2); // null-loc lot + Shelf 1 lot

  const p = await db.selectFrom("parts").select("stock").where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(p.stock, 15); // 10 + 5

  await db.destroy();
});

Deno.test("addStock - location path auto-creates hierarchy", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });

  await addStock(db, { part_id: part.id, quantity: 10, location: "Lab/Shelf 1/Drawer 3" });

  const locs = await listLocations(db);
  assertEquals(locs.length, 3);

  const tree = await getLocationTree(db);
  assertEquals(tree.length, 1);
  assertEquals(tree[0].location.name, "Lab");
  assertEquals(tree[0].children.length, 1);
  assertEquals(tree[0].children[0].location.name, "Shelf 1");
  assertEquals(tree[0].children[0].children[0].location.name, "Drawer 3");

  await db.destroy();
});

Deno.test("addStock - rejects nonexistent part", async () => {
  const db = await freshDb();
  await assertRejects(
    () => addStock(db, { part_id: 999, quantity: 10 }),
    Error,
    "Part 999 not found",
  );
  await db.destroy();
});

Deno.test("addStock - creates audit log entry", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });
  await addStock(db, { part_id: part.id, quantity: 10 });

  const logs = await db.selectFrom("audit_log").selectAll()
    .where("entity_type", "=", "stock_lot").execute();
  assertEquals(logs.length, 1);
  assertEquals(logs[0].action, "create");

  await db.destroy();
});

// --- adjustStock ---

Deno.test("adjustStock - positive adjustment", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 10 });

  const lot = await adjustStock(db, {
    part_id: part.id,
    quantity: 5,
    reason: "found more in drawer",
  });
  assertEquals(lot.quantity, 15);

  const p = await db.selectFrom("parts").select("stock").where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(p.stock, 15);

  await db.destroy();
});

Deno.test("adjustStock - negative adjustment", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 10 });

  const lot = await adjustStock(db, {
    part_id: part.id,
    quantity: -3,
    reason: "used in project",
  });
  assertEquals(lot.quantity, 7);

  const p = await db.selectFrom("parts").select("stock").where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(p.stock, 7);

  await db.destroy();
});

Deno.test("adjustStock - rejects overdraw", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 5 });

  await assertRejects(
    () => adjustStock(db, { part_id: part.id, quantity: -10, reason: "too many" }),
    Error,
    "Cannot adjust",
  );

  // Stock should be unchanged
  const p = await db.selectFrom("parts").select("stock").where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(p.stock, 5);

  await db.destroy();
});

Deno.test("adjustStock - specific lot_id", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 10 });
  await addStock(db, { part_id: part.id, quantity: 20, location: "Shelf 1" });

  const lots = await getStockLots(db, part.id);
  const shelfLot = lots.find((l) => l.location_name === "Shelf 1")!;

  const adjusted = await adjustStock(db, {
    part_id: part.id,
    quantity: -5,
    reason: "used 5 from shelf",
    lot_id: shelfLot.id,
  });
  assertEquals(adjusted.quantity, 15);

  // Total stock should be 10 + 15 = 25
  const p = await db.selectFrom("parts").select("stock").where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(p.stock, 25);

  await db.destroy();
});

Deno.test("adjustStock - creates audit with reason", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 10 });

  await adjustStock(db, { part_id: part.id, quantity: -3, reason: "used in build" });

  const logs = await db.selectFrom("audit_log").selectAll()
    .where("entity_type", "=", "stock_lot")
    .where("action", "=", "update")
    .execute();
  const log = logs.find((l) => {
    const nv = JSON.parse(l.new_values!);
    return nv.reason === "used in build";
  });
  assertExists(log);

  await db.destroy();
});

Deno.test("adjustStock - rejects nonexistent part", async () => {
  const db = await freshDb();
  await assertRejects(
    () => adjustStock(db, { part_id: 999, quantity: 5, reason: "test" }),
    Error,
    "Part 999 not found",
  );
  await db.destroy();
});

// --- moveStock ---

Deno.test("moveStock - moves between locations", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 20, location: "Shelf 1" });

  const { from, to } = await moveStock(db, {
    part_id: part.id,
    quantity: 8,
    from_location: "Shelf 1",
    to_location: "Shelf 2",
  });

  assertEquals(from.quantity, 12); // 20 - 8
  assertEquals(to.quantity, 8);

  // Total stock unchanged
  const p = await db.selectFrom("parts").select("stock").where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(p.stock, 20);

  await db.destroy();
});

Deno.test("moveStock - auto-creates destination location", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 10, location: "Shelf 1" });

  await moveStock(db, {
    part_id: part.id,
    quantity: 5,
    from_location: "Shelf 1",
    to_location: "Shelf 2/Drawer A",
  });

  const tree = await getLocationTree(db);
  const shelf2 = tree.find((n) => n.location.name === "Shelf 2");
  assertExists(shelf2);
  assertEquals(shelf2!.children.length, 1);
  assertEquals(shelf2!.children[0].location.name, "Drawer A");

  await db.destroy();
});

Deno.test("moveStock - rejects overdraw", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 5, location: "Shelf 1" });

  await assertRejects(
    () =>
      moveStock(db, {
        part_id: part.id,
        quantity: 10,
        from_location: "Shelf 1",
        to_location: "Shelf 2",
      }),
    Error,
    "Cannot move",
  );

  await db.destroy();
});

Deno.test("moveStock - rejects zero/negative quantity", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 10 });

  await assertRejects(
    () =>
      moveStock(db, {
        part_id: part.id,
        quantity: 0,
        to_location: "Shelf 1",
      }),
    Error,
    "Move quantity must be positive",
  );

  await db.destroy();
});

Deno.test("moveStock - merges into existing lot at destination", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });
  await addStock(db, { part_id: part.id, quantity: 10, location: "Shelf 1" });
  await addStock(db, { part_id: part.id, quantity: 5, location: "Shelf 2" });

  await moveStock(db, {
    part_id: part.id,
    quantity: 3,
    from_location: "Shelf 1",
    to_location: "Shelf 2",
  });

  const lots = await getStockLots(db, part.id);
  const shelf1 = lots.find((l) => l.location_name === "Shelf 1")!;
  const shelf2 = lots.find((l) => l.location_name === "Shelf 2")!;
  assertEquals(shelf1.quantity, 7);
  assertEquals(shelf2.quantity, 8);

  // Total unchanged
  const p = await db.selectFrom("parts").select("stock").where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(p.stock, 15);

  await db.destroy();
});

// --- getStockLots ---

Deno.test("getStockLots - returns lots with location info", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });
  await addStock(db, { part_id: part.id, quantity: 10 });
  await addStock(db, { part_id: part.id, quantity: 5, location: "Shelf 1/Drawer 3" });

  const lots = await getStockLots(db, part.id);
  assertEquals(lots.length, 2);

  const nullLot = lots.find((l) => l.location_id === null)!;
  assertEquals(nullLot.quantity, 10);
  assertEquals(nullLot.location_name, null);
  assertEquals(nullLot.location_path, null);

  const locLot = lots.find((l) => l.location_id !== null)!;
  assertEquals(locLot.quantity, 5);
  assertEquals(locLot.location_name, "Drawer 3");
  assertEquals(locLot.location_path, "Shelf 1/Drawer 3");

  await db.destroy();
});

Deno.test("getStockLots - empty for part with no stock", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });

  const lots = await getStockLots(db, part.id);
  assertEquals(lots.length, 0);

  await db.destroy();
});

// --- Location operations ---

Deno.test("getLocationPath - builds full path", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", stock: 1, location: "Lab/Shelf 1/Drawer 3" });

  const lots = await getStockLots(db, part.id);
  const path = await getLocationPath(db, lots[0].location_id!);
  assertEquals(path, "Lab/Shelf 1/Drawer 3");

  await db.destroy();
});

Deno.test("getLocationTree - builds complete tree", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "test" });
  await addStock(db, { part_id: part.id, quantity: 1, location: "Lab/Shelf 1" });
  await addStock(db, { part_id: part.id, quantity: 1, location: "Lab/Shelf 2" });
  await addStock(db, { part_id: part.id, quantity: 1, location: "Garage/Box A" });

  const tree = await getLocationTree(db);
  assertEquals(tree.length, 2); // Lab, Garage

  const lab = tree.find((n) => n.location.name === "Lab")!;
  assertEquals(lab.children.length, 2); // Shelf 1, Shelf 2
  assertEquals(lab.path, "Lab");

  const shelf1 = lab.children.find((n) => n.location.name === "Shelf 1")!;
  assertEquals(shelf1.path, "Lab/Shelf 1");

  await db.destroy();
});

Deno.test("deleteLocation - re-parents children and nulls lot location_id", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "test" });
  await addStock(db, { part_id: part.id, quantity: 10, location: "Lab/Shelf 1" });

  // Get the "Lab" location
  const roots = await listLocations(db, null);
  const lab = roots.find((l) => l.name === "Lab")!;

  await deleteLocation(db, lab.id);

  // "Shelf 1" should now be a root
  const afterRoots = await listLocations(db, null);
  const shelf1 = afterRoots.find((l) => l.name === "Shelf 1");
  assertExists(shelf1);
  assertEquals(shelf1!.parent_id, null);

  await db.destroy();
});
