/**
 * Attachment domain: content-addressed blob storage with thumbnail generation.
 *
 * Files are stored via a BlobStore at key: {first-2-chars-of-hash}/{hash}.{ext}
 * Content-addressed: identical files are deduped by sha256 hash.
 * Thumbnails: 128x128 JPEG stored as base64 on Part.thumbnail.
 *
 * Platform dependencies: none. All I/O goes through the BlobStore interface.
 */

import type { Kysely } from "kysely";
import { recordAudit } from "./audit.ts";
import type { Attachment, Database } from "./schema.ts";
import type { BlobStore } from "./storage.ts";

// Image formats that ImageScript can decode for thumbnail generation.
// WebP is intentionally excluded -- ImageScript cannot decode it.
const THUMBNAIL_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/bmp",
]);

/**
 * Store an attachment file and record metadata.
 *
 * - Computes sha256 hash for content-addressed storage
 * - Deduplicates: if same hash already stored, reuses the blob
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
    store: BlobStore;
  },
): Promise<Attachment> {
  const now = new Date().toISOString();

  // Compute sha256 via the store's platform-appropriate hash implementation
  const hash = await input.store.hash(input.data);

  // Determine extension from filename
  const ext = fileExtension(input.filename) || guessExtension(input.mime_type);

  // Content-addressed storage key: {first-2}/{hash}.{ext}
  const prefix = hash.substring(0, 2);
  const storageKey = `${prefix}/${hash}${ext}`;

  // Write blob (only if not already stored -- dedup)
  if (!(await input.store.has(storageKey))) {
    await input.store.put(storageKey, input.data);
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

  // Generate thumbnail if this is an image attached to a Part.
  // Use magic bytes to detect the actual image format, not the MIME type
  // (marketplaces like AliExpress serve WebP files with .jpg extensions).
  if (input.entity_type === "part") {
    const actualFormat = detectImageFormat(input.data);
    if (actualFormat === "webp") {
      console.error(
        `Warning: ${input.filename} is a WebP image. ` +
        `Thumbnail generation is not supported for WebP. ` +
        `The file is attached, but no thumbnail was created. ` +
        `Convert to PNG/JPEG first, or attach a different image.`,
      );
    } else if (actualFormat && THUMBNAIL_MIMES.has(`image/${actualFormat}`)) {
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
 * Read the attachment file content from the blob store.
 */
export function readAttachmentFile(
  store: BlobStore,
  storageKey: string,
): Promise<Uint8Array> {
  return store.get(storageKey);
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
 * Only removes the blob if no other attachment references the same hash.
 */
export async function deleteAttachment(
  db: Kysely<Database>,
  id: number,
  store: BlobStore,
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

  // Only delete the blob if no other references exist
  if (!otherRefs) {
    await store.delete(attachment.storage_key);
  }

  // If this was a Part image, check whether the thumbnail should be cleared.
  // We must verify remaining attachments by reading their actual bytes (magic-byte
  // detection), not by trusting MIME types -- matching the logic in storeAttachment.
  // MIME types can be wrong (e.g. WebP served as image/jpeg by marketplaces).
  if (attachment.entity_type === "part" && attachment.mime_type.startsWith("image/")) {
    const remainingAttachments = await db
      .selectFrom("attachments")
      .select(["id", "storage_key"])
      .where("entity_type", "=", "part")
      .where("entity_id", "=", attachment.entity_id)
      .where("mime_type", "like", "image/%")
      .execute();

    // Check if any remaining attachment is a thumbnail-capable image (by magic bytes)
    let hasThumbnailCapableImage = false;
    for (const att of remainingAttachments) {
      try {
        const data = await store.get(att.storage_key);
        const format = detectImageFormat(data);
        if (format && format !== "webp" && THUMBNAIL_MIMES.has(`image/${format}`)) {
          hasThumbnailCapableImage = true;
          break;
        }
      } catch {
        // Blob missing or unreadable -- skip
      }
    }

    if (!hasThumbnailCapableImage) {
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
// Image Format Detection
// ---------------------------------------------------------------------------

/**
 * Detect file format from magic bytes. Returns the MIME type
 * or null if not a recognized format.
 *
 * This is more reliable than trusting file extensions or MIME types --
 * marketplaces commonly serve WebP files with .jpg extensions.
 *
 * This is the canonical magic-byte detection for the project.
 * The CLI has a separate copy (packages/cli/src/file-input.ts) due to
 * the package boundary rule (CLI cannot import core), but any format
 * additions should be made here first.
 */
export function detectMimeFromMagicBytes(data: Uint8Array): string | null {
  if (data.length < 12) return null;

  // PNG: 89 50 4E 47 (\x89PNG)
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
    return "image/jpeg";
  }

  // GIF: GIF8 (GIF87a or GIF89a)
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
    return "image/gif";
  }

  // WebP: RIFF....WEBP
  if (
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) {
    return "image/webp";
  }

  // BMP: BM
  if (data[0] === 0x42 && data[1] === 0x4D) {
    return "image/bmp";
  }

  // PDF: %PDF
  if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
    return "application/pdf";
  }

  return null;
}

/**
 * Detect image format from magic bytes. Returns the format name
 * (e.g. "png", "jpeg", "webp") or null if not a recognized image.
 *
 * Convenience wrapper around detectMimeFromMagicBytes for image-only checks.
 */
export function detectImageFormat(data: Uint8Array): string | null {
  const mime = detectMimeFromMagicBytes(data);
  if (!mime || !mime.startsWith("image/")) return null;
  // "image/jpeg" -> "jpeg", "image/png" -> "png", etc.
  return mime.substring(6);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract file extension from a filename (including the leading dot).
 * Returns empty string if no extension found.
 * Pure string operation -- no platform dependencies.
 */
function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot === -1 || dot === 0) return "";
  return filename.substring(dot).toLowerCase();
}

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
  const ext = fileExtension(filename);
  if ([".kicad_sch", ".kicad_pcb", ".kicad_sym", ".kicad_mod", ".step", ".stp"].includes(ext)) {
    return "cad";
  }
  return "other";
}
