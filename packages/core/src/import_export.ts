/**
 * Import/Export: CSV and JSON for parts, and KiCad BOM CSV import.
 *
 * Export: dump parts with tags, parameters, category paths to CSV or JSON.
 * Import: create/update parts from CSV or JSON.
 * BOM Import: parse KiCad BOM CSV and match to existing parts.
 */

import type { Kysely } from "kysely";
import type { Database } from "./schema.ts";
import { createPart, getPart, listParts } from "./parts.ts";
import { addBomLine } from "./projects.ts";
import type { PartWithDetails } from "./parts.ts";

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportOptions {
  format: "csv" | "json";
  category?: string;
  /** Which fields to include in CSV. Default: common fields. */
  columns?: string[];
}

const DEFAULT_CSV_COLUMNS = [
  "id", "name", "description", "category_path", "manufacturer", "mpn",
  "ipn", "footprint", "stock", "min_stock", "tags", "keywords",
  "manufacturing_status", "datasheet_url",
];

/**
 * Export parts as CSV or JSON string.
 */
export async function exportParts(
  db: Kysely<Database>,
  options: ExportOptions,
): Promise<string> {
  const parts = await listParts(db, options.category ? { category: options.category } : undefined);

  if (options.format === "json") {
    return JSON.stringify(parts, null, 2);
  }

  // CSV
  const columns = options.columns ?? DEFAULT_CSV_COLUMNS;
  const rows: string[] = [];

  // Header
  rows.push(columns.join(","));

  // Data rows
  for (const part of parts) {
    const values = columns.map((col) => {
      const val = getFieldValue(part, col);
      return csvEscape(val);
    });
    rows.push(values.join(","));
  }

  return rows.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { line: number; message: string }[];
}

/**
 * Import parts from a CSV string.
 * First row must be headers. Matches by name for updates.
 */
export async function importPartsFromCsv(
  db: Kysely<Database>,
  csvContent: string,
): Promise<ImportResult> {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) return { created: 0, updated: 0, skipped: 0, errors: [] };

  const headers = parseCsvLine(lines[0]);
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const values = parseCsvLine(line);
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j].trim().toLowerCase()] = values[j]?.trim() ?? "";
      }

      const name = row["name"] || row["value"] || row["component"];
      if (!name) {
        result.errors.push({ line: i + 1, message: "Missing name/value/component field" });
        continue;
      }

      // Check if part already exists
      const existing = await getPart(db, name);

      if (existing) {
        // Skip duplicates for now (could add --update flag later)
        result.skipped++;
        continue;
      }

      await createPart(db, {
        name,
        description: row["description"] || undefined,
        category: row["category"] || row["category_path"] || undefined,
        manufacturer: row["manufacturer"] || undefined,
        mpn: row["mpn"] || row["manufacturer_part_number"] || undefined,
        ipn: row["ipn"] || row["internal_part_number"] || undefined,
        footprint: row["footprint"] || row["package"] || undefined,
        stock: row["stock"] ? parseInt(row["stock"], 10) || 0 : undefined,
        min_stock: row["min_stock"] ? parseInt(row["min_stock"], 10) || 0 : undefined,
        keywords: row["keywords"] || undefined,
        tags: row["tags"] ? row["tags"].split(/[,;]/).map((t) => t.trim()).filter(Boolean) : undefined,
        datasheet_url: row["datasheet_url"] || row["datasheet"] || undefined,
        manufacturing_status: (row["manufacturing_status"] || undefined) as
          | "active" | "discontinued" | "eol" | "unknown" | undefined,
      });

      result.created++;
    } catch (e) {
      result.errors.push({ line: i + 1, message: e instanceof Error ? e.message : String(e) });
    }
  }

  return result;
}

/**
 * Import parts from a JSON string.
 * Expects an array of objects with part fields.
 */
