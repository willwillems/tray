/**
 * SI prefix parsing for part parameters.
 *
 * Parses values like "10k", "4.7uF", "50V" into numeric values
 * and normalized units for range queries.
 *
 * p=10^-12, n=10^-9, u/µ=10^-6, m=10^-3, k=10^3, M=10^6, G=10^9
 */

const SI_PREFIXES: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  "\u00b5": 1e-6, // µ
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
};

// Common unit aliases -> normalized unit
const UNIT_ALIASES: Record<string, string> = {
  ohm: "ohm",
  ohms: "ohm",
  "\u03a9": "ohm", // Ω
  r: "ohm",
  f: "farad",
  farad: "farad",
  farads: "farad",
  h: "henry",
  henry: "henry",
  henrys: "henry",
  v: "volt",
  volt: "volt",
  volts: "volt",
  a: "ampere",
  amp: "ampere",
  amps: "ampere",
  ampere: "ampere",
  w: "watt",
  watt: "watt",
  watts: "watt",
  hz: "hertz",
  hertz: "hertz",
};

export interface ParsedParameter {
  numeric: number | null;
  unit: string | null;
}

/**
 * Parse a parameter value string into a numeric value and unit.
 *
 * Examples:
 *   "10k"      -> { numeric: 10000, unit: "ohm" } (if unit hint is "ohm")
 *   "4.7uF"    -> { numeric: 0.0000047, unit: "farad" }
 *   "50V"      -> { numeric: 50, unit: "volt" }
 *   "100"      -> { numeric: 100, unit: null }
 *   "NE555"    -> { numeric: null, unit: null }
 */
export function parseParameterValue(
  value: string,
  unitHint?: string,
): ParsedParameter {
  const trimmed = value.trim();
  if (!trimmed) return { numeric: null, unit: null };

  // Try to parse with regex:
  // Matches: optional sign, digits, optional decimal, optional SI prefix, optional unit
  const match = trimmed.match(
    /^([+-]?\d+\.?\d*)\s*([pnuµmkKMG]?)\s*([a-zA-ZΩ]*)$/,
  );

  if (!match) {
    // Not a numeric value
    return { numeric: null, unit: unitHint ? normalizeUnit(unitHint) : null };
  }

  const [, numStr, prefix, unitStr] = match;
  let numeric = parseFloat(numStr);

  // Apply SI prefix
  if (prefix && SI_PREFIXES[prefix] !== undefined) {
    numeric *= SI_PREFIXES[prefix];
  }

  // Determine unit
  let unit: string | null = null;
  if (unitStr) {
    unit = normalizeUnit(unitStr);
  } else if (unitHint) {
    unit = normalizeUnit(unitHint);
  }

  return { numeric, unit };
}

/**
 * Normalize a unit string to a canonical form.
 */
function normalizeUnit(unit: string): string | null {
  const lower = unit.toLowerCase().trim();
  return UNIT_ALIASES[lower] ?? (lower || null);
}

/**
 * Parse a parametric filter expression like "resistance>=10k".
 * Returns { key, operator, value, numeric }.
 */
export function parseParametricFilter(
  expr: string,
): { key: string; operator: string; value: string; numeric: number | null } | null {
  const match = expr.match(/^(\w+)\s*(>=|<=|!=|=|>|<)\s*(.+)$/);
  if (!match) return null;

  const [, key, operator, value] = match;
  const parsed = parseParameterValue(value);

  return {
    key,
    operator,
    value,
    numeric: parsed.numeric,
  };
}
