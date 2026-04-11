/**
 * Core unit tests: Location management.
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
import { setupDb } from "../src/db.ts";
import { createPart } from "../src/parts.ts";
import { addStock, getStockLots } from "../src/stock.ts";
import {
  getLocation,
  getLocationPath,
  listLocations,
  getLocationTree,
  deleteLocation,
} from "../src/locations.ts";

async function freshDb() {
  return await setupDb(":memory:");
}

// --- getLocation ---

Deno.test("getLocation - returns a location by ID", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });
  await addStock(db, { part_id: part.id, quantity: 5, location: "Shelf 1" });

  const locs = await listLocations(db);
  assertEquals(locs.length, 1);

  const loc = await getLocation(db, locs[0].id);
  assertExists(loc);
  assertEquals(loc!.name, "Shelf 1");

  await db.destroy();
});

Deno.test("getLocation - returns undefined for missing ID", async () => {
  const db = await freshDb();

  const loc = await getLocation(db, 99999);
  assertEquals(loc, undefined);

  await db.destroy();
});

// --- getLocationPath ---

Deno.test("getLocationPath - builds full slash-delimited path", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });
  await addStock(db, { part_id: part.id, quantity: 1, location: "Lab/Shelf 1/Drawer 3" });

  const locs = await listLocations(db);
  // Find the deepest location (Drawer 3)
  const drawer = locs.find((l) => l.name === "Drawer 3");
  assertExists(drawer);

  const path = await getLocationPath(db, drawer!.id);
  assertEquals(path, "Lab/Shelf 1/Drawer 3");

  // Check intermediate location path
  const shelf = locs.find((l) => l.name === "Shelf 1");
  assertExists(shelf);
  const shelfPath = await getLocationPath(db, shelf!.id);
  assertEquals(shelfPath, "Lab/Shelf 1");

  // Check root location path
  const lab = locs.find((l) => l.name === "Lab");
  assertExists(lab);
  const labPath = await getLocationPath(db, lab!.id);
  assertEquals(labPath, "Lab");

  await db.destroy();
});

// --- listLocations ---

Deno.test("listLocations - returns all locations", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });
  await addStock(db, { part_id: part.id, quantity: 1, location: "Lab/Shelf 1" });
  await addStock(db, { part_id: part.id, quantity: 1, location: "Garage" });

  const all = await listLocations(db);
  assertEquals(all.length, 3); // Lab, Shelf 1, Garage

  await db.destroy();
});

Deno.test("listLocations - filters by parent_id null for roots", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });
  await addStock(db, { part_id: part.id, quantity: 1, location: "Lab/Shelf 1" });
  await addStock(db, { part_id: part.id, quantity: 1, location: "Garage/Box A" });

  const roots = await listLocations(db, null);
  assertEquals(roots.length, 2); // Lab, Garage

  const rootNames = roots.map((l) => l.name).sort();
  assertEquals(rootNames, ["Garage", "Lab"]);

  await db.destroy();
});

// --- getLocationTree ---

Deno.test("getLocationTree - builds nested tree structure", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });
  await addStock(db, { part_id: part.id, quantity: 1, location: "Lab/Shelf 1" });
  await addStock(db, { part_id: part.id, quantity: 1, location: "Lab/Shelf 2" });
  await addStock(db, { part_id: part.id, quantity: 1, location: "Garage" });

  const tree = await getLocationTree(db);
  assertEquals(tree.length, 2); // Lab, Garage as root nodes

  const lab = tree.find((n) => n.location.name === "Lab");
  assertExists(lab);
  assertEquals(lab!.path, "Lab");
  assertEquals(lab!.children.length, 2); // Shelf 1, Shelf 2

  const shelf1 = lab!.children.find((n) => n.location.name === "Shelf 1");
  assertExists(shelf1);
  assertEquals(shelf1!.path, "Lab/Shelf 1");
  assertEquals(shelf1!.children.length, 0);

  const garage = tree.find((n) => n.location.name === "Garage");
  assertExists(garage);
  assertEquals(garage!.path, "Garage");
  assertEquals(garage!.children.length, 0);

  await db.destroy();
});

// --- deleteLocation ---

Deno.test("deleteLocation - re-parents children to deleted location's parent", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });
  await addStock(db, { part_id: part.id, quantity: 5, location: "Lab/Shelf 1/Drawer A" });

  // Get the middle location "Shelf 1"
  const allLocs = await listLocations(db);
  const shelf1 = allLocs.find((l) => l.name === "Shelf 1");
  assertExists(shelf1);

  const lab = allLocs.find((l) => l.name === "Lab");
  assertExists(lab);

  // Delete "Shelf 1" (middle)
  await deleteLocation(db, shelf1!.id);

  // "Drawer A" should now be a child of "Lab"
  const drawerAfter = await getLocation(db, allLocs.find((l) => l.name === "Drawer A")!.id);
  assertExists(drawerAfter);
  assertEquals(drawerAfter!.parent_id, lab!.id);

  await db.destroy();
});

Deno.test("deleteLocation - nulls stock lot location_id for lots at deleted location", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });
  await addStock(db, { part_id: part.id, quantity: 10, location: "Shelf 1" });

  // Verify the lot has a location_id
  const lotsBefore = await getStockLots(db, part.id);
  assertEquals(lotsBefore.length, 1);
  assertExists(lotsBefore[0].location_id);

  // Get the location
  const locs = await listLocations(db);
  const shelf = locs.find((l) => l.name === "Shelf 1");
  assertExists(shelf);

  // Delete the location
  await deleteLocation(db, shelf!.id);

  // Lot should now have null location_id (via FK ON DELETE SET NULL)
  const lotsAfter = await getStockLots(db, part.id);
  assertEquals(lotsAfter.length, 1);
  assertEquals(lotsAfter[0].location_id, null);

  await db.destroy();
});
