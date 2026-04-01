/**
 * `tray attach` -- Attachment management.
 *
 *   tray attach <part> <file> [--type datasheet|image|cad]
 *   tray attachments <part>
 *   tray detach <attachment_id>
 */

import { Command } from "@cliffy/command";
import { getClient, cleanup, rawFetch } from "../client.ts";
import { output, outputError, detectFormat } from "../output/format.ts";

export const attachCommand = new Command()
  .name("attach")
  .description("Attach a file to a part")
  .arguments("<part:string> <file:string>")
  .option("--type <type:string>", "Attachment type: datasheet, image, cad, other")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, partIdOrName, filePath) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });

      // Resolve part
      const partRes = await client.api.parts[":id"].$get({
        param: { id: partIdOrName },
      });
      if (!partRes.ok) {
        outputError("not_found", `Part '${partIdOrName}' not found`, format);
        Deno.exit(1);
      }
      const part = await partRes.json();

      // Read file
      let data: Uint8Array;
      try {
        data = Deno.readFileSync(filePath);
      } catch {
        outputError("file_error", `Cannot read file: ${filePath}`, format);
        Deno.exit(1);
      }

      const filename = filePath.split("/").pop() ?? filePath;

      // Guess mime type from extension
      const mimeType = guessMimeType(filename);

      // Upload via multipart form (raw fetch -- Hono RPC doesn't handle multipart)
      const formData = new FormData();
      formData.append("file", new Blob([data], { type: mimeType }), filename);
      formData.append("entity_type", "part");
      formData.append("entity_id", String(part.id));
      if (options.type) formData.append("type", options.type);

      const res = await rawFetch("/api/attachments", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        outputError("upload_failed", (err as { message?: string }).message ?? "Upload failed", format);
        Deno.exit(1);
      }

      const att = await res.json();
      output(att, { format });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });

export const attachmentsCommand = new Command()
  .name("attachments")
  .description("List attachments for a part")
  .arguments("<part:string>")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, partIdOrName) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });

      // Resolve part
      const partRes = await client.api.parts[":id"].$get({
        param: { id: partIdOrName },
      });
      if (!partRes.ok) {
        outputError("not_found", `Part '${partIdOrName}' not found`, format);
        Deno.exit(1);
      }
      const part = await partRes.json();

      const res = await rawFetch(
        `/api/attachments?entity_type=part&entity_id=${part.id}`,
      );

      if (!res.ok) {
        outputError("error", "Failed to list attachments", format);
        Deno.exit(1);
      }

      const atts = await res.json();
      output(atts, {
        format,
        columns: ["id", "filename", "type", "mime_type", "size_bytes", "created_at"],
      });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });

export const detachCommand = new Command()
  .name("detach")
  .description("Remove an attachment")
  .arguments("<id:integer>")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, id) => {
    const format = detectFormat(options.format);
    try {
      const client = await getClient({ dbPath: options.db });
      const res = await rawFetch(`/api/attachments/${id}`, { method: "DELETE" });

      if (!res.ok) {
        const err = await res.json();
        outputError("error", (err as { message?: string }).message ?? "Failed to detach", format);
        Deno.exit(1);
      }

      output(await res.json(), { format });
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    } finally {
      await cleanup();
    }
  });

function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
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
