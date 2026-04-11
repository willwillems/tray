/**
 * Core unit tests: Attachments and thumbnails.
 *
 * All tests use MemoryBlobStore -- no filesystem, no temp directories, no cleanup.
 */

import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { setupDb } from "../src/db.ts";
import { clearPartThumbnail, createPart, setPartThumbnail } from "../src/parts.ts";
import {
  deleteAttachment,
  detectImageFormat,
  generateThumbnail,
  getAttachment,
  listAttachments,
  readAttachmentFile,
  storeAttachment,
} from "../src/attachments.ts";
import { MemoryBlobStore } from "../src/storage-memory.ts";

async function freshDb() {
  return await setupDb(":memory:");
}

function freshStore() {
  return new MemoryBlobStore();
}

/** Create test file content */
function createTestFile(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

// --- storeAttachment ---

Deno.test("storeAttachment - stores file and records metadata", async () => {
  const db = await freshDb();
  const blobs = freshStore();
  const part = await createPart(db, { name: "NE555" });
  const data = createTestFile("test datasheet content");

  const att = await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "NE555_datasheet.pdf",
    data,
    mime_type: "application/pdf",
    store: blobs,
  });

  assertEquals(att.filename, "NE555_datasheet.pdf");
  assertEquals(att.entity_type, "part");
  assertEquals(att.entity_id, part.id);
  assertEquals(att.mime_type, "application/pdf");
  assertEquals(att.size_bytes, data.length);
  assertEquals(att.type, "datasheet"); // guessed from filename
  assertExists(att.hash);
  assertExists(att.storage_key);

  // File should exist in store
  const stored = await readAttachmentFile(blobs, att.storage_key);
  assertEquals(stored.length, data.length);

  await db.destroy();
});

Deno.test("storeAttachment - content-addressed dedup", async () => {
  const db = await freshDb();
  const blobs = freshStore();
  const p1 = await createPart(db, { name: "Part1" });
  const p2 = await createPart(db, { name: "Part2" });
  const data = createTestFile("shared datasheet");

  const att1 = await storeAttachment(db, {
    entity_type: "part",
    entity_id: p1.id,
    filename: "shared.pdf",
    data,
    mime_type: "application/pdf",
    store: blobs,
  });

  const att2 = await storeAttachment(db, {
    entity_type: "part",
    entity_id: p2.id,
    filename: "also_shared.pdf",
    data,
    mime_type: "application/pdf",
    store: blobs,
  });

  // Same hash, same storage key (deduped)
  assertEquals(att1.hash, att2.hash);
  assertEquals(att1.storage_key, att2.storage_key);

  // But separate metadata rows
  assertEquals(att1.id !== att2.id, true);
  assertEquals(att1.filename, "shared.pdf");
  assertEquals(att2.filename, "also_shared.pdf");

  await db.destroy();
});

Deno.test("storeAttachment - guesses type from mime and filename", async () => {
  const db = await freshDb();
  const blobs = freshStore();
  const part = await createPart(db, { name: "NE555" });

  const img = await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "photo.jpg",
    data: createTestFile("fake image"),
    mime_type: "image/jpeg",
    store: blobs,
  });
  assertEquals(img.type, "image");

  const cad = await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "board.kicad_pcb",
    data: createTestFile("fake kicad"),
    mime_type: "application/octet-stream",
    store: blobs,
  });
  assertEquals(cad.type, "cad");

  const other = await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "notes.txt",
    data: createTestFile("some notes"),
    mime_type: "text/plain",
    store: blobs,
  });
  assertEquals(other.type, "other");

  await db.destroy();
});

Deno.test("storeAttachment - creates audit log", async () => {
  const db = await freshDb();
  const blobs = freshStore();
  const part = await createPart(db, { name: "NE555" });

  await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "test.pdf",
    data: createTestFile("test"),
    mime_type: "application/pdf",
    store: blobs,
  });

  const logs = await db.selectFrom("audit_log").selectAll()
    .where("entity_type", "=", "attachment").execute();
  assertEquals(logs.length, 1);
  assertEquals(logs[0].action, "create");

  await db.destroy();
});

// --- listAttachments ---

Deno.test("listAttachments - returns attachments for entity", async () => {
  const db = await freshDb();
  const blobs = freshStore();
  const part = await createPart(db, { name: "NE555" });

  await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "a.pdf",
    data: createTestFile("a"),
    mime_type: "application/pdf",
    store: blobs,
  });
  await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "b.pdf",
    data: createTestFile("b"),
    mime_type: "application/pdf",
    store: blobs,
  });

  const atts = await listAttachments(db, "part", part.id);
  assertEquals(atts.length, 2);

  await db.destroy();
});

