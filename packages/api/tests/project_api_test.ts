/**
 * API integration tests: Projects, BOM, Builds, Purchase Orders.
 *
 * Tests Hono routes via app.fetch() -- no real HTTP server.
 * Each test gets its own in-memory database with MemoryBlobStore.
 */

import { assertEquals, assertExists, assert } from "jsr:@std/assert";
import { setupDb, MemoryBlobStore } from "@tray/core";
import { createApp } from "@tray/api";

async function freshApp() {
  const db = await setupDb(":memory:");
  const blobs = new MemoryBlobStore();
  const app = createApp(db, { blobs });
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

async function patch(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return await app.fetch(
    new Request(`http://localhost${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function del(app: ReturnType<typeof createApp>, path: string) {
  return await app.fetch(
    new Request(`http://localhost${path}`, { method: "DELETE" }),
  );
}

// --- Projects CRUD ---

Deno.test("POST /api/projects creates a project", async () => {
  const { app, db } = await freshApp();
  const res = await post(app, "/api/projects", { name: "Synth Module" });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.name, "Synth Module");
  assertExists(body.id);
  assertEquals(body.status, "active");
  await db.destroy();
});

Deno.test("POST /api/projects with description", async () => {
  const { app, db } = await freshApp();
  const res = await post(app, "/api/projects", {
    name: "Clock Kit",
    description: "A simple clock kit for beginners",
  });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.name, "Clock Kit");
  assertEquals(body.description, "A simple clock kit for beginners");
  await db.destroy();
});

Deno.test("POST /api/projects validates required name", async () => {
  const { app, db } = await freshApp();
  const res = await post(app, "/api/projects", {});
  assertEquals(res.status, 400);
  await db.destroy();
});

Deno.test("GET /api/projects lists projects", async () => {
  const { app, db } = await freshApp();
  await post(app, "/api/projects", { name: "Project A" });
  await post(app, "/api/projects", { name: "Project B" });

  const res = await get(app, "/api/projects");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 2);
  await db.destroy();
});

Deno.test("GET /api/projects/:id returns a project with BOM", async () => {
  const { app, db } = await freshApp();
  const projRes = await post(app, "/api/projects", { name: "Synth" });
  const proj = await projRes.json();

  const res = await get(app, `/api/projects/${proj.id}`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.name, "Synth");
  assertEquals(body.id, proj.id);
  assertExists(body.bom_lines);
  assertEquals(body.total_line_items, 0);
  await db.destroy();
});

Deno.test("GET /api/projects/:id returns 404 for missing", async () => {
  const { app, db } = await freshApp();
  const res = await get(app, "/api/projects/999");
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, "not_found");
  await db.destroy();
});

Deno.test("PATCH /api/projects/:id updates project", async () => {
  const { app, db } = await freshApp();
  const projRes = await post(app, "/api/projects", { name: "Draft" });
  const proj = await projRes.json();

  const res = await patch(app, `/api/projects/${proj.id}`, {
    name: "Final",
    description: "Updated description",
    status: "archived",
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.name, "Final");
  assertEquals(body.description, "Updated description");
  assertEquals(body.status, "archived");
  await db.destroy();
});

Deno.test("DELETE /api/projects/:id removes project", async () => {
  const { app, db } = await freshApp();
  const projRes = await post(app, "/api/projects", { name: "Temp" });
  const proj = await projRes.json();

  const res = await del(app, `/api/projects/${proj.id}`);
  assertEquals(res.status, 200);

  const getRes = await get(app, `/api/projects/${proj.id}`);
  assertEquals(getRes.status, 404);
  await db.destroy();
});

Deno.test("DELETE /api/projects/:id returns 404 for missing", async () => {
  const { app, db } = await freshApp();
  const res = await del(app, "/api/projects/999");
  assertEquals(res.status, 404);
  await db.destroy();
});

// --- BOM Lines ---

Deno.test("POST /api/projects/:id/bom adds BOM line", async () => {
  const { app, db } = await freshApp();
  const proj = await (await post(app, "/api/projects", { name: "Synth" })).json();
  const part = await (await post(app, "/api/parts", { name: "NE555", stock: 10 })).json();

  const res = await post(app, `/api/projects/${proj.id}/bom`, {
    part_id: part.id,
    quantity_required: 2,
    reference_designators: "U1,U2",
  });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.part_id, part.id);
  assertEquals(body.project_id, proj.id);
  assertEquals(body.quantity_required, 2);
  assertEquals(body.reference_designators, "U1,U2");
  await db.destroy();
});

