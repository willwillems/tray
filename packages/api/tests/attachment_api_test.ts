/**
 * API integration tests: Attachments.
 *
 * Uses MemoryBlobStore -- no temp dirs, no cleanup.
 */

import { assertEquals, assertExists } from "jsr:@std/assert";
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

async function del(app: ReturnType<typeof createApp>, path: string) {
  return await app.fetch(new Request(`http://localhost${path}`, { method: "DELETE" }));
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

Deno.test("POST /api/attachments uploads file", async () => {
  const { app, db } = await freshApp();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();

  const data = new TextEncoder().encode("test datasheet content");
  const res = await uploadFile(app, "part", part.id, "NE555_datasheet.pdf", data, "application/pdf");

  assertEquals(res.status, 201);
  const att = await res.json();
  assertEquals(att.filename, "NE555_datasheet.pdf");
  assertEquals(att.entity_type, "part");
  assertEquals(att.entity_id, part.id);
  assertEquals(att.mime_type, "application/pdf");
  assertEquals(att.size_bytes, data.length);
  assertExists(att.hash);

  await db.destroy();
});

Deno.test("GET /api/attachments/:id returns metadata", async () => {
  const { app, db } = await freshApp();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();
  const data = new TextEncoder().encode("content");
  const uploaded = await (await uploadFile(app, "part", part.id, "test.txt", data, "text/plain")).json();

  const res = await get(app, `/api/attachments/${uploaded.id}`);
  assertEquals(res.status, 200);
  const att = await res.json();
  assertEquals(att.filename, "test.txt");

  await db.destroy();
});

Deno.test("GET /api/attachments/:id/file serves file content", async () => {
  const { app, db } = await freshApp();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();
  const content = "hello world datasheet";
  const data = new TextEncoder().encode(content);
  const uploaded = await (await uploadFile(app, "part", part.id, "test.txt", data, "text/plain")).json();

  const res = await get(app, `/api/attachments/${uploaded.id}/file`);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/plain");

  const body = await res.text();
  assertEquals(body, content);

  await db.destroy();
});

Deno.test("GET /api/attachments lists by entity", async () => {
  const { app, db } = await freshApp();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();
  await uploadFile(app, "part", part.id, "a.pdf", new TextEncoder().encode("a"), "application/pdf");
  await uploadFile(app, "part", part.id, "b.pdf", new TextEncoder().encode("b"), "application/pdf");

  const res = await get(app, `/api/attachments?entity_type=part&entity_id=${part.id}`);
  assertEquals(res.status, 200);
  const atts = await res.json();
  assertEquals(atts.length, 2);

  await db.destroy();
});

Deno.test("DELETE /api/attachments/:id removes attachment", async () => {
  const { app, db } = await freshApp();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();
  const uploaded = await (
    await uploadFile(app, "part", part.id, "test.txt", new TextEncoder().encode("x"), "text/plain")
  ).json();

  const res = await del(app, `/api/attachments/${uploaded.id}`);
  assertEquals(res.status, 200);

  const getRes = await get(app, `/api/attachments/${uploaded.id}`);
  assertEquals(getRes.status, 404);

  await db.destroy();
});

Deno.test("POST /api/attachments generates thumbnail for image", async () => {
  const { app, db } = await freshApp();
  const part = await (await post(app, "/api/parts", { name: "NE555" })).json();

  // Create a real PNG
  const { Image } = await import("https://deno.land/x/imagescript@1.3.0/mod.ts");
  const img = new Image(256, 256);
  img.fill(0xFF0000FF);
  const png = await img.encode();

  const res = await uploadFile(app, "part", part.id, "photo.png", png, "image/png");
  assertEquals(res.status, 201);

  // Part should now have a thumbnail
  const partRes = await get(app, `/api/parts/${part.id}`);
  const updated = await partRes.json();
  assertExists(updated.thumbnail);
  assertEquals(typeof updated.thumbnail, "string");
  assertEquals(updated.thumbnail.length > 100, true);

  await db.destroy();
});
