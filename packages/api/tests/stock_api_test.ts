/**
 * API integration tests: Stock + Location routes.
 */

import { assertEquals, assert } from "jsr:@std/assert";
import { setupDb } from "@tray/core";
import { createApp } from "@tray/api";

async function freshApp() {
  const db = await setupDb(":memory:");
  const app = createApp(db);
  return { app, db };
}

async function post(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return await app.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function get(app: ReturnType<typeof createApp>, path: string) {
  return await app.fetch(new Request(`http://localhost${path}`));
}

// --- Stock Add ---

Deno.test("POST /api/stock/add creates stock", async () => {
  const { app, db } = await freshApp();
  const partRes = await post(app, "/api/parts", { name: "NE555" });
  const part = await partRes.json();

  const res = await post(app, "/api/stock/add", {
    part_id: part.id,
    quantity: 25,
    location: "Shelf 1",
  });
  assertEquals(res.status, 201);
  const lot = await res.json();
  assertEquals(lot.quantity, 25);

  // Verify Part.stock updated
  const partShow = await get(app, `/api/parts/${part.id}`);
  const updated = await partShow.json();
  assertEquals(updated.stock, 25);

  await db.destroy();
});

Deno.test("POST /api/stock/add merges into existing lot", async () => {
  const { app, db } = await freshApp();
  const partRes = await post(app, "/api/parts", { name: "NE555", stock: 10 });
  const part = await partRes.json();

  const res = await post(app, "/api/stock/add", {
    part_id: part.id,
    quantity: 5,
  });
  assertEquals(res.status, 201);
  const lot = await res.json();
  assertEquals(lot.quantity, 15);

  await db.destroy();
});

// --- Stock Adjust ---

Deno.test("POST /api/stock/adjust adjusts stock", async () => {
  const { app, db } = await freshApp();
  const partRes = await post(app, "/api/parts", { name: "NE555", stock: 20 });
  const part = await partRes.json();

  const res = await post(app, "/api/stock/adjust", {
    part_id: part.id,
    quantity: -5,
    reason: "used in project",
  });
  assertEquals(res.status, 200);
  const lot = await res.json();
  assertEquals(lot.quantity, 15);

  // Verify Part.stock
  const partShow = await get(app, `/api/parts/${part.id}`);
  const updated = await partShow.json();
  assertEquals(updated.stock, 15);

  await db.destroy();
});

Deno.test("POST /api/stock/adjust rejects overdraw", async () => {
  const { app, db } = await freshApp();
  const partRes = await post(app, "/api/parts", { name: "NE555", stock: 5 });
  const part = await partRes.json();

  const res = await post(app, "/api/stock/adjust", {
    part_id: part.id,
    quantity: -10,
    reason: "oops",
  });
  assertEquals(res.status, 400);

  await db.destroy();
});

Deno.test("POST /api/stock/adjust requires reason", async () => {
  const { app, db } = await freshApp();
  const partRes = await post(app, "/api/parts", { name: "NE555", stock: 10 });
  const part = await partRes.json();

  const res = await post(app, "/api/stock/adjust", {
    part_id: part.id,
    quantity: -1,
    // missing reason
  });
  assertEquals(res.status, 400);

  await db.destroy();
});

// --- Stock Move ---

Deno.test("POST /api/stock/move moves stock between locations", async () => {
  const { app, db } = await freshApp();
  const partRes = await post(app, "/api/parts", {
    name: "NE555",
    stock: 20,
    location: "Shelf 1",
  });
  const part = await partRes.json();

  const res = await post(app, "/api/stock/move", {
    part_id: part.id,
    quantity: 8,
    from_location: "Shelf 1",
    to_location: "Shelf 2",
  });
  assertEquals(res.status, 200);
  const result = await res.json();
  assertEquals(result.from.quantity, 12);
  assertEquals(result.to.quantity, 8);

  // Total stock unchanged
  const partShow = await get(app, `/api/parts/${part.id}`);
  const updated = await partShow.json();
  assertEquals(updated.stock, 20);

  await db.destroy();
});

// --- Stock List ---

Deno.test("GET /api/stock/:part_id returns lots", async () => {
  const { app, db } = await freshApp();
  const partRes = await post(app, "/api/parts", { name: "NE555" });
  const part = await partRes.json();

  await post(app, "/api/stock/add", { part_id: part.id, quantity: 10 });
  await post(app, "/api/stock/add", {
    part_id: part.id,
    quantity: 5,
    location: "Shelf 1",
  });

  const res = await get(app, `/api/stock/${part.id}`);
  assertEquals(res.status, 200);
  const lots = await res.json();
  assertEquals(lots.length, 2);

  const locLot = lots.find((l: { location_path: string | null }) => l.location_path === "Shelf 1");
  assert(locLot);
  assertEquals(locLot.quantity, 5);

  await db.destroy();
});

// --- Locations ---

Deno.test("GET /api/locations returns all locations", async () => {
  const { app, db } = await freshApp();
  const partRes = await post(app, "/api/parts", { name: "NE555" });
  const part = await partRes.json();

  await post(app, "/api/stock/add", {
    part_id: part.id,
    quantity: 10,
    location: "Lab/Shelf 1",
  });

  const res = await get(app, "/api/locations");
  assertEquals(res.status, 200);
  const locs = await res.json();
  assertEquals(locs.length, 2); // Lab, Shelf 1

  await db.destroy();
});

Deno.test("GET /api/locations/tree returns tree structure", async () => {
  const { app, db } = await freshApp();
  const partRes = await post(app, "/api/parts", { name: "NE555" });
  const part = await partRes.json();

  await post(app, "/api/stock/add", {
    part_id: part.id,
    quantity: 5,
    location: "Lab/Shelf 1",
  });
  await post(app, "/api/stock/add", {
    part_id: part.id,
    quantity: 5,
    location: "Lab/Shelf 2",
  });

  const res = await get(app, "/api/locations/tree");
  assertEquals(res.status, 200);
  const tree = await res.json();
  assertEquals(tree.length, 1);
  assertEquals(tree[0].location.name, "Lab");
  assertEquals(tree[0].children.length, 2);

  await db.destroy();
});

Deno.test("GET /api/locations/:id returns location with path", async () => {
  const { app, db } = await freshApp();
  const partRes = await post(app, "/api/parts", { name: "NE555" });
  const part = await partRes.json();

  await post(app, "/api/stock/add", {
    part_id: part.id,
    quantity: 5,
    location: "Lab/Shelf 1",
  });

  // Find the Shelf 1 location
  const locsRes = await get(app, "/api/locations");
  const locs = await locsRes.json();
  const shelf1 = locs.find((l: { name: string }) => l.name === "Shelf 1");

  const res = await get(app, `/api/locations/${shelf1.id}`);
  assertEquals(res.status, 200);
  const loc = await res.json();
  assertEquals(loc.name, "Shelf 1");
  assertEquals(loc.path, "Lab/Shelf 1");

  await db.destroy();
});
