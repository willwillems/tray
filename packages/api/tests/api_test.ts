/**
 * API integration tests.
 *
 * Tests Hono routes via app.fetch() -- no real HTTP server.
 * Each test gets its own in-memory database.
 */

import { assertEquals, assertExists, assert } from "jsr:@std/assert";
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

// --- Health ---

Deno.test("GET /health returns ok", async () => {
  const { app, db } = await freshApp();
  const res = await get(app, "/health");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  await db.destroy();
});

// --- Parts CRUD ---

Deno.test("POST /api/parts creates a part", async () => {
  const { app, db } = await freshApp();
  const res = await post(app, "/api/parts", { name: "NE555" });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.name, "NE555");
  assertExists(body.id);
  assertEquals(body.stock, 0);
  assertEquals(body.tags, []);
  await db.destroy();
});

Deno.test("POST /api/parts with all fields", async () => {
  const { app, db } = await freshApp();
  const res = await post(app, "/api/parts", {
    name: "NE555",
    description: "Timer IC",
    category: "ICs/Timers",
    manufacturer: "Texas Instruments",
    mpn: "NE555P",
    stock: 25,
    tags: ["dip", "timer"],
  });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.name, "NE555");
  assertEquals(body.stock, 25);
  assertEquals(body.category_path, "ICs/Timers");
  assertEquals(body.manufacturer, "Texas Instruments");
  assertEquals(body.tags.sort(), ["dip", "timer"]);
  await db.destroy();
});

Deno.test("POST /api/parts validates required name", async () => {
  const { app, db } = await freshApp();
  const res = await post(app, "/api/parts", {});
  assertEquals(res.status, 400);
  await db.destroy();
});

Deno.test("POST /api/parts validates empty name", async () => {
  const { app, db } = await freshApp();
  const res = await post(app, "/api/parts", { name: "" });
  assertEquals(res.status, 400);
  await db.destroy();
});

Deno.test("GET /api/parts lists all parts", async () => {
  const { app, db } = await freshApp();
  await post(app, "/api/parts", { name: "NE555" });
  await post(app, "/api/parts", { name: "LM7805" });

  const res = await get(app, "/api/parts");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 2);
  await db.destroy();
});

Deno.test("GET /api/parts filters by category", async () => {
  const { app, db } = await freshApp();
  await post(app, "/api/parts", { name: "NE555", category: "ICs/Timers" });
  await post(app, "/api/parts", { name: "10k", category: "Passives/Resistors" });

  const res = await get(app, "/api/parts?category=ICs/Timers");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].name, "NE555");
  await db.destroy();
});

Deno.test("GET /api/parts/:id returns a part", async () => {
  const { app, db } = await freshApp();
  const createRes = await post(app, "/api/parts", { name: "NE555" });
  const created = await createRes.json();

  const res = await get(app, `/api/parts/${created.id}`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.name, "NE555");
  assertEquals(body.id, created.id);
  await db.destroy();
});

Deno.test("GET /api/parts/:id returns 404 for missing", async () => {
  const { app, db } = await freshApp();
  const res = await get(app, "/api/parts/999");
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, "not_found");
  await db.destroy();
});

Deno.test("PATCH /api/parts/:id updates a part", async () => {
  const { app, db } = await freshApp();
  const createRes = await post(app, "/api/parts", { name: "NE555" });
  const created = await createRes.json();

  const res = await patch(app, `/api/parts/${created.id}`, {
    description: "Timer IC",
    manufacturer: "Texas Instruments",
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.description, "Timer IC");
  assertEquals(body.manufacturer, "Texas Instruments");
  assertEquals(body.name, "NE555"); // unchanged
  await db.destroy();
});

Deno.test("PATCH /api/parts/:id returns 404 for missing", async () => {
  const { app, db } = await freshApp();
  const res = await patch(app, "/api/parts/999", { name: "test" });
  assertEquals(res.status, 404);
  await db.destroy();
});

Deno.test("DELETE /api/parts/:id removes a part", async () => {
  const { app, db } = await freshApp();
  const createRes = await post(app, "/api/parts", { name: "NE555" });
  const created = await createRes.json();

  const res = await del(app, `/api/parts/${created.id}`);
  assertEquals(res.status, 200);

  const getRes = await get(app, `/api/parts/${created.id}`);
  assertEquals(getRes.status, 404);
  await db.destroy();
});

Deno.test("DELETE /api/parts/:id returns 404 for missing", async () => {
  const { app, db } = await freshApp();
  const res = await del(app, "/api/parts/999");
  assertEquals(res.status, 404);
  await db.destroy();
});

// --- Search ---

Deno.test("GET /api/search returns matching parts", async () => {
  const { app, db } = await freshApp();
  await post(app, "/api/parts", { name: "NE555", description: "Timer IC" });
  await post(app, "/api/parts", { name: "LM7805", description: "Regulator" });

  const res = await get(app, "/api/search?q=timer");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].part.name, "NE555");
  await db.destroy();
});

Deno.test("GET /api/search requires q parameter", async () => {
  const { app, db } = await freshApp();
  const res = await get(app, "/api/search");
  assertEquals(res.status, 400);
  await db.destroy();
});

// --- Categories ---

Deno.test("GET /api/categories lists categories", async () => {
  const { app, db } = await freshApp();
  await post(app, "/api/parts", { name: "NE555", category: "ICs/Timers" });

  const res = await get(app, "/api/categories");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 2); // ICs, Timers
  await db.destroy();
});

Deno.test("GET /api/categories/tree returns tree structure", async () => {
  const { app, db } = await freshApp();
  await post(app, "/api/parts", { name: "NE555", category: "ICs/Timers" });
  await post(app, "/api/parts", { name: "LM7805", category: "ICs/Regulators" });

  const res = await get(app, "/api/categories/tree");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 1); // ICs root
  assertEquals(body[0].category.name, "ICs");
  assertEquals(body[0].children.length, 2); // Timers, Regulators
  await db.destroy();
});

// --- Audit ---

Deno.test("GET /api/audit returns audit log entries", async () => {
  const { app, db } = await freshApp();
  await post(app, "/api/parts", { name: "NE555" });

  const res = await get(app, "/api/audit");
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(body.length >= 1);
  assertEquals(body[0].entity_type, "part");
  assertEquals(body[0].action, "create");
  await db.destroy();
});

Deno.test("GET /api/audit filters by entity_type", async () => {
  const { app, db } = await freshApp();
  await post(app, "/api/parts", { name: "NE555" });

  const res = await get(app, "/api/audit?entity_type=part");
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(body.length >= 1);

  const noResults = await get(app, "/api/audit?entity_type=nonexistent");
  const emptyBody = await noResults.json();
  assertEquals(emptyBody.length, 0);
  await db.destroy();
});

// --- Tags ---

Deno.test("GET /api/tags returns all tags with counts", async () => {
  const { app, db } = await freshApp();
  await post(app, "/api/parts", { name: "NE555", tags: ["dip", "timer"] });
  await post(app, "/api/parts", { name: "LM7805", tags: ["dip"] });

  const res = await get(app, "/api/tags");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 2);
  const dip = body.find((t: { tag: string }) => t.tag === "dip");
  assertEquals(dip.count, 2);
  await db.destroy();
});
