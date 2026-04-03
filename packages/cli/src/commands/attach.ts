/**
 * `tray attach` -- Attachment management.
 *
 *   tray attach <part> <file-or-url> [--type datasheet|image|cad]
 *   tray attachments <part>
 *   tray detach <attachment_id>
 *
 * The <file-or-url> argument accepts either a local file path or an HTTP(S)
 * URL. When given a URL, the CLI fetches it and uploads the bytes to the
 * server via the same multipart endpoint.
 */

import { Command } from "@cliffy/command";
import { withClient, resolvePart, rawFetch } from "../client.ts";
import { output, assertOk, CliError } from "../output/format.ts";
import { resolveFileInput, warnIfUnsupportedImageFormat } from "../file-input.ts";

export const attachCommand = new Command()
  .name("attach")
  .description("Attach a file (local path or URL) to a part")
  .arguments("<part:string> <file-or-url:string>")
  .option("--type <type:string>", "Attachment type: datasheet, image, cad, other")
  .example("Attach a datasheet", "tray attach NE555 datasheet.pdf --type datasheet")
  .example("Attach an image", "tray attach NE555 photo.jpg --type image")
  .example("Attach from URL", 'tray attach NE555 "https://example.com/photo.jpg"')
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, partIdOrName, fileOrUrl) => {
    await withClient(options.db, async (client) => {
      const part = await resolvePart(client, partIdOrName);

      const file = await resolveFileInput(fileOrUrl);
      warnIfUnsupportedImageFormat(file.mimeType, file.filename);

      // Upload via multipart form (raw fetch -- Hono RPC doesn't handle multipart)
      const formData = new FormData();
      formData.append("file", new Blob([file.data], { type: file.mimeType }), file.filename);
      formData.append("entity_type", "part");
      formData.append("entity_id", String(part.id));
      if (options.type) formData.append("type", options.type);
      if (file.sourceUrl) formData.append("source_url", file.sourceUrl);

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
