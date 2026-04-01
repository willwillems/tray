/**
 * Core unit tests: Suppliers, Supplier Parts, Price Breaks.
 */

import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { setupDb } from "../src/db.ts";
import { createPart } from "../src/parts.ts";
import {
  addPriceBreak,
  createSupplier,
  createSupplierPart,
  deleteSupplier,
  deleteSupplierPart,
  getBestPrice,
  getPriceBreaks,
  getSupplier,
  getSupplierPartsForPart,
  getSupplierPartsForSupplier,
  listSuppliers,
  updateSupplier,
} from "../src/suppliers.ts";

async function freshDb() {
  return await setupDb(":memory:");
}

// --- Suppliers ---

Deno.test("createSupplier - basic", async () => {
  const db = await freshDb();
  const s = await createSupplier(db, { name: "DigiKey", url: "https://digikey.com" });
  assertEquals(s.name, "DigiKey");
  assertEquals(s.url, "https://digikey.com");
  assertExists(s.id);
  await db.destroy();
});

Deno.test("getSupplier - returns supplier with part count", async () => {
  const db = await freshDb();
  const s = await createSupplier(db, { name: "DigiKey" });
  const part = await createPart(db, { name: "NE555" });
  await createSupplierPart(db, { part_id: part.id, supplier_id: s.id, sku: "296-1411-5-ND" });

  const found = await getSupplier(db, s.id);
  assertExists(found);
  assertEquals(found!.name, "DigiKey");
  assertEquals(found!.part_count, 1);

  await db.destroy();
});

Deno.test("getSupplier - not found returns undefined", async () => {
  const db = await freshDb();
  const found = await getSupplier(db, 999);
  assertEquals(found, undefined);
  await db.destroy();
});

Deno.test("listSuppliers - returns all with part counts", async () => {
  const db = await freshDb();
  const dk = await createSupplier(db, { name: "DigiKey" });
  const ms = await createSupplier(db, { name: "Mouser" });
  const part = await createPart(db, { name: "NE555" });
  await createSupplierPart(db, { part_id: part.id, supplier_id: dk.id });
  await createSupplierPart(db, { part_id: part.id, supplier_id: ms.id });

  const list = await listSuppliers(db);
  assertEquals(list.length, 2);
  assertEquals(list[0].name, "DigiKey"); // sorted by name
  assertEquals(list[0].part_count, 1);
  assertEquals(list[1].name, "Mouser");
  assertEquals(list[1].part_count, 1);

  await db.destroy();
});

Deno.test("updateSupplier - updates fields", async () => {
  const db = await freshDb();
  const s = await createSupplier(db, { name: "Old" });
  const updated = await updateSupplier(db, s.id, { name: "New", url: "https://new.com" });
  assertEquals(updated.name, "New");
  assertEquals(updated.url, "https://new.com");
  await db.destroy();
});

Deno.test("updateSupplier - not found throws", async () => {
  const db = await freshDb();
  await assertRejects(() => updateSupplier(db, 999, { name: "test" }), Error, "not found");
  await db.destroy();
});

Deno.test("deleteSupplier - cascades to supplier parts", async () => {
  const db = await freshDb();
  const s = await createSupplier(db, { name: "DigiKey" });
  const part = await createPart(db, { name: "NE555" });
  await createSupplierPart(db, { part_id: part.id, supplier_id: s.id });

  await deleteSupplier(db, s.id);

  const found = await getSupplier(db, s.id);
  assertEquals(found, undefined);

  const sps = await getSupplierPartsForPart(db, part.id);
  assertEquals(sps.length, 0);

  await db.destroy();
});

Deno.test("deleteSupplier - not found throws", async () => {
  const db = await freshDb();
  await assertRejects(() => deleteSupplier(db, 999), Error, "not found");
  await db.destroy();
});

// --- Supplier Parts ---

Deno.test("createSupplierPart - links part to supplier", async () => {
  const db = await freshDb();
  const s = await createSupplier(db, { name: "DigiKey" });
  const part = await createPart(db, { name: "NE555" });

  const sp = await createSupplierPart(db, {
    part_id: part.id,
    supplier_id: s.id,
    sku: "296-1411-5-ND",
    url: "https://digikey.com/ne555",
  });

  assertEquals(sp.part_id, part.id);
  assertEquals(sp.supplier_id, s.id);
  assertEquals(sp.sku, "296-1411-5-ND");
  assertEquals(sp.supplier_name, "DigiKey");
  assertEquals(sp.part_name, "NE555");
  assertEquals(sp.price_breaks, []);

  await db.destroy();
});

Deno.test("createSupplierPart - with inline price breaks", async () => {
  const db = await freshDb();
  const s = await createSupplier(db, { name: "DigiKey" });
  const part = await createPart(db, { name: "NE555" });

  const sp = await createSupplierPart(db, {
    part_id: part.id,
    supplier_id: s.id,
    sku: "296-1411-5-ND",
    price_breaks: [
      { min_quantity: 1, price: 0.58 },
      { min_quantity: 10, price: 0.45 },
      { min_quantity: 100, price: 0.32 },
    ],
  });

  assertEquals(sp.price_breaks.length, 3);
  assertEquals(sp.price_breaks[0].price, 0.58);
  assertEquals(sp.price_breaks[1].min_quantity, 10);

  await db.destroy();
});

Deno.test("createSupplierPart - rejects invalid part", async () => {
  const db = await freshDb();
  const s = await createSupplier(db, { name: "DigiKey" });
  await assertRejects(
    () => createSupplierPart(db, { part_id: 999, supplier_id: s.id }),
    Error,
    "Part 999 not found",
  );
  await db.destroy();
});

