/**
 * `tray export` -- Export parts to CSV or JSON.
 * `tray import` -- Import parts from CSV or JSON.
 * `tray project bom-import` -- Import KiCad BOM CSV into project.
 */

import { Command } from "@cliffy/command";
import { getClient, cleanup, rawFetch } from "../client.ts";
import { output, outputError, detectFormat } from "../output/format.ts";
import { exportParts, importPartsFromCsv, importPartsFromJson, importKicadBom } from "@tray/core";
import { setupDb } from "@tray/core";

export const exportCommand = new Command()
  .name("export")
  .description("Export parts to CSV or JSON")
  .option("--format <fmt:string>", "Export format: csv, json", { default: "csv" })
  .option("--category <cat:string>", "Filter by category")
  .option("--columns <cols:string>", "Comma-separated list of columns (CSV only)")
  .option("--db <path:string>", "Database path")
  .action(async (options) => {
    try {
      // Export works directly with the database for performance
      const dbPath = options.db ?? getDbPathFromEnv();
      const db = await setupDb(dbPath);

      const fmt = options.format === "json" ? "json" as const : "csv" as const;
      const columns = options.columns?.split(",").map((c: string) => c.trim());

      const result = await exportParts(db, {
        format: fmt,
        category: options.category,
        columns,
      });

      // Write to stdout (pipe-friendly)
      Deno.stdout.writeSync(new TextEncoder().encode(result));

      await db.destroy();
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e));
      Deno.exit(1);
    }
  });

export const importCommand = new Command()
  .name("import")
  .description("Import parts from a CSV or JSON file")
  .arguments("<file:string>")
  .option("--format <fmt:string>", "File format: csv, json (auto-detected from extension)")
  .option("--db <path:string>", "Database path")
  .action(async (options, filePath) => {
    const format = detectFormat(options.format);
    try {
      const dbPath = options.db ?? getDbPathFromEnv();
      const db = await setupDb(dbPath);

      let content: string;
      try {
        content = Deno.readTextFileSync(filePath);
      } catch {
        outputError("file_error", `Cannot read file: ${filePath}`, format);
        Deno.exit(1);
      }

      // Auto-detect format from extension
      const fmt = options.format ?? (filePath.endsWith(".json") ? "json" : "csv");

      const result = fmt === "json"
        ? await importPartsFromJson(db, content)
        : await importPartsFromCsv(db, content);

      if (format === "json") {
        output(result, { format });
      } else {
        console.log(`Import complete:`);
        console.log(`  Created: ${result.created}`);
        console.log(`  Skipped: ${result.skipped} (already exist)`);
        if (result.errors.length > 0) {
          console.log(`  Errors:  ${result.errors.length}`);
          for (const err of result.errors.slice(0, 10)) {
            console.log(`    Line ${err.line}: ${err.message}`);
          }
          if (result.errors.length > 10) {
            console.log(`    ... and ${result.errors.length - 10} more`);
          }
        }
      }

      await db.destroy();
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    }
  });

export const bomImportCommand = new Command()
  .name("bom-import")
  .description("Import a KiCad BOM CSV into a project's BOM")
  .arguments("<project_id:integer> <file:string>")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .action(async (options, projectId, filePath) => {
    const format = detectFormat(options.format);
    try {
      const dbPath = options.db ?? getDbPathFromEnv();
      const db = await setupDb(dbPath);

      let content: string;
      try {
        content = Deno.readTextFileSync(filePath);
      } catch {
        outputError("file_error", `Cannot read file: ${filePath}`, format);
        Deno.exit(1);
      }

      const result = await importKicadBom(db, projectId, content);

      if (format === "json") {
        output(result, { format });
      } else {
        console.log(`BOM import complete:`);
        console.log(`  Matched: ${result.matched} parts`);
        if (result.unmatched.length > 0) {
          console.log(`  Unmatched: ${result.unmatched.length} parts (not in inventory)`);
          for (const u of result.unmatched) {
            console.log(`    ${u.reference}: ${u.value} (${u.footprint})`);
          }
          console.log(`\nTip: Add missing parts with 'tray add', then re-import.`);
        }
      }

      await db.destroy();
    } catch (e) {
      outputError("error", e instanceof Error ? e.message : String(e), format);
      Deno.exit(1);
    }
  });

function getDbPathFromEnv(): string {
  const envPath = Deno.env.get("TRAY_DB");
  if (envPath) return envPath;
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
  const dir = `${home}/.tray`;
  try { Deno.mkdirSync(dir, { recursive: true }); } catch { /* exists */ }
  return `${dir}/data.db`;
}