Deno.test("GET /api/projects/:id/bom returns BOM lines with details", async () => {
  const { app, db } = await freshApp();
  const proj = await (await post(app, "/api/projects", { name: "Synth" })).json();
  const part1 = await (await post(app, "/api/parts", { name: "NE555", stock: 10 })).json();
  const part2 = await (await post(app, "/api/parts", { name: "10k Resistor", stock: 100 })).json();

  await post(app, `/api/projects/${proj.id}/bom`, { part_id: part1.id, quantity_required: 2 });
  await post(app, `/api/projects/${proj.id}/bom`, { part_id: part2.id, quantity_required: 4 });

  const res = await get(app, `/api/projects/${proj.id}/bom`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 2);

  // BOM lines should include enriched details
  const ne555line = body.find((l: { part_name: string }) => l.part_name === "NE555");
  assertExists(ne555line);
  assertEquals(ne555line.stock_available, 10);
  assertEquals(ne555line.sufficient, true);
  await db.destroy();
});

Deno.test("DELETE /api/bom-lines/:id removes a BOM line", async () => {
  const { app, db } = await freshApp();
  const proj = await (await post(app, "/api/projects", { name: "Synth" })).json();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();

  const bomRes = await post(app, `/api/projects/${proj.id}/bom`, {
    part_id: part.id,
    quantity_required: 1,
  });
  const bomLine = await bomRes.json();

  const res = await del(app, `/api/bom-lines/${bomLine.id}`);
  assertEquals(res.status, 200);

  // BOM should now be empty
  const listRes = await get(app, `/api/projects/${proj.id}/bom`);
  const lines = await listRes.json();
  assertEquals(lines.length, 0);
  await db.destroy();
});

Deno.test("DELETE /api/bom-lines/:id returns 404 for missing", async () => {
  const { app, db } = await freshApp();
  const res = await del(app, "/api/bom-lines/999");
  assertEquals(res.status, 404);
  await db.destroy();
});

// --- BOM Availability Check ---

Deno.test("GET /api/projects/:id/check checks availability", async () => {
  const { app, db } = await freshApp();
  const proj = await (await post(app, "/api/projects", { name: "Synth" })).json();
  const part = await (await post(app, "/api/parts", { name: "NE555", stock: 5 })).json();

  await post(app, `/api/projects/${proj.id}/bom`, { part_id: part.id, quantity_required: 10 });

  const res = await get(app, `/api/projects/${proj.id}/check`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.can_build, false);
  assertEquals(body.shortages.length, 1);
  assertEquals(body.shortages[0].part_name, "NE555");
  assertEquals(body.shortages[0].required, 10);
  assertEquals(body.shortages[0].available, 5);
  assertEquals(body.shortages[0].short, 5);
  await db.destroy();
});

Deno.test("GET /api/projects/:id/check returns can_build true when sufficient", async () => {
  const { app, db } = await freshApp();
  const proj = await (await post(app, "/api/projects", { name: "Synth" })).json();
  const part = await (await post(app, "/api/parts", { name: "NE555", stock: 20 })).json();

  await post(app, `/api/projects/${proj.id}/bom`, { part_id: part.id, quantity_required: 5 });

  const res = await get(app, `/api/projects/${proj.id}/check`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.can_build, true);
  assertEquals(body.shortages.length, 0);
  await db.destroy();
});

// --- Build Orders ---

Deno.test("POST /api/builds creates a build order", async () => {
  const { app, db } = await freshApp();
  const proj = await (await post(app, "/api/projects", { name: "Synth" })).json();

  const res = await post(app, "/api/builds", { project_id: proj.id, quantity: 1 });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertExists(body.id);
  assertEquals(body.project_id, proj.id);
  assertEquals(body.quantity, 1);
  assertEquals(body.status, "draft");
  assertEquals(body.project_name, "Synth");
  await db.destroy();
});