// --- deleteAttachment ---

Deno.test("deleteAttachment - removes metadata and blob", async () => {
  const db = await freshDb();
  const blobs = freshStore();
  const part = await createPart(db, { name: "NE555" });

  const att = await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "test.pdf",
    data: createTestFile("test content"),
    mime_type: "application/pdf",
    store: blobs,
  });

  await deleteAttachment(db, att.id, blobs);

  const found = await getAttachment(db, att.id);
  assertEquals(found, undefined);

  // Blob should be gone
  const exists = await blobs.has(att.storage_key);
  assertEquals(exists, false);

  await db.destroy();
});

Deno.test("deleteAttachment - keeps blob if other references exist", async () => {
  const db = await freshDb();
  const blobs = freshStore();
  const p1 = await createPart(db, { name: "Part1" });
  const p2 = await createPart(db, { name: "Part2" });
  const data = createTestFile("shared content");

  const att1 = await storeAttachment(db, {
    entity_type: "part",
    entity_id: p1.id,
    filename: "shared.pdf",
    data,
    mime_type: "application/pdf",
    store: blobs,
  });
  await storeAttachment(db, {
    entity_type: "part",
    entity_id: p2.id,
    filename: "shared2.pdf",
    data,
    mime_type: "application/pdf",
    store: blobs,
  });

  // Delete first reference
  await deleteAttachment(db, att1.id, blobs);

  // Blob should still exist (second reference remains)
  const stored = await readAttachmentFile(blobs, att1.storage_key);
  assertEquals(stored.length, data.length);

  await db.destroy();
});

Deno.test("deleteAttachment - not found throws", async () => {
  const db = await freshDb();
  const blobs = freshStore();
  await assertRejects(
    () => deleteAttachment(db, 999, blobs),
    Error,
    "Attachment 999 not found",
  );
  await db.destroy();
});

// --- Thumbnail Generation ---

Deno.test("generateThumbnail - creates base64 JPEG from PNG", async () => {
  // Create a real PNG using ImageScript
  const { Image } = await import("imagescript");
  const img = new Image(256, 256);
  img.fill(0xFF0000FF); // red
  const png = await img.encode();

  const base64 = await generateThumbnail(png);
  assertExists(base64);
  // Base64 JPEG should be reasonable size (< 10KB for a solid color)
  assertEquals(base64!.length > 100, true);
  assertEquals(base64!.length < 10000, true);
});

Deno.test("generateThumbnail - handles non-square images", async () => {
  const { Image } = await import("imagescript");
  // Wide image
  const wide = new Image(800, 200);
  wide.fill(0x00FF00FF); // green
  const widePng = await wide.encode();

  const thumb = await generateThumbnail(widePng);
  assertExists(thumb);
});

Deno.test("generateThumbnail - returns null for invalid data", async () => {
  const result = await generateThumbnail(new Uint8Array([1, 2, 3]));
  assertEquals(result, null);
});

Deno.test("storeAttachment - generates thumbnail for image attached to part", async () => {
  const db = await freshDb();
  const blobs = freshStore();
  const part = await createPart(db, { name: "NE555" });

  // Create a real PNG
  const { Image } = await import("imagescript");
  const img = new Image(256, 256);
  img.fill(0x3366FFFF);
  const png = await img.encode();

  await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "photo.png",
    data: png,
    mime_type: "image/png",
    store: blobs,
  });

  // Part should now have a thumbnail
  const updated = await db.selectFrom("parts").select("thumbnail")
    .where("id", "=", part.id).executeTakeFirstOrThrow();
  assertExists(updated.thumbnail);
  assertEquals(updated.thumbnail!.length > 100, true);

  await db.destroy();
});

// --- setPartThumbnail / clearPartThumbnail ---

Deno.test("setPartThumbnail - sets thumbnail from existing attachment", async () => {
  const db = await freshDb();
  const blobs = freshStore();
  const part = await createPart(db, { name: "NE555" });

  // Create and attach an image
  const { Image } = await import("imagescript");
  const img = new Image(256, 256);
  img.fill(0xFF0000FF);
  const png = await img.encode();

  const att = await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "photo.png",
    data: png,
    mime_type: "image/png",
    store: blobs,
  });

  // Clear the auto-generated thumbnail first
  await db.updateTable("parts").set({ thumbnail: null }).where("id", "=", part.id).execute();
  const cleared = await db.selectFrom("parts").select("thumbnail").where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(cleared.thumbnail, null);

  // Now set it from the attachment
  const result = await setPartThumbnail(db, part.id, att.id, blobs);
  assertExists(result.thumbnail);
  assertEquals(result.thumbnail!.length > 100, true);

  await db.destroy();
});