Deno.test("createSupplierPart - rejects invalid supplier", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });
  await assertRejects(
    () => createSupplierPart(db, { part_id: part.id, supplier_id: 999 }),
    Error,
    "Supplier 999 not found",
  );
  await db.destroy();
});

Deno.test("getSupplierPartsForPart - returns all suppliers for a part", async () => {
  const db = await freshDb();
  const dk = await createSupplier(db, { name: "DigiKey" });
  const ms = await createSupplier(db, { name: "Mouser" });
  const part = await createPart(db, { name: "NE555" });

  await createSupplierPart(db, { part_id: part.id, supplier_id: dk.id, sku: "DK-555" });
  await createSupplierPart(db, { part_id: part.id, supplier_id: ms.id, sku: "MS-555" });

  const sps = await getSupplierPartsForPart(db, part.id);
  assertEquals(sps.length, 2);
  assertEquals(sps[0].supplier_name, "DigiKey");
  assertEquals(sps[1].supplier_name, "Mouser");

  await db.destroy();
});

Deno.test("getSupplierPartsForSupplier - returns all parts for a supplier", async () => {
  const db = await freshDb();
  const dk = await createSupplier(db, { name: "DigiKey" });
  const p1 = await createPart(db, { name: "NE555" });
  const p2 = await createPart(db, { name: "LM7805" });

  await createSupplierPart(db, { part_id: p1.id, supplier_id: dk.id });
  await createSupplierPart(db, { part_id: p2.id, supplier_id: dk.id });

  const sps = await getSupplierPartsForSupplier(db, dk.id);
  assertEquals(sps.length, 2);

  await db.destroy();
});

Deno.test("deleteSupplierPart - removes link", async () => {
  const db = await freshDb();
  const s = await createSupplier(db, { name: "DigiKey" });
  const part = await createPart(db, { name: "NE555" });
  const sp = await createSupplierPart(db, {
    part_id: part.id,
    supplier_id: s.id,
    price_breaks: [{ min_quantity: 1, price: 0.50 }],
  });

  await deleteSupplierPart(db, sp.id);

  const sps = await getSupplierPartsForPart(db, part.id);
  assertEquals(sps.length, 0);

  // Price breaks should be cascade-deleted
  const breaks = await getPriceBreaks(db, sp.id);
  assertEquals(breaks.length, 0);

  await db.destroy();
});

// --- Price Breaks ---

Deno.test("addPriceBreak - adds to existing supplier part", async () => {
  const db = await freshDb();
  const s = await createSupplier(db, { name: "DigiKey" });
  const part = await createPart(db, { name: "NE555" });
  const sp = await createSupplierPart(db, { part_id: part.id, supplier_id: s.id });

  await addPriceBreak(db, sp.id, { min_quantity: 1, price: 0.58 });
  await addPriceBreak(db, sp.id, { min_quantity: 100, price: 0.32, currency: "EUR" });

  const breaks = await getPriceBreaks(db, sp.id);
  assertEquals(breaks.length, 2);
  assertEquals(breaks[0].min_quantity, 1);
  assertEquals(breaks[0].price, 0.58);
  assertEquals(breaks[0].currency, "USD");
  assertEquals(breaks[1].min_quantity, 100);
  assertEquals(breaks[1].currency, "EUR");

  await db.destroy();
});

Deno.test("addPriceBreak - rejects invalid supplier part", async () => {
  const db = await freshDb();
  await assertRejects(
    () => addPriceBreak(db, 999, { min_quantity: 1, price: 1.0 }),
    Error,
    "Supplier part 999 not found",
  );
  await db.destroy();
});

// --- Best Price ---

Deno.test("getBestPrice - finds cheapest across suppliers", async () => {
  const db = await freshDb();
  const dk = await createSupplier(db, { name: "DigiKey" });
  const ms = await createSupplier(db, { name: "Mouser" });
  const part = await createPart(db, { name: "NE555" });

  await createSupplierPart(db, {
    part_id: part.id,
    supplier_id: dk.id,
    sku: "DK-555",
    price_breaks: [
      { min_quantity: 1, price: 0.58 },
      { min_quantity: 100, price: 0.32 },
    ],
  });

  await createSupplierPart(db, {
    part_id: part.id,
    supplier_id: ms.id,
    sku: "MS-555",
    price_breaks: [
      { min_quantity: 1, price: 0.55 },
      { min_quantity: 50, price: 0.40 },
    ],
  });

  // For qty 1: Mouser is cheaper (0.55 vs 0.58)
  const best1 = await getBestPrice(db, part.id, 1);
  assertExists(best1);
  assertEquals(best1!.supplier_part.supplier_name, "Mouser");
  assertEquals(best1!.unit_price, 0.55);

  // For qty 100: DigiKey is cheaper (0.32 vs 0.40)
  const best100 = await getBestPrice(db, part.id, 100);
  assertExists(best100);
  assertEquals(best100!.supplier_part.supplier_name, "DigiKey");
  assertEquals(best100!.unit_price, 0.32);
  assertEquals(best100!.total_price, 32);

  await db.destroy();
});

Deno.test("getBestPrice - returns null if no suppliers", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });
  const best = await getBestPrice(db, part.id, 10);
  assertEquals(best, null);
  await db.destroy();
});

Deno.test("getBestPrice - skips price breaks above requested quantity", async () => {
  const db = await freshDb();
  const s = await createSupplier(db, { name: "DigiKey" });
  const part = await createPart(db, { name: "NE555" });

  await createSupplierPart(db, {
    part_id: part.id,
    supplier_id: s.id,
    price_breaks: [
      { min_quantity: 100, price: 0.32 }, // Only available at 100+
    ],
  });

  // For qty 10: no applicable price break (min is 100)
  const best = await getBestPrice(db, part.id, 10);
  assertEquals(best, null);

  await db.destroy();
});
