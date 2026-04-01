/**
 * Attachment domain: content-addressed file storage with thumbnail generation.
 *
 * Files are stored at: {attachments_dir}/{first-2-chars-of-hash}/{hash}.{ext}
 * Content-addressed: identical files are deduped by sha256 hash.
 * Thumbnails: 128x128 JPEG stored as base64 on Part.thumbnail.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Kysely } from "kysely";
import { recordAudit } from "./audit.ts";
import type { Attachment, Database } from "./schema.ts";

// Image formats that can generate thumbnails
const THUMBNAIL_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

/**
 * Store an attachment file and record metadata.
 *
 * - Computes sha256 hash for content-addressed storage
 * - Deduplicates: if same hash already stored, reuses the file
 * - If attached to a Part and it's an image, generates a 128x128 JPEG thumbnail
 */
export async function storeAttachment(
  db: Kysely<Database>,
  input: {
    entity_type: string; // "part", "project", etc.
    entity_id: number;
    filename: string;
    data: Uint8Array;
    mime_type: string;
    type?: string; // "datasheet", "image", "cad", "other"
    source_url?: string;
    attachments_dir: string; // base directory for file storage
  },
): Promise<Attachment> {
  const now = new Date().toISOString();

  // Compute sha256
  const hash = createHash("sha256").update(input.data).digest("hex");

  // Determine extension from filename
  const ext = extname(input.filename).toLowerCase() || guessExtension(input.mime_type);

  // Content-addressed storage path: {dir}/{first-2}/{hash}.{ext}
  const prefix = hash.substring(0, 2);
  const storageKey = `${prefix}/${hash}${ext}`;
  const dirPath = join(input.attachments_dir, prefix);
  const filePath = join(input.attachments_dir, storageKey);

  // Write file (only if not already stored -- dedup)
  if (!existsSync(filePath)) {
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(filePath, input.data);
  }

  // Determine attachment type
  const type = input.type ?? guessType(input.mime_type, input.filename);

  // Insert metadata
  const attachment = await db
    .insertInto("attachments")
    .values({
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      filename: input.filename,
      storage_key: storageKey,
      mime_type: input.mime_type,
      size_bytes: input.data.length,
      hash,
      type,
      source_url: input.source_url ?? null,
      created_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // Generate thumbnail if this is an image attached to a Part
  if (input.entity_type === "part" && THUMBNAIL_MIMES.has(input.mime_type)) {
    try {
      const thumbBase64 = await generateThumbnail(input.data);
      if (thumbBase64) {
        await db
          .updateTable("parts")
          .set({ thumbnail: thumbBase64 })
          .where("id", "=", input.entity_id)
          .execute();
      }
    } catch {
      // Thumbnail generation failure is non-fatal
    }
  }

  await recordAudit(db, {
    entity_type: "attachment",
    entity_id: attachment.id,
    action: "create",
    new_values: {
      filename: attachment.filename,
      entity_type: attachment.entity_type,
      entity_id: attachment.entity_id,
      size_bytes: attachment.size_bytes,
    },
  });

  return attachment;
}

/**
 * Get attachment metadata by ID.
 */
export async function getAttachment(
  db: Kysely<Database>,
  id: number,
): Promise<Attachment | undefined> {
  return await db
    .selectFrom("attachments")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
}

/**
 * Read the attachment file content from disk.
 */
export function readAttachmentFile(
  attachmentsDir: string,
  storageKey: string,
): Uint8Array {
  const filePath = join(attachmentsDir, storageKey);
  return readFileSync(filePath);
}

/**
 * List attachments for an entity.
 */
export async function listAttachments(
  db: Kysely<Database>,
  entityType: string,
  entityId: number,
): Promise<Attachment[]> {
  return await db
    .selectFrom("attachments")
    .selectAll()
    .where("entity_type", "=", entityType)
    .where("entity_id", "=", entityId)
    .orderBy("created_at")
    .execute();
}

/**
 * Delete an attachment. Removes the metadata row.
 * Only removes the file if no other attachment references the same hash.
 */
export async function deleteAttachment(
  db: Kysely<Database>,
  id: number,
  attachmentsDir: string,
): Promise<void> {
  const attachment = await getAttachment(db, id);
  if (!attachment) throw new Error(`Attachment ${id} not found`);

  await db.deleteFrom("attachments").where("id", "=", id).execute();

  // Check if any other attachment uses this hash
  const otherRefs = await db
    .selectFrom("attachments")
    .select("id")
    .where("hash", "=", attachment.hash)
    .executeTakeFirst();

  // Only delete the file if no other references exist
  if (!otherRefs) {
    const filePath = join(attachmentsDir, attachment.storage_key);
    try {
      unlinkSync(filePath);
    } catch {
      // File might already be gone
    }
  }

  // If this was a Part image, clear the thumbnail
  if (attachment.entity_type === "part" && THUMBNAIL_MIMES.has(attachment.mime_type)) {
    // Check if the part has any remaining image attachments
    const remainingImages = await db
      .selectFrom("attachments")
      .select("id")
      .where("entity_type", "=", "part")
      .where("entity_id", "=", attachment.entity_id)
      .where("mime_type", "in", [...THUMBNAIL_MIMES])
      .executeTakeFirst();

    if (!remainingImages) {
      await db
        .updateTable("parts")
        .set({ thumbnail: null })
        .where("id", "=", attachment.entity_id)
        .execute();
    }
  }

  await recordAudit(db, {
    entity_type: "attachment",
    entity_id: id,
    action: "delete",
    old_values: {
      filename: attachment.filename,
      entity_type: attachment.entity_type,
      entity_id: attachment.entity_id,
    },
  });
}

// ---------------------------------------------------------------------------
// Thumbnail Generation
// ---------------------------------------------------------------------------

/**
 * Generate a 128x128 JPEG thumbnail from image data.
 * Returns base64 string, or null if generation fails.
 *
 * ~50ms per image. Happens once on upload, never on read.
 */
export async function generateThumbnail(
  imageData: Uint8Array,
): Promise<string | null> {
  try {
    const { decode, Image } = await import("imagescript");
    // deno-lint-ignore no-explicit-any
    const img = await decode(imageData) as any;

    // Resize to 128x128 (cover mode -- crops to fill)
    const size = 128;
    const aspect = img.width / img.height;
    let resized;
    if (aspect > 1) {
      resized = img.resize(Image.RESIZE_AUTO, size);
    } else {
      resized = img.resize(size, Image.RESIZE_AUTO);
    }

    // Crop to exact 128x128 from center
    const cropX = Math.max(0, Math.floor((resized.width - size) / 2));
    const cropY = Math.max(0, Math.floor((resized.height - size) / 2));
    const cropped = resized.crop(cropX, cropY, size, size);

    const jpeg = await cropped.encodeJPEG(65);
    return btoa(String.fromCharCode(...jpeg));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function guessExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/json": ".json",
  };
  return map[mimeType] ?? "";
}

function guessType(mimeType: string, filename: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") {
    const lower = filename.toLowerCase();
    if (lower.includes("datasheet") || lower.includes("spec")) return "datasheet";
    return "document";
  }
  const ext = extname(filename).toLowerCase();
  if ([".kicad_sch", ".kicad_pcb", ".kicad_sym", ".kicad_mod", ".step", ".stp"].includes(ext)) {
    return "cad";
  }
  return "other";
}
