/**
 * Shared helper for resolving file input from a local path or URL.
 *
 * Used by `tray attach` and `tray add --image` to support both local files
 * and remote URLs as input. The CLI fetches URL content client-side rather
 * than delegating to the server -- this keeps the API endpoints as clean
 * JSON or simple multipart, avoiding a hybrid "sometimes JSON, sometimes
 * the server fetches for you" contract.
 */

import { CliError } from "./output/format.ts";

/** MIME types whose images ImageScript can decode for thumbnail generation. */
const THUMBNAIL_SUPPORTED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

export interface FileInput {
  data: Uint8Array;
  filename: string;
  mimeType: string;
  /** Set when the input was a URL, so the server can record the source. */
  sourceUrl?: string;
}

/**
 * Resolve a file input string to bytes + metadata.
 *
 * If the input starts with http:// or https://, it is fetched as a URL.
 * Otherwise it is read as a local file path.
 */
export async function resolveFileInput(pathOrUrl: string): Promise<FileInput> {
  if (isUrl(pathOrUrl)) {
    return await fetchUrl(pathOrUrl);
  }
  return readLocalFile(pathOrUrl);
}

/**
 * Warn (to stderr) if the MIME type is an image format that ImageScript
 * cannot decode -- meaning no thumbnail will be generated.
 *
 * Formats supported by ImageScript: PNG, JPEG, GIF, WebP, BMP.
 * Common unsupported formats: AVIF, TIFF, SVG, HEIC.
 */
export function warnIfUnsupportedImageFormat(mimeType: string, filename: string): void {
  if (!mimeType.startsWith("image/")) return;
  if (THUMBNAIL_SUPPORTED_MIMES.has(mimeType)) return;

  const ext = filename.split(".").pop()?.toLowerCase() ?? "unknown";
  console.error(
    `Warning: .${ext} (${mimeType}) is not supported for thumbnail generation. ` +
    `The file will be attached, but no thumbnail will be created. ` +
    `Supported image formats: PNG, JPEG, GIF, WebP, BMP.`,
  );
}

function isUrl(input: string): boolean {
  return input.startsWith("http://") || input.startsWith("https://");
}

async function fetchUrl(url: string): Promise<FileInput> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new CliError(
      "fetch_error",
      `Failed to fetch URL: ${url} (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  if (!res.ok) {
    // Consume body to avoid resource leaks
    await res.body?.cancel();
    throw new CliError(
      "fetch_error",
      `Failed to fetch URL: ${url} (HTTP ${res.status})`,
    );
  }

  const data = new Uint8Array(await res.arrayBuffer());
  const filename = filenameFromUrl(url);
  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim();
  // Fall back to extension-based guess when the server returns a generic type
  const mimeType =
    (contentType && contentType !== "application/octet-stream")
      ? contentType
      : guessMimeType(filename);

  return { data, filename, mimeType, sourceUrl: url };
}

function readLocalFile(filePath: string): FileInput {
  let data: Uint8Array;
  try {
    data = Deno.readFileSync(filePath);
  } catch {
    throw new CliError("file_error", `Cannot read file: ${filePath}`);
  }

  const filename = filePath.split("/").pop() ?? filePath;
  const mimeType = guessMimeType(filename);

  return { data, filename, mimeType };
}

/**
 * Extract a reasonable filename from a URL path.
 * Falls back to "download" if the URL has no usable path segment.
 */
function filenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").pop();
    if (last && last.includes(".")) return last;
  } catch {
    // invalid URL, fall through
  }
  return "download";
}

/**
 * Guess MIME type from filename extension.
 */
export function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    avif: "image/avif",
    tiff: "image/tiff",
    tif: "image/tiff",
    svg: "image/svg+xml",
    heic: "image/heic",
    pdf: "application/pdf",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    kicad_sch: "application/x-kicad-schematic",
    kicad_pcb: "application/x-kicad-pcb",
    step: "model/step",
    stp: "model/step",
  };
  return map[ext] ?? "application/octet-stream";
}