Deno.test("POST /api/builds/:id/complete deducts stock", async () => {
  const { app, db } = await freshApp();
  const proj = await (await post(app, "/api/projects", { name: "Synth" })).json();
  const part = await (await post(app, "/api/parts", { name: "NE555", stock: 10 })).json();

  await post(app, `/api/projects/${proj.id}/bom`, { part_id: part.id, quantity_required: 3 });
  const build = await (await post(app, "/api/builds", { project_id: proj.id, quantity: 2 })).json();

  const res = await post(app, `/api/builds/${build.id}/complete`, {});
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "complete");
  assertExists(body.completed_at);

  // Stock should be deducted: 10 - (3 * 2) = 4
  const partRes = await get(app, `/api/parts/${part.id}`);
  const updatedPart = await partRes.json();
  assertEquals(updatedPart.stock, 4);
  await db.destroy();
});

Deno.test("POST /api/builds/:id/complete fails on insufficient stock", async () => {
  const { app, db } = await freshApp();
  const proj = await (await post(app, "/api/projects", { name: "Synth" })).json();
  const part = await (await post(app, "/api/parts", { name: "NE555", stock: 1 })).json();

  await post(app, `/api/projects/${proj.id}/bom`, { part_id: part.id, quantity_required: 5 });
  const build = await (await post(app, "/api/builds", { project_id: proj.id, quantity: 1 })).json();

  const res = await post(app, `/api/builds/${build.id}/complete`, {});
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "build_error");
  assert(body.message.includes("insufficient stock"));
  await db.destroy();
});

Deno.test("GET /api/builds lists build orders", async () => {
  const { app, db } = await freshApp();
  const proj = await (await post(app, "/api/projects", { name: "Synth" })).json();
  await post(app, "/api/builds", { project_id: proj.id, quantity: 1 });
  await post(app, "/api/builds", { project_id: proj.id, quantity: 3 });

  const res = await get(app, "/api/builds");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 2);
  await db.destroy();
});

Deno.test("GET /api/builds filters by project_id", async () => {
  const { app, db } = await freshApp();
  const proj1 = await (await post(app, "/api/projects", { name: "A" })).json();
  const proj2 = await (await post(app, "/api/projects", { name: "B" })).json();
  await post(app, "/api/builds", { project_id: proj1.id, quantity: 1 });
  await post(app, "/api/builds", { project_id: proj2.id, quantity: 2 });

  const res = await get(app, `/api/builds?project_id=${proj1.id}`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].project_id, proj1.id);
  await db.destroy();
});

// --- Purchase Orders ---

Deno.test("POST /api/purchase-orders creates a PO", async () => {
  const { app, db } = await freshApp();
  const supplier = await (await post(app, "/api/suppliers", { name: "DigiKey" })).json();

  const res = await post(app, "/api/purchase-orders", { supplier_id: supplier.id });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertExists(body.id);
  assertEquals(body.supplier_id, supplier.id);
  assertEquals(body.status, "draft");
  await db.destroy();
});

Deno.test("POST /api/purchase-orders with supplier name", async () => {
  const { app, db } = await freshApp();
  await post(app, "/api/suppliers", { name: "Mouser" });

  const res = await post(app, "/api/purchase-orders", { supplier: "Mouser" });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.status, "draft");
  await db.destroy();
});

Deno.test("GET /api/purchase-orders lists POs", async () => {
  const { app, db } = await freshApp();
  const supplier = await (await post(app, "/api/suppliers", { name: "DigiKey" })).json();
  await post(app, "/api/purchase-orders", { supplier_id: supplier.id });
  await post(app, "/api/purchase-orders", { supplier_id: supplier.id, notes: "Second order" });

  const res = await get(app, "/api/purchase-orders");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 2);
  await db.destroy();
});

Deno.test("GET /api/purchase-orders/:id returns PO with lines", async () => {
  const { app, db } = await freshApp();
  const supplier = await (await post(app, "/api/suppliers", { name: "DigiKey" })).json();
  const po = await (await post(app, "/api/purchase-orders", { supplier_id: supplier.id })).json();

  const res = await get(app, `/api/purchase-orders/${po.id}`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.id, po.id);
  assertEquals(body.supplier_name, "DigiKey");
  assertExists(body.lines);
  assertEquals(body.lines.length, 0);
  assertEquals(body.total_cost, 0);
  await db.destroy();
});

