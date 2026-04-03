/**
 * `tray export` -- Export parts to CSV or JSON.
 * `tray import` -- Import parts from CSV or JSON.
 * `tray project bom-import` -- Import KiCad BOM CSV into project.
 */

import { Command } from "@cliffy/command";
import { getDbPath } from "../client.ts";
import { output, CliError } from "../output/format.ts";
import { exportParts, importPartsFromCsv, importPartsFromJson, importKicadBom } from "@tray/core";
import { setupDb } from "@tray/core";

export const exportCommand = new Command()
  .name("export")
  .description("Export parts to CSV or JSON")
  .option("--format <fmt:string>", "Export format: csv, json", { default: "csv" })
  .option("--category <cat:string>", "Filter by category")
  .option("--columns <cols:string>", "Comma-separated list of columns (CSV only)")
  .option("--db <path:string>", "Database path")
  .example("Export to CSV", "tray export > parts.csv")
  .example("Export as JSON", "tray export --format json > parts.json")
  .example("Export specific category", "tray export --category 'ICs' > ics.csv")
  .action(async (options) => {
    // Export works directly with the database for performance
    const dbPath = options.db ?? getDbPath();
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
  });

export const importCommand = new Command()
  .name("import")
  .description("Import parts from a CSV or JSON file")
  .arguments("<file:string>")
  .option("--format <fmt:string>", "File format: csv, json (auto-detected from extension)")
  .option("--db <path:string>", "Database path")
  .example("Import from CSV", "tray import parts.csv")
  .example("Import from JSON", "tray import parts.json")
  .action(async (options, filePath) => {
    const dbPath = options.db ?? getDbPath();
    const db = await setupDb(dbPath);

    let content: string;
    try {
      content = Deno.readTextFileSync(filePath);
    } catch {
      throw new CliError("file_error", `Cannot read file: ${filePath}`);
    }

    // Auto-detect format from extension
    const fmt = options.format ?? (filePath.endsWith(".json") ? "json" : "csv");

    const result = fmt === "json"
      ? await importPartsFromJson(db, content)
      : await importPartsFromCsv(db, content);

    if (options.format === "json") {
      output(result, { format: options.format });
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
  });

export const bomImportCommand = new Command()
  .name("bom-import")
  .description("Import a KiCad BOM CSV into a project's BOM")
  .arguments("<project_id:integer> <file:string>")
  .option("--format <fmt:string>", "Output format")
  .option("--db <path:string>", "Database path")
  .example("Import KiCad BOM", "tray bom-import 1 bom.csv")
  .action(async (options, projectId, filePath) => {
    const dbPath = options.db ?? getDbPath();
    const db = await setupDb(dbPath);

    let content: string;
    try {
      content = Deno.readTextFileSync(filePath);
    } catch {
      throw new CliError("file_error", `Cannot read file: ${filePath}`);
    }

    const result = await importKicadBom(db, projectId, content);

    if (options.format === "json") {
      output(result, { format: options.format });
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
  });
