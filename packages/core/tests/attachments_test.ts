/**
 * Core unit tests: Attachments and thumbnails.
 */

import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { setupDb } from "../src/db.ts";
import { createPart } from "../src/parts.ts";
import {
  deleteAttachment,
  generateThumbnail,
  getAttachment,
  listAttachments,
  readAttachmentFile,
  storeAttachment,
} from "../src/attachments.ts";

async function freshDb() {
  return await setupDb(":memory:");
}

function tempDir(): string {
  return Deno.makeTempDirSync({ prefix: "tray-test-" });
}

/** Create a minimal valid PNG (1x1 pixel, red) */
function createTestPng(): Uint8Array {
  // Minimal 1x1 red PNG
  const header = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  ]);
  // We'll use ImageScript to create a proper one
  return header; // placeholder
}

/** Create test file content */
function createTestFile(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

// --- storeAttachment ---

Deno.test("storeAttachment - stores file and records metadata", async () => {
  const db = await freshDb();
  const dir = tempDir();
  const part = await createPart(db, { name: "NE555" });
  const data = createTestFile("test datasheet content");

  const att = await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "NE555_datasheet.pdf",
    data,
    mime_type: "application/pdf",
    attachments_dir: dir,
  });

  assertEquals(att.filename, "NE555_datasheet.pdf");
  assertEquals(att.entity_type, "part");
  assertEquals(att.entity_id, part.id);
  assertEquals(att.mime_type, "application/pdf");
  assertEquals(att.size_bytes, data.length);
  assertEquals(att.type, "datasheet"); // guessed from filename
  assertExists(att.hash);
  assertExists(att.storage_key);

  // File should exist on disk
  const stored = readAttachmentFile(dir, att.storage_key);
  assertEquals(stored.length, data.length);

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

Deno.test("storeAttachment - content-addressed dedup", async () => {
  const db = await freshDb();
  const dir = tempDir();
  const p1 = await createPart(db, { name: "Part1" });
  const p2 = await createPart(db, { name: "Part2" });
  const data = createTestFile("shared datasheet");

  const att1 = await storeAttachment(db, {
    entity_type: "part",
    entity_id: p1.id,
    filename: "shared.pdf",
    data,
    mime_type: "application/pdf",
    attachments_dir: dir,
  });

  const att2 = await storeAttachment(db, {
    entity_type: "part",
    entity_id: p2.id,
    filename: "also_shared.pdf",
    data,
    mime_type: "application/pdf",
    attachments_dir: dir,
  });

  // Same hash, same storage key (deduped)
  assertEquals(att1.hash, att2.hash);
  assertEquals(att1.storage_key, att2.storage_key);

  // But separate metadata rows
  assertEquals(att1.id !== att2.id, true);
  assertEquals(att1.filename, "shared.pdf");
  assertEquals(att2.filename, "also_shared.pdf");

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

Deno.test("storeAttachment - guesses type from mime and filename", async () => {
  const db = await freshDb();
  const dir = tempDir();
  const part = await createPart(db, { name: "NE555" });

  const img = await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "photo.jpg",
    data: createTestFile("fake image"),
    mime_type: "image/jpeg",
    attachments_dir: dir,
  });
  assertEquals(img.type, "image");

  const cad = await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "board.kicad_pcb",
    data: createTestFile("fake kicad"),
    mime_type: "application/octet-stream",
    attachments_dir: dir,
  });
  assertEquals(cad.type, "cad");

  const other = await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "notes.txt",
    data: createTestFile("some notes"),
    mime_type: "text/plain",
    attachments_dir: dir,
  });
  assertEquals(other.type, "other");

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

Deno.test("storeAttachment - creates audit log", async () => {
  const db = await freshDb();
  const dir = tempDir();
  const part = await createPart(db, { name: "NE555" });

  await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "test.pdf",
    data: createTestFile("test"),
    mime_type: "application/pdf",
    attachments_dir: dir,
  });

  const logs = await db.selectFrom("audit_log").selectAll()
    .where("entity_type", "=", "attachment").execute();
  assertEquals(logs.length, 1);
  assertEquals(logs[0].action, "create");

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

// --- listAttachments ---

Deno.test("listAttachments - returns attachments for entity", async () => {
  const db = await freshDb();
  const dir = tempDir();
  const part = await createPart(db, { name: "NE555" });

  await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "a.pdf",
    data: createTestFile("a"),
    mime_type: "application/pdf",
    attachments_dir: dir,
  });
  await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "b.pdf",
    data: createTestFile("b"),
    mime_type: "application/pdf",
    attachments_dir: dir,
  });

  const atts = await listAttachments(db, "part", part.id);
  assertEquals(atts.length, 2);

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

// --- deleteAttachment ---

Deno.test("deleteAttachment - removes metadata and file", async () => {
  const db = await freshDb();
  const dir = tempDir();
  const part = await createPart(db, { name: "NE555" });

  const att = await storeAttachment(db, {
    entity_type: "part",
    entity_id: part.id,
    filename: "test.pdf",
    data: createTestFile("test content"),
    mime_type: "application/pdf",
    attachments_dir: dir,
  });

  await deleteAttachment(db, att.id, dir);

  const found = await getAttachment(db, att.id);
  assertEquals(found, undefined);

  // File should be gone
  let exists = false;
  try {
    Deno.statSync(`${dir}/${att.storage_key}`);
    exists = true;
  } catch {
    exists = false;
  }
  assertEquals(exists, false);

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

Deno.test("deleteAttachment - keeps file if other references exist", async () => {
  const db = await freshDb();
  const dir = tempDir();
  const p1 = await createPart(db, { name: "Part1" });
  const p2 = await createPart(db, { name: "Part2" });
  const data = createTestFile("shared content");

  const att1 = await storeAttachment(db, {
    entity_type: "part",
    entity_id: p1.id,
    filename: "shared.pdf",
    data,
    mime_type: "application/pdf",
    attachments_dir: dir,
  });
  await storeAttachment(db, {
    entity_type: "part",
    entity_id: p2.id,
    filename: "shared2.pdf",
    data,
    mime_type: "application/pdf",
    attachments_dir: dir,
  });

  // Delete first reference
  await deleteAttachment(db, att1.id, dir);

  // File should still exist (second reference remains)
  const stored = readAttachmentFile(dir, att1.storage_key);
  assertEquals(stored.length, data.length);

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

Deno.test("deleteAttachment - not found throws", async () => {
  const db = await freshDb();
  await assertRejects(
    () => deleteAttachment(db, 999, "/tmp"),
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
  const dir = tempDir();
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
    attachments_dir: dir,
  });

  // Part should now have a thumbnail
  const updated = await db.selectFrom("parts").select("thumbnail")
    .where("id", "=", part.id).executeTakeFirstOrThrow();
  assertExists(updated.thumbnail);
  assertEquals(updated.thumbnail!.length > 100, true);

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});
