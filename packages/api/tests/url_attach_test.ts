/**
 * API integration tests: Attachment with source_url field.
 *
 * These tests verify the server correctly stores source_url metadata
 * when provided in the multipart upload. The actual URL fetching happens
 * in the CLI (file-input.ts), but the API must persist the source.
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

Deno.test("POST /api/attachments stores source_url when provided", async () => {
  const { app, db } = await freshApp();
  const part = await (await post(app, "/api/parts", { name: "TestPart" })).json();

  const form = new FormData();
  const data = new TextEncoder().encode("image data");
  form.append("file", new Blob([data], { type: "image/jpeg" }), "photo.jpg");
  form.append("entity_type", "part");
  form.append("entity_id", String(part.id));
  form.append("source_url", "https://example.com/photo.jpg");

  const res = await app.fetch(
    new Request("http://localhost/api/attachments", {
      method: "POST",
      body: form,
    }),
  );

  assertEquals(res.status, 201);
  const att = await res.json();
  assertEquals(att.source_url, "https://example.com/photo.jpg");
  assertEquals(att.filename, "photo.jpg");

  await db.destroy();
});

Deno.test("POST /api/attachments works without source_url (local file)", async () => {
  const { app, db } = await freshApp();
  const part = await (await post(app, "/api/parts", { name: "TestPart" })).json();

  const form = new FormData();
  const data = new TextEncoder().encode("local file data");
  form.append("file", new Blob([data], { type: "application/pdf" }), "datasheet.pdf");
  form.append("entity_type", "part");
  form.append("entity_id", String(part.id));

  const res = await app.fetch(
    new Request("http://localhost/api/attachments", {
      method: "POST",
      body: form,
    }),
  );

  assertEquals(res.status, 201);
  const att = await res.json();
  assertEquals(att.source_url, null);

  await db.destroy();
});

Deno.test("Image attachment generates thumbnail and source_url is preserved", async () => {
  const { app, db } = await freshApp();
  const part = await (await post(app, "/api/parts", { name: "TestPart" })).json();

  // Create a real PNG so thumbnail generation works
  const { Image } = await import("https://deno.land/x/imagescript@1.3.0/mod.ts");
  const img = new Image(200, 200);
  img.fill(0x3366FFFF);
  const png = await img.encode();

  const form = new FormData();
  form.append("file", new Blob([png], { type: "image/png" }), "product.png");
  form.append("entity_type", "part");
  form.append("entity_id", String(part.id));
  form.append("type", "image");
  form.append("source_url", "https://cdn.example.com/product.png");

  const res = await app.fetch(
    new Request("http://localhost/api/attachments", {
      method: "POST",
      body: form,
    }),
  );

  assertEquals(res.status, 201);
  const att = await res.json();
  assertEquals(att.source_url, "https://cdn.example.com/product.png");
  assertEquals(att.type, "image");

  // Part should now have a thumbnail
  const partRes = await get(app, `/api/parts/${part.id}`);
  const updated = await partRes.json();
  assertExists(updated.thumbnail);
  assertEquals(typeof updated.thumbnail, "string");

  await db.destroy();
});
