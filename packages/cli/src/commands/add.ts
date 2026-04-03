/**
 * `tray add` -- Add a new part.
 */

import { Command } from "@cliffy/command";
import { withClient, rawFetch } from "../client.ts";
import { output, assertOk } from "../output/format.ts";
import { resolveFileInput, warnIfUnsupportedImageFormat } from "../file-input.ts";

export const addCommand = new Command()
  .name("add")
  .description("Add a new part to inventory")
  .arguments("<name:string>")
  .option("--description <desc:string>", "Part description (markdown)")
  .option("--category <cat:string>", "Category path (e.g. 'ICs/Timers')")
  .option("--stock <qty:integer>", "Initial stock quantity", { default: 0 })
  .option("--location <loc:string>", "Storage location (e.g. 'Shelf 1/Drawer 3')")
  .option("--manufacturer <mfr:string>", "Manufacturer name")
  .option("--mpn <mpn:string>", "Manufacturer part number")
  .option("--ipn <ipn:string>", "Internal part number")
  .option("--footprint <fp:string>", "Footprint (e.g. '0805', 'DIP-8')")
  .option("--keywords <kw:string>", "Search keywords (space-separated)")
  .option("--tags <tags:string>", "Tags (comma-separated)")
  .option("--min-stock <min:integer>", "Minimum stock threshold", { default: 0 })
  .option("--favorite", "Mark as favorite")
  .option("--datasheet <url:string>", "Datasheet URL")
  .option("--image <path-or-url:string>", "Image file path or URL (sets part thumbnail)")
  .option("--format <fmt:string>", "Output format: json, csv, table")
  .option("--db <path:string>", "Database path")
  .example("Add a resistor", "tray add '10k Resistor' --category 'Passives/Resistors' --stock 100")
  .example("Add an IC with details", "tray add NE555 --category 'ICs/Timers' --manufacturer 'Texas Instruments' --mpn NE555P --footprint DIP-8 --stock 25")
  .example("Add with image", 'tray add "ALPHA RV112FF" --category "Potentiometers" --image "https://example.com/product.jpg"')
  .action(async (options, name) => {
    await withClient(options.db, async (client) => {
      const res = await client.api.parts.$post({
        json: {
          name,
          description: options.description,
          category: options.category,
          stock: options.stock,
          location: options.location,
          manufacturer: options.manufacturer,
          mpn: options.mpn,
          ipn: options.ipn,
          footprint: options.footprint,
          keywords: options.keywords,
          tags: options.tags?.split(",").map((t: string) => t.trim()),
          min_stock: options.minStock,
          favorite: options.favorite ?? false,
          datasheet_url: options.datasheet,
        },
      });

      await assertOk(res, "create_failed", "Failed to create part");
      // deno-lint-ignore no-explicit-any
      const part = await res.json() as any;

      // Attach image if provided.
      //
      // This is a second API call (create part, then attach image) rather than
      // a single combined endpoint. We considered having POST /api/parts accept
      // an image directly, but that would require either switching the endpoint
      // from JSON to multipart (messy for all non-image consumers) or having
      // the server fetch URLs on behalf of clients (implicit side-effect in a
      // create endpoint). Two explicit calls keeps the API clean: parts are
      // JSON, attachments are multipart. The server still handles thumbnail
      // generation automatically when an image attachment is stored.
      if (options.image) {
        const file = await resolveFileInput(options.image);
        warnIfUnsupportedImageFormat(file.mimeType, file.filename);

        const formData = new FormData();
        formData.append("file", new Blob([file.data], { type: file.mimeType }), file.filename);
        formData.append("entity_type", "part");
        formData.append("entity_id", String(part.id));
        formData.append("type", "image");
        if (file.sourceUrl) formData.append("source_url", file.sourceUrl);

        const attachRes = await rawFetch("/api/attachments", {
          method: "POST",
          body: formData,
        });

        await assertOk(attachRes, "image_upload_failed", "Part created but image upload failed");

        // Re-fetch the part so the output includes the thumbnail
        const updatedRes = await client.api.parts[":id"].$get({
          param: { id: String(part.id) },
        });
        if (updatedRes.ok) {
          output(await updatedRes.json(), { format: options.format });
          return;
        }
      }

      output(part, { format: options.format });
    });
  });
