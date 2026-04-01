/**
 * Output formatting: JSON, CSV, table, with TTY auto-detection.
 */

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
  options?: { format?: OutputFormat; columns?: string[] },
): void {
  const format = options?.format ?? detectFormat();

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
 * Output as a formatted terminal table.
 */
// deno-lint-ignore no-explicit-any
function outputTable(data: any, columns?: string[]): void {
  const rows = Array.isArray(data) ? data : [data];
  if (rows.length === 0) {
    console.log("No results.");
    return;
  }

  const cols = columns ?? selectDisplayColumns(rows[0]);

  // Calculate column widths
  const widths = cols.map((col) => {
    const headerLen = col.length;
    const maxDataLen = rows.reduce((max, row) => {
      const val = formatValue(row[col]);
      return Math.max(max, val.length);
    }, 0);
    return Math.min(Math.max(headerLen, maxDataLen), 40); // Cap at 40 chars
  });

  // Header
  const header = cols.map((col, i) => col.padEnd(widths[i])).join("  ");
  console.log(header);
  console.log(cols.map((_, i) => "-".repeat(widths[i])).join("  "));

  // Rows
  for (const row of rows) {
    const line = cols
      .map((col, i) => {
        const val = formatValue(row[col]);
        return val.slice(0, widths[i]).padEnd(widths[i]);
      })
      .join("  ");
    console.log(line);
  }

  if (rows.length > 1) {
    console.log(`\n${rows.length} results.`);
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
    console.error(`Error: ${message}`);
  }
}
