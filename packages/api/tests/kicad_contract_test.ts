/**
 * KiCad HTTP Library Contract Tests.
 *
 * These tests validate that our KiCad API endpoints return responses
 * in the exact shape KiCad expects. The contract is defined by:
 * https://dev-docs.kicad.org/en/apis-and-binding/http-libraries/
 *
 * Three layers:
 * 1. Contract schema validation -- Zod schemas matching KiCad's exact expectations
 * 2. Mock KiCad client -- simulates KiCad's fetch sequence end-to-end
 * 3. Edge cases -- empty categories, missing fields, special characters
 */

import { assertEquals, assert, assertExists } from "jsr:@std/assert";
import { z } from "zod";
import { setupDb, createPart, createCategory } from "@tray/core";
import { createApp } from "@tray/api";

// ---------------------------------------------------------------------------
// Contract Schemas (what KiCad expects -- all values MUST be strings)
// ---------------------------------------------------------------------------

/** Root endpoint must return exactly these two keys */
const kicadRootSchema = z.object({
  categories: z.string(),
  parts: z.string(),
});

/** Category: id and name must be strings, description optional string */
const kicadCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});

/** Part summary in category listing */
const kicadPartSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});

/** Field value: must have string value, optional visible string */
const kicadFieldSchema = z.object({
  value: z.string(),
  visible: z.string().optional(),
});

/** Full part detail */
const kicadPartDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  symbolIdStr: z.string(),
  exclude_from_bom: z.string(),
  exclude_from_board: z.string(),
  exclude_from_sim: z.string(),
  fields: z.record(z.string(), kicadFieldSchema),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function freshApp() {
  const db = await setupDb(":memory:");
  const dir = Deno.makeTempDirSync({ prefix: "tray-kicad-test-" });
  const app = createApp(db, dir);
  return { app, db, dir };
}

async function get(app: ReturnType<typeof createApp>, path: string) {
  return await app.fetch(new Request(`http://localhost${path}`));
}