Deno.test("GET /api/purchase-orders/:id returns 404 for missing", async () => {
  const { app, db } = await freshApp();
  const res = await get(app, "/api/purchase-orders/999");
  assertEquals(res.status, 404);
  await db.destroy();
});

Deno.test("PATCH /api/purchase-orders/:id updates PO", async () => {
  const { app, db } = await freshApp();
  const supplier = await (await post(app, "/api/suppliers", { name: "DigiKey" })).json();
  const po = await (await post(app, "/api/purchase-orders", { supplier_id: supplier.id })).json();

  const res = await patch(app, `/api/purchase-orders/${po.id}`, {
    status: "ordered",
    notes: "Placed on website",
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "ordered");
  assertEquals(body.notes, "Placed on website");
  await db.destroy();
});

// --- PO Lines ---

Deno.test("POST /api/purchase-orders/:id/lines adds a PO line with part_id", async () => {
  const { app, db } = await freshApp();
  const supplier = await (await post(app, "/api/suppliers", { name: "DigiKey" })).json();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();
  const po = await (await post(app, "/api/purchase-orders", { supplier_id: supplier.id })).json();

  const res = await post(app, `/api/purchase-orders/${po.id}/lines`, {
    part_id: part.id,
    quantity_ordered: 10,
    unit_price: 0.50,
  });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.quantity_ordered, 10);
  assertEquals(body.quantity_received, 0);
  assertEquals(body.part_name, "NE555");
  await db.destroy();
});

Deno.test("PATCH /api/po-lines/:id updates a PO line", async () => {
  const { app, db } = await freshApp();
  const supplier = await (await post(app, "/api/suppliers", { name: "DigiKey" })).json();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();
  const po = await (await post(app, "/api/purchase-orders", { supplier_id: supplier.id })).json();
  const line = await (
    await post(app, `/api/purchase-orders/${po.id}/lines`, {
      part_id: part.id,
      quantity_ordered: 10,
      unit_price: 0.50,
    })
  ).json();

  const res = await patch(app, `/api/po-lines/${line.id}`, {
    quantity_ordered: 20,
    unit_price: 0.45,
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.quantity_ordered, 20);
  assertEquals(body.unit_price, 0.45);
  await db.destroy();
});

Deno.test("POST /api/po-lines/:id/receive receives a PO line and adds stock", async () => {
  const { app, db } = await freshApp();
  const supplier = await (await post(app, "/api/suppliers", { name: "DigiKey" })).json();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();
  const po = await (await post(app, "/api/purchase-orders", { supplier_id: supplier.id })).json();
  const line = await (
    await post(app, `/api/purchase-orders/${po.id}/lines`, {
      part_id: part.id,
      quantity_ordered: 10,
    })
  ).json();

  const res = await post(app, `/api/po-lines/${line.id}/receive`, {
    quantity_received: 5,
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.quantity_received, 5);

  // Part stock should increase
  const partRes = await get(app, `/api/parts/${part.id}`);
  const updatedPart = await partRes.json();
  assertEquals(updatedPart.stock, 5);
  await db.destroy();
});

Deno.test("POST /api/po-lines/:id/receive full receive updates PO status", async () => {
  const { app, db } = await freshApp();
  const supplier = await (await post(app, "/api/suppliers", { name: "DigiKey" })).json();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();
  const po = await (await post(app, "/api/purchase-orders", { supplier_id: supplier.id })).json();
  const line = await (
    await post(app, `/api/purchase-orders/${po.id}/lines`, {
      part_id: part.id,
      quantity_ordered: 5,
    })
  ).json();

  // Receive all 5
  await post(app, `/api/po-lines/${line.id}/receive`, { quantity_received: 5 });

  // PO should be marked as received
  const poRes = await get(app, `/api/purchase-orders/${po.id}`);
  const updatedPo = await poRes.json();
  assertEquals(updatedPo.status, "received");
  await db.destroy();
});
