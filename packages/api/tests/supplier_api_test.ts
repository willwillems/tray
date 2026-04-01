/**
 * API integration tests: Suppliers, Supplier Parts, Price Breaks.
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
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

async function del(app: ReturnType<typeof createApp>, path: string) {
  return await app.fetch(new Request(`http://localhost${path}`, { method: "DELETE" }));
}

// --- Suppliers CRUD ---

Deno.test("POST /api/suppliers creates supplier", async () => {
  const { app, db } = await freshApp();
  const res = await post(app, "/api/suppliers", { name: "DigiKey", url: "https://digikey.com" });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.name, "DigiKey");
  assertEquals(body.url, "https://digikey.com");
  await db.destroy();
});

Deno.test("GET /api/suppliers lists suppliers", async () => {
  const { app, db } = await freshApp();
  await post(app, "/api/suppliers", { name: "DigiKey" });
  await post(app, "/api/suppliers", { name: "Mouser" });

  const res = await get(app, "/api/suppliers");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 2);
  assertEquals(body[0].name, "DigiKey");
  assertEquals(body[0].part_count, 0);
  await db.destroy();
});

Deno.test("GET /api/suppliers/:id returns supplier", async () => {
  const { app, db } = await freshApp();
  const createRes = await post(app, "/api/suppliers", { name: "DigiKey" });
  const created = await createRes.json();

  const res = await get(app, `/api/suppliers/${created.id}`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.name, "DigiKey");
  assertEquals(body.part_count, 0);
  await db.destroy();
});

Deno.test("DELETE /api/suppliers/:id removes supplier", async () => {
  const { app, db } = await freshApp();
  const createRes = await post(app, "/api/suppliers", { name: "DigiKey" });
  const created = await createRes.json();

  const res = await del(app, `/api/suppliers/${created.id}`);
  assertEquals(res.status, 200);

  const getRes = await get(app, `/api/suppliers/${created.id}`);
  assertEquals(getRes.status, 404);
  await db.destroy();
});

// --- Supplier Parts ---

Deno.test("POST /api/supplier-parts links part to supplier", async () => {
  const { app, db } = await freshApp();
  const sRes = await post(app, "/api/suppliers", { name: "DigiKey" });
  const supplier = await sRes.json();
  const pRes = await post(app, "/api/parts", { name: "NE555" });
  const part = await pRes.json();

  const res = await post(app, "/api/supplier-parts", {
    part_id: part.id,
    supplier_id: supplier.id,
    sku: "296-1411-5-ND",
    price_breaks: [
      { min_quantity: 1, price: 0.58 },
      { min_quantity: 100, price: 0.32 },
    ],
  });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.sku, "296-1411-5-ND");
  assertEquals(body.supplier_name, "DigiKey");
  assertEquals(body.part_name, "NE555");
  assertEquals(body.price_breaks.length, 2);
  await db.destroy();
});

Deno.test("GET /api/parts/:id/suppliers returns supplier parts", async () => {
  const { app, db } = await freshApp();
  const sRes = await post(app, "/api/suppliers", { name: "DigiKey" });
  const supplier = await sRes.json();
  const pRes = await post(app, "/api/parts", { name: "NE555" });
  const part = await pRes.json();

  await post(app, "/api/supplier-parts", {
    part_id: part.id,
    supplier_id: supplier.id,
    sku: "DK-555",
  });

  const res = await get(app, `/api/parts/${part.id}/suppliers`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].sku, "DK-555");
  await db.destroy();
});

Deno.test("GET /api/suppliers/:id/parts returns parts for supplier", async () => {
  const { app, db } = await freshApp();
  const sRes = await post(app, "/api/suppliers", { name: "DigiKey" });
  const supplier = await sRes.json();
  const p1Res = await post(app, "/api/parts", { name: "NE555" });
  const p1 = await p1Res.json();
  const p2Res = await post(app, "/api/parts", { name: "LM7805" });
  const p2 = await p2Res.json();

  await post(app, "/api/supplier-parts", { part_id: p1.id, supplier_id: supplier.id });
  await post(app, "/api/supplier-parts", { part_id: p2.id, supplier_id: supplier.id });

  const res = await get(app, `/api/suppliers/${supplier.id}/parts`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 2);
  await db.destroy();
});

// --- Best Price ---

Deno.test("GET /api/parts/:id/best-price finds cheapest", async () => {
  const { app, db } = await freshApp();
  const dk = await (await post(app, "/api/suppliers", { name: "DigiKey" })).json();
  const ms = await (await post(app, "/api/suppliers", { name: "Mouser" })).json();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();

  await post(app, "/api/supplier-parts", {
    part_id: part.id,
    supplier_id: dk.id,
    sku: "DK-555",
    price_breaks: [{ min_quantity: 1, price: 0.58 }, { min_quantity: 100, price: 0.30 }],
  });
  await post(app, "/api/supplier-parts", {
    part_id: part.id,
    supplier_id: ms.id,
    sku: "MS-555",
    price_breaks: [{ min_quantity: 1, price: 0.50 }],
  });

  // qty 1: Mouser is cheaper
  const res1 = await get(app, `/api/parts/${part.id}/best-price?quantity=1`);
  assertEquals(res1.status, 200);
  const body1 = await res1.json();
  assertEquals(body1.supplier_part.supplier_name, "Mouser");
  assertEquals(body1.unit_price, 0.50);

  // qty 100: DigiKey is cheaper
  const res100 = await get(app, `/api/parts/${part.id}/best-price?quantity=100`);
  assertEquals(res100.status, 200);
  const body100 = await res100.json();
  assertEquals(body100.supplier_part.supplier_name, "DigiKey");
  assertEquals(body100.unit_price, 0.30);
  assertEquals(body100.total_price, 30);

  await db.destroy();
});

Deno.test("GET /api/parts/:id/best-price returns 404 when no pricing", async () => {
  const { app, db } = await freshApp();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();

  const res = await get(app, `/api/parts/${part.id}/best-price?quantity=1`);
  assertEquals(res.status, 404);
  await db.destroy();
});
