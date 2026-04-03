/**
 * Output formatting: JSON, CSV, table, with TTY auto-detection.
 *
 * Tables use @cliffy/table for proper word wrapping, column sizing,
 * and Unicode-aware rendering. Colors use @cliffy/ansi/colors,
 * restricted to functional use (errors, dim metadata).
 */

import { Table } from "@cliffy/table";
import { colors } from "@cliffy/ansi/colors";

export type OutputFormat = "json" | "csv" | "table";

/**
 * Detect the best output format based on environment.
 */
export function detectFormat(explicit?: string): OutputFormat {
  if (explicit) return explicit as OutputFormat;

  // If stdout is not a TTY (piped), default to JSON
  if (!Deno.stdout.isTerminal()) return "json";

  return "table";
}

/**
 * Output data in the specified format.
 */
export function output(
  // deno-lint-ignore no-explicit-any
  data: any,
  options?: { format?: string; columns?: string[] },
): void {
  const format = detectFormat(options?.format);

  switch (format) {
    case "json":
      console.log(JSON.stringify(data, null, 2));
      break;
    case "csv":
      outputCsv(data, options?.columns);
      break;
    case "table":
      outputTable(data, options?.columns);
      break;
  }
}

/**
 * Output as CSV.
 */
// deno-lint-ignore no-explicit-any
function outputCsv(data: any, columns?: string[]): void {
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length === 0) return;

  const cols = columns ?? Object.keys(rows[0]);

  // Header
  console.log(cols.join(","));

  // Rows
  for (const row of rows) {
    const values = cols.map((col) => {
      const val = row[col];
      if (val === null || val === undefined) return "";
      const str = String(val);
      // Quote if contains comma, quote, or newline
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    console.log(values.join(","));
  }
}

/**
 * Output as a formatted terminal table using @cliffy/table.
 */
// deno-lint-ignore no-explicit-any
function outputTable(data: any, columns?: string[]): void {
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length === 0) {
    console.log(colors.dim("No results."));
    return;
  }

  const cols = columns ?? selectDisplayColumns(rows[0]);

  // Build header row with bold labels
  const header = cols.map((col) => colors.bold(col));

  // Build body rows
  const body = rows.map((row) =>
    cols.map((col) => formatValue(row[col]))
  );

  new Table()
    .header(header)
    .body(body)
    .maxColWidth(50)
    .padding(1)
    .render();

  if (rows.length > 1) {
    console.log(colors.dim(`\n${rows.length} results.`));
  }
}

/**
 * Select sensible default columns for table display (skip large/internal fields).
 */
// deno-lint-ignore no-explicit-any
function selectDisplayColumns(sample: any): string[] {
  const skip = new Set([
    "thumbnail",
    "description",
    "keywords",
    "datasheet_url",
    "kicad_symbol_id",
    "kicad_footprint",
    "template_id",
    "is_template",
    "old_values",
    "new_values",
    "parameters",
    "created_at",
    "updated_at",
  ]);

  return Object.keys(sample).filter((k) => !skip.has(k));
}

/**
 * Format a value for display.
 */
function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (Array.isArray(val)) return val.join(", ");
  if (typeof val === "boolean") return val ? "yes" : "no";
  return String(val);
}

/**
 * Structured CLI error. Thrown by commands and caught by the global error
 * handler in mod.ts. Carries an error code for JSON output.
 */
export class CliError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "CliError";
  }
}

/**
 * Assert an API response is ok. If not, throw a CliError with the
 * server's error message (or the provided fallback).
 */
export async function assertOk(
  res: Response,
  code: string,
  fallback: string,
): Promise<void> {
  if (!res.ok) {
    const err = await res.json();
    throw new CliError(code, (err as { message?: string }).message ?? fallback);
  }
}

/**
 * Output an error in the appropriate format.
 */
export function outputError(
  error: string,
  message: string,
  format?: OutputFormat,
): void {
  const fmt = format ?? detectFormat();
  if (fmt === "json") {
    console.error(JSON.stringify({ error, message }));
  } else {
    console.error(colors.red(colors.bold("Error:")) + ` ${message}`);
  }
}