export async function importPartsFromJson(
  db: Kysely<Database>,
  jsonContent: string,
): Promise<ImportResult> {
  const data = JSON.parse(jsonContent);
  const parts = Array.isArray(data) ? data : [data];
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (let i = 0; i < parts.length; i++) {
    try {
      const row = parts[i];
      const name = row.name || row.value || row.component;
      if (!name) {
        result.errors.push({ line: i + 1, message: "Missing name field" });
        continue;
      }

      const existing = await getPart(db, name);
      if (existing) {
        result.skipped++;
        continue;
      }

      await createPart(db, {
        name,
        description: row.description ?? undefined,
        category: row.category ?? row.category_path ?? undefined,
        manufacturer: row.manufacturer ?? undefined,
        mpn: row.mpn ?? undefined,
        ipn: row.ipn ?? undefined,
        footprint: row.footprint ?? undefined,
        stock: typeof row.stock === "number" ? row.stock : undefined,
        min_stock: typeof row.min_stock === "number" ? row.min_stock : undefined,
        keywords: row.keywords ?? undefined,
        tags: Array.isArray(row.tags) ? row.tags : undefined,
        datasheet_url: row.datasheet_url ?? undefined,
        manufacturing_status: row.manufacturing_status ?? undefined,
        kicad_symbol_id: row.kicad_symbol_id ?? undefined,
        kicad_footprint: row.kicad_footprint ?? undefined,
      });

      result.created++;
    } catch (e) {
      result.errors.push({ line: i + 1, message: e instanceof Error ? e.message : String(e) });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// KiCad BOM CSV Import
// ---------------------------------------------------------------------------

/**
 * Import a KiCad-exported BOM CSV into a project's BOM.
 *
 * KiCad BOM CSVs typically have columns like:
 *   Reference, Value, Footprint, Datasheet, Qty
 *   or: Ref, Value, Part, Footprint, Qty
 *
 * We match parts by Value (part name) or Footprint.
 * Unmatched parts are reported as errors.
 */
export async function importKicadBom(
  db: Kysely<Database>,
  projectId: number,
  csvContent: string,
): Promise<{
  matched: number;
  unmatched: { reference: string; value: string; footprint: string }[];
}> {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) return { matched: 0, unmatched: [] };

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const refIdx = headers.findIndex((h) => h === "reference" || h === "ref" || h === "references");
  const valIdx = headers.findIndex((h) => h === "value" || h === "val");
  const fpIdx = headers.findIndex((h) => h === "footprint" || h === "package");
  const qtyIdx = headers.findIndex((h) => h === "qty" || h === "quantity" || h === "count");

  if (valIdx === -1) {
    throw new Error("BOM CSV must have a 'Value' column");
  }

  const unmatched: { reference: string; value: string; footprint: string }[] = [];
  let matched = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line);
    const reference = refIdx >= 0 ? values[refIdx]?.trim() ?? "" : "";
    const value = values[valIdx]?.trim() ?? "";
    const footprint = fpIdx >= 0 ? values[fpIdx]?.trim() ?? "" : "";
    const qty = qtyIdx >= 0 ? parseInt(values[qtyIdx]?.trim() ?? "1", 10) || 1 : 1;

    if (!value) continue;

    // Try to find matching part by name
    const part = await getPart(db, value);

    if (part) {
      await addBomLine(db, {
        project_id: projectId,
        part_id: part.id,
        quantity_required: qty,
        reference_designators: reference || undefined,
      });
      matched++;
    } else {
      unmatched.push({ reference, value, footprint });
    }
  }

  return { matched, unmatched };
}

// ---------------------------------------------------------------------------
// CSV Helpers
// ---------------------------------------------------------------------------

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// deno-lint-ignore no-explicit-any
function getFieldValue(part: PartWithDetails, field: string): string {
  switch (field) {
    case "tags":
      return part.tags.join(", ");
    case "parameters":
      return part.parameters.map((p) => `${p.key}=${p.value}`).join("; ");
    default: {
      // deno-lint-ignore no-explicit-any
      const val = (part as any)[field];
      if (val === null || val === undefined) return "";
      if (Array.isArray(val)) return val.join(", ");
      return String(val);
    }
  }
}

/**
 * Parse a CSV line handling quoted fields with commas and escaped quotes.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        result.push(current);
        current = "";
        i++;
      } else {
        current += ch;
        i++;
      }
    }
  }

  result.push(current);
  return result;
}