Deno.test("setPartThumbnail - rejects attachment from different part", async () => {
  const db = await freshDb();
  const blobs = freshStore();
  const part1 = await createPart(db, { name: "NE555" });
  const part2 = await createPart(db, { name: "LM7805" });

  const att = await storeAttachment(db, {
    entity_type: "part",
    entity_id: part1.id,
    filename: "photo.png",
    data: createTestFile("img"),
    mime_type: "image/png",
    store: blobs,
  });

  await assertRejects(
    () => setPartThumbnail(db, part2.id, att.id, blobs),
    Error,
    "does not belong to part",
  );

  await db.destroy();
});

Deno.test("setPartThumbnail - rejects non-image attachment", async () => {
  const db = await freshDb();
  const blobs = freshStore();
  const part = await createPart(db, { name: "NE555" });

  const att = await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "datasheet.pdf",
    data: createTestFile("not an image"),
    mime_type: "application/pdf",
    store: blobs,
  });

  await assertRejects(
    () => setPartThumbnail(db, part.id, att.id, blobs),
    Error,
    "Could not generate thumbnail",
  );

  await db.destroy();
});

Deno.test("clearPartThumbnail - clears existing thumbnail", async () => {
  const db = await freshDb();
  const blobs = freshStore();
  const part = await createPart(db, { name: "NE555" });

  // Create and attach an image (auto-generates thumbnail)
  const { Image } = await import("imagescript");
  const img = new Image(64, 64);
  img.fill(0x00FF00FF);
  const png = await img.encode();

  await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "photo.png",
    data: png,
    mime_type: "image/png",
    store: blobs,
  });

  // Verify thumbnail exists
  const before = await db.selectFrom("parts").select("thumbnail").where("id", "=", part.id).executeTakeFirstOrThrow();
  assertExists(before.thumbnail);

  // Clear it
  const result = await clearPartThumbnail(db, part.id);
  assertEquals(result.thumbnail, null);

  await db.destroy();
});

// --- detectImageFormat ---

Deno.test("detectImageFormat - detects PNG", () => {
  const data = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
  assertEquals(detectImageFormat(data), "png");
});

Deno.test("detectImageFormat - detects JPEG", () => {
  const data = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assertEquals(detectImageFormat(data), "jpeg");
});

Deno.test("detectImageFormat - detects GIF", () => {
  const data = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
  assertEquals(detectImageFormat(data), "gif");
});

Deno.test("detectImageFormat - detects WebP", () => {
  // RIFF....WEBP
  const data = new Uint8Array([
    0x52, 0x49, 0x46, 0x46,  // RIFF
    0x00, 0x00, 0x00, 0x00,  // file size (don't care)
    0x57, 0x45, 0x42, 0x50,  // WEBP
  ]);
  assertEquals(detectImageFormat(data), "webp");
});

Deno.test("detectImageFormat - detects BMP", () => {
  const data = new Uint8Array([0x42, 0x4D, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assertEquals(detectImageFormat(data), "bmp");
});

Deno.test("detectImageFormat - returns null for unknown format", () => {
  const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
  assertEquals(detectImageFormat(data), null);
});

Deno.test("detectImageFormat - returns null for data too short", () => {
  const data = new Uint8Array([0x89, 0x50]);
  assertEquals(detectImageFormat(data), null);
});

Deno.test("storeAttachment - WebP file with .jpg extension skips thumbnail and warns", async () => {
  const db = await freshDb();
  const blobs = freshStore();
  const part = await createPart(db, { name: "NE555" });

  // Create a fake WebP file (correct magic bytes, but not a real image)
  const webpData = new Uint8Array([
    0x52, 0x49, 0x46, 0x46,  // RIFF
    0x24, 0x00, 0x00, 0x00,  // file size
    0x57, 0x45, 0x42, 0x50,  // WEBP
    0x56, 0x50, 0x38, 0x20,  // VP8 chunk
    0x00, 0x00, 0x00, 0x00,  // chunk size
    0x00, 0x00, 0x00, 0x00,  // padding
  ]);

  // Attach as image/jpeg (simulating a WebP file with .jpg extension,
  // as AliExpress commonly serves)
  const att = await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "product.jpg",
    data: webpData,
    mime_type: "image/jpeg",  // wrong MIME from extension guess
    store: blobs,
  });

  // Attachment should be stored successfully
  assertExists(att.id);

  // But thumbnail should NOT be generated (WebP detected by magic bytes)
  const updated = await db.selectFrom("parts").select("thumbnail")
    .where("id", "=", part.id).executeTakeFirstOrThrow();
  assertEquals(updated.thumbnail, null);

  await db.destroy();
});