async function post(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return await app.fetch(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

/**
 * Seed a test database with realistic data for KiCad testing.
 */
async function seedTestData(app: ReturnType<typeof createApp>) {
  // Categories
  await post(app, "/api/parts", {
    name: "NE555",
    description: "Timer IC - CMOS single timer",
    category: "ICs/Timers",
    manufacturer: "Texas Instruments",
    mpn: "NE555P",
    ipn: "IC-001",
    footprint: "DIP-8",
    keywords: "timer oscillator monostable",
    stock: 25,
    kicad_symbol_id: "Timer:NE555",
    kicad_footprint: "Package_DIP:DIP-8_W7.62mm",
    datasheet_url: "https://www.ti.com/lit/ds/symlink/ne555.pdf",
    parameters: [
      { key: "voltage_max", value: "16V" },
      { key: "frequency_max", value: "500kHz" },
    ],
  });

  await post(app, "/api/parts", {
    name: "LM7805",
    description: "5V Linear Voltage Regulator",
    category: "ICs/Regulators",
    manufacturer: "Texas Instruments",
    mpn: "LM7805CT",
    footprint: "TO-220",
    stock: 10,
    kicad_symbol_id: "Regulator_Linear:L7805",
    kicad_footprint: "Package_TO_SOT_THT:TO-220-3_Vertical",
  });

  await post(app, "/api/parts", {
    name: "10k 0805",
    description: "10k Ohm Resistor 0805 1%",
    category: "Passives/Resistors",
    stock: 100,
    kicad_symbol_id: "Device:R",
    kicad_footprint: "Resistor_SMD:R_0805_2012Metric",
    parameters: [
      { key: "resistance", value: "10k", unit: "ohm" },
      { key: "tolerance", value: "1%" },
    ],
  });
}

// ---------------------------------------------------------------------------
// Layer 1: Contract Schema Validation
// ---------------------------------------------------------------------------

Deno.test("KiCad contract: root endpoint returns valid schema", async () => {
  const { app, db, dir } = await freshApp();

  const res = await get(app, "/kicad/v1/");
  assertEquals(res.status, 200);

  const body = await res.json();
  const result = kicadRootSchema.safeParse(body);
  assertEquals(result.success, true, `Root schema validation failed: ${JSON.stringify(body)}`);

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

Deno.test("KiCad contract: categories endpoint returns valid schema", async () => {
  const { app, db, dir } = await freshApp();
  await seedTestData(app);

  const res = await get(app, "/kicad/v1/categories.json");
  assertEquals(res.status, 200);

  const body = await res.json();
  assert(Array.isArray(body), "Categories must be an array");
  assert(body.length > 0, "Should have categories from seeded data");

  for (const cat of body) {
    const result = kicadCategorySchema.safeParse(cat);
    assertEquals(result.success, true, `Category schema failed for: ${JSON.stringify(cat)}`);

    // All values must be strings (critical KiCad requirement)
    assertEquals(typeof cat.id, "string", `Category id must be string, got ${typeof cat.id}`);
    assertEquals(typeof cat.name, "string", `Category name must be string, got ${typeof cat.name}`);
    assertEquals(typeof cat.description, "string", `Category description must be string, got ${typeof cat.description}`);
  }

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

Deno.test("KiCad contract: parts list returns valid schema", async () => {
  const { app, db, dir } = await freshApp();
  await seedTestData(app);

  // Get categories first
  const catRes = await get(app, "/kicad/v1/categories.json");
  const categories = await catRes.json();
  const timersCat = categories.find((c: { name: string }) => c.name.includes("Timers"));
  assertExists(timersCat, "Should have a Timers category");

  const res = await get(app, `/kicad/v1/parts/category/${timersCat.id}.json`);
  assertEquals(res.status, 200);

  const body = await res.json();
  assert(Array.isArray(body), "Parts must be an array");
  assert(body.length > 0, "Timers category should have parts");

  for (const part of body) {
    const result = kicadPartSummarySchema.safeParse(part);
    assertEquals(result.success, true, `Part summary schema failed for: ${JSON.stringify(part)}`);

    assertEquals(typeof part.id, "string", `Part id must be string, got ${typeof part.id}`);
    assertEquals(typeof part.name, "string", `Part name must be string, got ${typeof part.name}`);
  }

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

Deno.test("KiCad contract: part detail returns valid schema with all string values", async () => {
  const { app, db, dir } = await freshApp();
  await seedTestData(app);

  // Get the NE555 part ID
  const catRes = await get(app, "/kicad/v1/categories.json");
  const categories = await catRes.json();
  const timersCat = categories.find((c: { name: string }) => c.name.includes("Timers"));
  const partsRes = await get(app, `/kicad/v1/parts/category/${timersCat.id}.json`);
  const parts = await partsRes.json();
  const ne555 = parts.find((p: { name: string }) => p.name === "NE555");
  assertExists(ne555, "Should find NE555 in Timers category");

  const res = await get(app, `/kicad/v1/parts/${ne555.id}.json`);
  assertEquals(res.status, 200);

  const body = await res.json();
  const result = kicadPartDetailSchema.safeParse(body);
  assertEquals(result.success, true, `Part detail schema failed: ${JSON.stringify(result)}`);

  // Verify ALL values are strings (the #1 KiCad requirement)
  assertEquals(typeof body.id, "string");
  assertEquals(typeof body.name, "string");
  assertEquals(typeof body.symbolIdStr, "string");
  assertEquals(typeof body.exclude_from_bom, "string");
  assertEquals(typeof body.exclude_from_board, "string");
  assertEquals(typeof body.exclude_from_sim, "string");

  // Verify fields dict
  assert(typeof body.fields === "object", "fields must be an object");
  for (const [key, field] of Object.entries(body.fields)) {
    assertEquals(typeof key, "string", `Field key must be string`);
    const f = field as { value: string; visible?: string };
    assertEquals(typeof f.value, "string", `Field '${key}' value must be string, got ${typeof f.value}`);
    if (f.visible !== undefined) {
      assertEquals(typeof f.visible, "string", `Field '${key}' visible must be string`);
    }
  }

  // Verify specific expected fields
  assertExists(body.fields.reference, "Must have reference field");
  assertExists(body.fields.value, "Must have value field");
  assertExists(body.fields.footprint, "Must have footprint field");
  assertExists(body.fields.datasheet, "Must have datasheet field");
  assertExists(body.fields.description, "Must have description field");

  // Verify content
  assertEquals(body.name, "NE555");
  assertEquals(body.symbolIdStr, "Timer:NE555");
  assertEquals(body.fields.footprint.value, "Package_DIP:DIP-8_W7.62mm");
  assertEquals(body.fields.manufacturer.value, "Texas Instruments");
  assertEquals(body.fields.mpn.value, "NE555P");

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

// ---------------------------------------------------------------------------
// Layer 2: Mock KiCad Client Simulation
// ---------------------------------------------------------------------------

Deno.test("KiCad mock client: full fetch sequence (validates root -> categories -> parts -> detail)", async () => {
  const { app, db, dir } = await freshApp();
  await seedTestData(app);

  // Step 1: KiCad validates the root endpoint
  const rootRes = await get(app, "/kicad/v1/");
  assertEquals(rootRes.status, 200);
  const root = await rootRes.json();
  assert("categories" in root, "Root must have 'categories' key");
  assert("parts" in root, "Root must have 'parts' key");

  // Step 2: KiCad fetches all categories
  const catRes = await get(app, "/kicad/v1/categories.json");
  assertEquals(catRes.status, 200);
  const categories = await catRes.json();
  assert(Array.isArray(categories), "Categories must be array");
  assert(categories.length > 0, "Must have categories");

  // Step 3: For each category, KiCad fetches the parts list
  const allPartSummaries: { id: string; name: string; categoryName: string }[] = [];
  for (const cat of categories) {
    const partsRes = await get(app, `/kicad/v1/parts/category/${cat.id}.json`);
    assertEquals(partsRes.status, 200);
    const parts = await partsRes.json();
    assert(Array.isArray(parts), `Parts for category ${cat.id} must be array`);

    for (const part of parts) {
      allPartSummaries.push({ ...part, categoryName: cat.name });
    }
  }

  assert(allPartSummaries.length >= 3, `Should have at least 3 parts, got ${allPartSummaries.length}`);

  // Step 4: KiCad fetches detail for each part when user clicks on it
  for (const summary of allPartSummaries) {
    const detailRes = await get(app, `/kicad/v1/parts/${summary.id}.json`);
    assertEquals(detailRes.status, 200, `Detail for part ${summary.id} (${summary.name}) should return 200`);

    const detail = await detailRes.json();

    // Validate against contract schema
    const result = kicadPartDetailSchema.safeParse(detail);
    assert(result.success, `Part detail schema failed for ${summary.name}: ${JSON.stringify(detail)}`);

    // Verify name matches
    assertEquals(detail.name, summary.name);
    assertEquals(detail.id, summary.id);

    // Verify symbolIdStr is present (can be empty string)
    assertEquals(typeof detail.symbolIdStr, "string");

    // Verify all field values are strings (the critical test)
    for (const [key, field] of Object.entries(detail.fields)) {
      const f = field as { value: string };
      assertEquals(typeof f.value, "string",
        `Part '${summary.name}', field '${key}': value must be string, got ${typeof f.value}: ${f.value}`
      );
    }
  }

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

// ---------------------------------------------------------------------------
// Layer 3: Edge Cases
// ---------------------------------------------------------------------------

Deno.test("KiCad edge case: empty category returns empty array", async () => {
  const { app, db, dir } = await freshApp();

  // Create an empty category
  await post(app, "/api/categories", { name: "Empty Category" });

  const catRes = await get(app, "/kicad/v1/categories.json");
  const categories = await catRes.json();
  const emptyCategory = categories.find((c: { name: string }) => c.name === "Empty Category");
  assertExists(emptyCategory);

  const partsRes = await get(app, `/kicad/v1/parts/category/${emptyCategory.id}.json`);
  assertEquals(partsRes.status, 200);
  const parts = await partsRes.json();
  assertEquals(parts.length, 0);
  assert(Array.isArray(parts), "Empty category must return array, not null");

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

Deno.test("KiCad edge case: part with no footprint/datasheet returns empty strings", async () => {
  const { app, db, dir } = await freshApp();

  await post(app, "/api/parts", {
    name: "Bare Part",
    category: "Misc",
    // No footprint, no datasheet, no kicad fields
  });

  const catRes = await get(app, "/kicad/v1/categories.json");
  const categories = await catRes.json();
  const misc = categories.find((c: { name: string }) => c.name === "Misc");
  assertExists(misc);

  const partsRes = await get(app, `/kicad/v1/parts/category/${misc.id}.json`);
  const parts = await partsRes.json();
  const barePart = parts[0];

  const detailRes = await get(app, `/kicad/v1/parts/${barePart.id}.json`);
  const detail = await detailRes.json();

  // Fields must exist with empty strings, not be missing or null
  assertEquals(detail.fields.footprint.value, "");
  assertEquals(detail.fields.datasheet.value, "");
  assertEquals(detail.symbolIdStr, "");

  // Still validates against schema
  const result = kicadPartDetailSchema.safeParse(detail);
  assert(result.success, "Bare part must still validate against schema");

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

Deno.test("KiCad edge case: nonexistent part returns 404", async () => {
  const { app, db, dir } = await freshApp();

  const res = await get(app, "/kicad/v1/parts/99999.json");
  assertEquals(res.status, 404);

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

Deno.test("KiCad edge case: nonexistent category returns empty array", async () => {
  const { app, db, dir } = await freshApp();

  const res = await get(app, "/kicad/v1/parts/category/99999.json");
  assertEquals(res.status, 200);
  const parts = await res.json();
  assertEquals(parts.length, 0);

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

Deno.test("KiCad edge case: part parameters appear as custom fields", async () => {
  const { app, db, dir } = await freshApp();

  await post(app, "/api/parts", {
    name: "R_10k",
    category: "Passives",
    parameters: [
      { key: "resistance", value: "10k", unit: "ohm" },
      { key: "tolerance", value: "1%" },
      { key: "power_rating", value: "0.125W" },
    ],
  });

  const catRes = await get(app, "/kicad/v1/categories.json");
  const categories = await catRes.json();
  const passives = categories.find((c: { name: string }) => c.name === "Passives");
  const partsRes = await get(app, `/kicad/v1/parts/category/${passives.id}.json`);
  const parts = await partsRes.json();

  const detailRes = await get(app, `/kicad/v1/parts/${parts[0].id}.json`);
  const detail = await detailRes.json();

  // Custom parameters should appear as fields
  assertExists(detail.fields.resistance, "resistance parameter should be a field");
  assertEquals(detail.fields.resistance.value, "10k");
  assertExists(detail.fields.tolerance, "tolerance parameter should be a field");
  assertEquals(detail.fields.tolerance.value, "1%");
  assertExists(detail.fields.power_rating, "power_rating parameter should be a field");
  assertEquals(detail.fields.power_rating.value, "0.125W");

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

Deno.test("KiCad edge case: stock field is a string not a number", async () => {
  const { app, db, dir } = await freshApp();

  await post(app, "/api/parts", { name: "Test", category: "Misc", stock: 42 });

  const catRes = await get(app, "/kicad/v1/categories.json");
  const categories = await catRes.json();
  const misc = categories.find((c: { name: string }) => c.name === "Misc");
  const partsRes = await get(app, `/kicad/v1/parts/category/${misc.id}.json`);
  const parts = await partsRes.json();

  const detailRes = await get(app, `/kicad/v1/parts/${parts[0].id}.json`);
  const detail = await detailRes.json();

  assertEquals(typeof detail.fields.stock.value, "string", "Stock must be a string");
  assertEquals(detail.fields.stock.value, "42");

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});

Deno.test("KiCad edge case: categories include full path names", async () => {
  const { app, db, dir } = await freshApp();
  await seedTestData(app);

  const catRes = await get(app, "/kicad/v1/categories.json");
  const categories = await catRes.json();

  // Should have hierarchical names like "ICs/Timers"
  const timersCat = categories.find((c: { name: string }) => c.name === "ICs/Timers");
  assertExists(timersCat, "Should have 'ICs/Timers' as category name (full path)");

  const regulatorsCat = categories.find((c: { name: string }) => c.name === "ICs/Regulators");
  assertExists(regulatorsCat, "Should have 'ICs/Regulators' as category name");

  Deno.removeSync(dir, { recursive: true });
  await db.destroy();
});
