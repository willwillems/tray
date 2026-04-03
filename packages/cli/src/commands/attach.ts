/**
 * `tray attach` -- Attachment management.
 *
 *   tray attach <part> <file> [--type datasheet|image|cad]
 *   tray attachments <part>
 *   tray detach <attachment_id>
 */

import { Command } from "@cliffy/command";
import { withClient, resolvePart, rawFetch } from "../client.ts";
import { output, assertOk, CliError } from "../output/format.ts";

export const attachCommand = new Command()
  .name("attach")
  .description("Attach a file to a part")
  .arguments("<part:string> <file:string>")
  .option("--type <type:string>", "Attachment type: datasheet, image, cad, other")
  .example("Attach a datasheet", "tray attach NE555 datasheet.pdf --type datasheet")
  .example("Attach an image", "tray attach NE555 photo.jpg --type image")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, partIdOrName, filePath) => {
    await withClient(options.db, async (client) => {
      const part = await resolvePart(client, partIdOrName);

      // Read file
      let data: Uint8Array;
      try {
        data = Deno.readFileSync(filePath);
      } catch {
        throw new CliError("file_error", `Cannot read file: ${filePath}`);
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

      await assertOk(res, "upload_failed", "Upload failed");

      const att = await res.json();
      output(att, { format: options.format });
    });
  });

export const attachmentsCommand = new Command()
  .name("attachments")
  .description("List attachments for a part")
  .arguments("<part:string>")
  .option("--format <fmt:string>", "Output format")
  .example("List attachments", "tray attachments NE555")
  .option("--db <path:string>", "Database path")
  .action(async (options, partIdOrName) => {
    await withClient(options.db, async (client) => {
      const part = await resolvePart(client, partIdOrName);

      const res = await rawFetch(
        `/api/attachments?entity_type=part&entity_id=${part.id}`,
      );

      if (!res.ok) {
        throw new CliError("error", "Failed to list attachments");
      }

      const atts = await res.json();
      output(atts, {
        format: options.format,
        columns: ["id", "filename", "type", "mime_type", "size_bytes", "created_at"],
      });
    });
  });

export const detachCommand = new Command()
  .name("detach")
  .description("Remove an attachment")
  .arguments("<id:integer>")
  .option("--format <fmt:string>", "Output format")
  .example("Remove attachment", "tray detach 5")
  .option("--db <path:string>", "Database path")
  .action(async (options, id) => {
    await withClient(options.db, async (_client) => {
      const res = await rawFetch(`/api/attachments/${id}`, { method: "DELETE" });

      await assertOk(res, "error", "Failed to detach");

      output(await res.json(), { format: options.format });
    });
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
