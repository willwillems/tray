/**
 * API integration tests: Categories CRUD and Part Thumbnails.
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

async function put(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return await app.fetch(
    new Request(`http://localhost${path}`, {
      method: "PUT",
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

async function uploadFile(
  app: ReturnType<typeof createApp>,
  entityType: string,
  entityId: number,
  filename: string,
  data: Uint8Array,
  mimeType: string,
) {
  const form = new FormData();
  form.append("file", new Blob([data], { type: mimeType }), filename);
  form.append("entity_type", entityType);
  form.append("entity_id", String(entityId));

  return await app.fetch(
    new Request("http://localhost/api/attachments", {
      method: "POST",
      body: form,
    }),
  );
}

// --- Categories CRUD ---

Deno.test("POST /api/categories creates a category", async () => {
  const { app, db } = await freshApp();
  const res = await post(app, "/api/categories", { name: "ICs" });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.name, "ICs");
  assertExists(body.id);
  assertEquals(body.parent_id, null);
  await db.destroy();
});

Deno.test("POST /api/categories creates a child category", async () => {
  const { app, db } = await freshApp();
  const parent = await (await post(app, "/api/categories", { name: "ICs" })).json();
  const res = await post(app, "/api/categories", {
    name: "Timers",
    parent_id: parent.id,
    description: "Timer ICs",
  });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.name, "Timers");
  assertEquals(body.parent_id, parent.id);
  assertEquals(body.description, "Timer ICs");
  await db.destroy();
});

Deno.test("POST /api/categories validates required name", async () => {
  const { app, db } = await freshApp();
  const res = await post(app, "/api/categories", {});
  assertEquals(res.status, 400);
  await db.destroy();
});

Deno.test("POST /api/categories/resolve resolves a path", async () => {
  const { app, db } = await freshApp();
  const res = await post(app, "/api/categories/resolve", { path: "ICs/Timers" });
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.name, "Timers");
  assertEquals(body.path, "ICs/Timers");
  assertExists(body.parent_id);
  await db.destroy();
});

Deno.test("POST /api/categories/resolve is idempotent", async () => {
  const { app, db } = await freshApp();
  const first = await (await post(app, "/api/categories/resolve", { path: "ICs/Timers" })).json();
  const second = await (await post(app, "/api/categories/resolve", { path: "ICs/Timers" })).json();
  assertEquals(first.id, second.id);
  assertEquals(first.path, second.path);
  await db.destroy();
});

Deno.test("GET /api/categories/:id returns category with path", async () => {
  const { app, db } = await freshApp();
  // Create via resolve so we get a multi-level path
  const created = await (await post(app, "/api/categories/resolve", { path: "ICs/Timers" })).json();

  const res = await get(app, `/api/categories/${created.id}`);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.name, "Timers");
  assertEquals(body.path, "ICs/Timers");
  assertExists(body.parent_id);
  await db.destroy();
});

Deno.test("GET /api/categories/:id returns 404 for missing", async () => {
  const { app, db } = await freshApp();
  const res = await get(app, "/api/categories/999");
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, "not_found");
  await db.destroy();
});

Deno.test("PATCH /api/categories/:id updates category", async () => {
  const { app, db } = await freshApp();
  const cat = await (await post(app, "/api/categories", { name: "ICs" })).json();

  const res = await patch(app, `/api/categories/${cat.id}`, {
    name: "Integrated Circuits",
    description: "All ICs",
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.name, "Integrated Circuits");
  assertEquals(body.description, "All ICs");
  assertEquals(body.path, "Integrated Circuits");
  await db.destroy();
});

Deno.test("PATCH /api/categories/:id returns 404 for missing", async () => {
  const { app, db } = await freshApp();
  const res = await patch(app, "/api/categories/999", { name: "test" });
  assertEquals(res.status, 404);
  await db.destroy();
});

Deno.test("DELETE /api/categories/:id deletes category", async () => {
  const { app, db } = await freshApp();
  const cat = await (await post(app, "/api/categories", { name: "ICs" })).json();

  const res = await del(app, `/api/categories/${cat.id}`);
  assertEquals(res.status, 200);

  const getRes = await get(app, `/api/categories/${cat.id}`);
  assertEquals(getRes.status, 404);
  await db.destroy();
});

Deno.test("DELETE /api/categories/:id returns 404 for missing", async () => {
  const { app, db } = await freshApp();
  const res = await del(app, "/api/categories/999");
  assertEquals(res.status, 404);
  await db.destroy();
});

Deno.test("DELETE /api/categories/:id re-parents children", async () => {
  const { app, db } = await freshApp();
  const parent = await (await post(app, "/api/categories", { name: "ICs" })).json();
  const child = await (await post(app, "/api/categories", { name: "Timers", parent_id: parent.id })).json();
  const grandchild = await (await post(app, "/api/categories", { name: "555", parent_id: child.id })).json();

  // Delete the middle category
  await del(app, `/api/categories/${child.id}`);

  // Grandchild should now be re-parented to "ICs"
  const gcRes = await get(app, `/api/categories/${grandchild.id}`);
  assertEquals(gcRes.status, 200);
  const gc = await gcRes.json();
  assertEquals(gc.parent_id, parent.id);
  assertEquals(gc.path, "ICs/555");
  await db.destroy();
});

// --- Part Thumbnails ---

Deno.test("PUT /api/parts/:id/thumbnail sets thumbnail from attachment", async () => {
  const { app, db } = await freshApp();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();

  // Create a real PNG using ImageScript
  const { Image } = await import("https://deno.land/x/imagescript@1.3.0/mod.ts");
  const img = new Image(256, 256);
  img.fill(0xFF0000FF);
  const png = await img.encode();

  // Upload as attachment
  const attRes = await uploadFile(app, "part", part.id, "photo.png", png, "image/png");
  assertEquals(attRes.status, 201);
  const att = await attRes.json();

  // Set thumbnail from that attachment
  const res = await put(app, `/api/parts/${part.id}/thumbnail`, {
    attachment_id: att.id,
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertExists(body.thumbnail);
  assertEquals(typeof body.thumbnail, "string");
  assert(body.thumbnail.length > 100);
  await db.destroy();
});

Deno.test("DELETE /api/parts/:id/thumbnail clears thumbnail", async () => {
  const { app, db } = await freshApp();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();

  // Create a real PNG and upload
  const { Image } = await import("https://deno.land/x/imagescript@1.3.0/mod.ts");
  const img = new Image(128, 128);
  img.fill(0x00FF00FF);
  const png = await img.encode();

  const att = await (await uploadFile(app, "part", part.id, "photo.png", png, "image/png")).json();

  // Set thumbnail
  await put(app, `/api/parts/${part.id}/thumbnail`, { attachment_id: att.id });

  // Verify it's set
  const beforeRes = await get(app, `/api/parts/${part.id}`);
  const before = await beforeRes.json();
  assertExists(before.thumbnail);

  // Clear it
  const res = await del(app, `/api/parts/${part.id}/thumbnail`);
  assertEquals(res.status, 200);

  // Verify it's gone
  const afterRes = await get(app, `/api/parts/${part.id}`);
  const after = await afterRes.json();
  assertEquals(after.thumbnail, null);
  await db.destroy();
});

Deno.test("PUT /api/parts/:id/thumbnail returns 400 for wrong attachment", async () => {
  const { app, db } = await freshApp();
  const part1 = await (await post(app, "/api/parts", { name: "NE555" })).json();
  const part2 = await (await post(app, "/api/parts", { name: "LM7805" })).json();

  // Upload attachment for part2
  const { Image } = await import("https://deno.land/x/imagescript@1.3.0/mod.ts");
  const img = new Image(64, 64);
  img.fill(0x0000FFFF);
  const png = await img.encode();

  const att = await (await uploadFile(app, "part", part2.id, "photo.png", png, "image/png")).json();

  // Try to set it as thumbnail for part1 -- should fail
  const res = await put(app, `/api/parts/${part1.id}/thumbnail`, { attachment_id: att.id });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "thumbnail_error");
  await db.destroy();
});

Deno.test("DELETE /api/parts/:id/thumbnail returns 404 for missing part", async () => {
  const { app, db } = await freshApp();
  const res = await del(app, "/api/parts/999/thumbnail");
  assertEquals(res.status, 404);
  await db.destroy();
});
