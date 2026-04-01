/**
 * Core unit tests: Import/Export (CSV, JSON, KiCad BOM).
 */

import { assertEquals, assert, assertExists } from "jsr:@std/assert";
import { setupDb } from "../src/db.ts";
import { createPart, getPart, listParts } from "../src/parts.ts";
import { createProject } from "../src/projects.ts";
import { getBomLines } from "../src/projects.ts";
import {
  exportParts,
  importPartsFromCsv,
  importPartsFromJson,
  importKicadBom,
} from "../src/import_export.ts";

async function freshDb() {
  return await setupDb(":memory:");
}

// --- Export CSV ---

Deno.test("exportParts CSV - exports all parts", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", description: "Timer IC", manufacturer: "TI", stock: 25 });
  await createPart(db, { name: "LM7805", description: "Regulator", stock: 10 });

  const csv = await exportParts(db, { format: "csv" });
  const lines = csv.trim().split("\n");

  assertEquals(lines.length, 3); // header + 2 parts
  assert(lines[0].includes("name"), "Header should include 'name'");
  assert(lines[0].includes("stock"), "Header should include 'stock'");

  // Find the NE555 line
  const ne555Line = lines.find((l) => l.includes("NE555"));
  assertExists(ne555Line);
  assert(ne555Line.includes("Timer IC"));
  assert(ne555Line.includes("TI"));

  await db.destroy();
});

Deno.test("exportParts CSV - handles commas and quotes in values", async () => {
  const db = await freshDb();
  await createPart(db, { name: 'Part "A"', description: "Has, commas" });

  const csv = await exportParts(db, { format: "csv" });
  // Values with commas/quotes should be properly escaped
  assert(csv.includes('"'), "Should have quoted fields");

  await db.destroy();
});

Deno.test("exportParts CSV - custom columns", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", manufacturer: "TI" });

  const csv = await exportParts(db, { format: "csv", columns: ["name", "manufacturer"] });
  const lines = csv.trim().split("\n");
  assertEquals(lines[0], "name,manufacturer");
  assert(lines[1].includes("NE555"));

  await db.destroy();
});

Deno.test("exportParts CSV - filters by category", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", category: "ICs/Timers" });
  await createPart(db, { name: "10k", category: "Passives/Resistors" });

  const csv = await exportParts(db, { format: "csv", category: "ICs" });
  const lines = csv.trim().split("\n");
  assertEquals(lines.length, 2); // header + 1 IC
  assert(lines[1].includes("NE555"));

  await db.destroy();
});

// --- Export JSON ---

Deno.test("exportParts JSON - exports valid JSON array", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", stock: 25, tags: ["timer", "dip"] });

  const json = await exportParts(db, { format: "json" });
  const parsed = JSON.parse(json);
  assert(Array.isArray(parsed));
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].name, "NE555");
  assertEquals(parsed[0].stock, 25);
  assertEquals(parsed[0].tags, ["dip", "timer"]); // sorted

  await db.destroy();
});

// --- Import CSV ---

Deno.test("importPartsFromCsv - creates parts from CSV", async () => {
  const db = await freshDb();

  const csv = `name,description,manufacturer,stock,category
NE555,Timer IC,Texas Instruments,25,ICs/Timers
LM7805,Voltage Regulator,TI,10,ICs/Regulators
10k Resistor,10k 0805,,100,Passives/Resistors`;

  const result = await importPartsFromCsv(db, csv);
  assertEquals(result.created, 3);
  assertEquals(result.errors.length, 0);

  const parts = await listParts(db);
  assertEquals(parts.length, 3);

  const ne555 = await getPart(db, "NE555");
  assertExists(ne555);
  assertEquals(ne555!.manufacturer, "Texas Instruments");
  assertEquals(ne555!.stock, 25);
  assertEquals(ne555!.category_path, "ICs/Timers");

  await db.destroy();
});

Deno.test("importPartsFromCsv - skips existing parts", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", stock: 5 });

  const csv = `name,stock
NE555,100
LM7805,10`;

  const result = await importPartsFromCsv(db, csv);
  assertEquals(result.created, 1); // only LM7805
  assertEquals(result.skipped, 1); // NE555 skipped

  // NE555 stock should be unchanged
  const ne555 = await getPart(db, "NE555");
  assertEquals(ne555!.stock, 5);

  await db.destroy();
});

Deno.test("importPartsFromCsv - handles missing name gracefully", async () => {
  const db = await freshDb();

  const csv = `description,stock
Timer IC,25`;

  const result = await importPartsFromCsv(db, csv);
  assertEquals(result.created, 0);
  assertEquals(result.errors.length, 1);
  assert(result.errors[0].message.includes("Missing name"));

  await db.destroy();
});

Deno.test("importPartsFromCsv - handles quoted fields with commas", async () => {
  const db = await freshDb();

  const csv = `name,description
"Part, with comma","Description with ""quotes"""`;

  const result = await importPartsFromCsv(db, csv);
  assertEquals(result.created, 1);

  const part = await getPart(db, "Part, with comma");
  assertExists(part);
  assertEquals(part!.description, 'Description with "quotes"');

  await db.destroy();
});

Deno.test("importPartsFromCsv - imports tags from comma-separated field", async () => {
  const db = await freshDb();

  const csv = `name,tags
NE555,"timer,dip,ic"`;

  const result = await importPartsFromCsv(db, csv);
  assertEquals(result.created, 1);

  const part = await getPart(db, "NE555");
  assertExists(part);
  assertEquals(part!.tags.sort(), ["dip", "ic", "timer"]);

  await db.destroy();
});

// --- Import JSON ---

Deno.test("importPartsFromJson - creates parts from JSON array", async () => {
  const db = await freshDb();

  const json = JSON.stringify([
    { name: "NE555", description: "Timer", manufacturer: "TI", stock: 25, tags: ["timer"] },
    { name: "LM7805", description: "Regulator", stock: 10 },
  ]);

  const result = await importPartsFromJson(db, json);
  assertEquals(result.created, 2);
  assertEquals(result.errors.length, 0);

  const ne555 = await getPart(db, "NE555");
  assertExists(ne555);
  assertEquals(ne555!.tags, ["timer"]);

  await db.destroy();
});

Deno.test("importPartsFromJson - skips existing parts", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555" });

  const json = JSON.stringify([{ name: "NE555" }, { name: "LM7805" }]);
  const result = await importPartsFromJson(db, json);
  assertEquals(result.created, 1);
  assertEquals(result.skipped, 1);

  await db.destroy();
});

// --- KiCad BOM Import ---

Deno.test("importKicadBom - matches parts by value", async () => {
  const db = await freshDb();
  const ne555 = await createPart(db, { name: "NE555", stock: 20 });
  const r10k = await createPart(db, { name: "10k", stock: 100 });
  const project = await createProject(db, { name: "Test Project" });

  const bom = `Reference,Value,Footprint,Qty
"U1",NE555,Package_DIP:DIP-8_W7.62mm,1
"R1,R2,R3,R4",10k,Resistor_SMD:R_0805_2012Metric,4
"C1",100nF,Capacitor_SMD:C_0805_2012Metric,1`;

  const result = await importKicadBom(db, project.id, bom);
  assertEquals(result.matched, 2); // NE555 and 10k matched
  assertEquals(result.unmatched.length, 1); // 100nF not in database
  assertEquals(result.unmatched[0].value, "100nF");
  assertEquals(result.unmatched[0].reference, "C1");

  // Verify BOM lines created
  const lines = await getBomLines(db, project.id);
  assertEquals(lines.length, 2);

  const ne555Line = lines.find((l) => l.part_id === ne555.id);
  assertExists(ne555Line);
  assertEquals(ne555Line!.quantity_required, 1);
  assertEquals(ne555Line!.reference_designators, "U1");

  const r10kLine = lines.find((l) => l.part_id === r10k.id);
  assertExists(r10kLine);
  assertEquals(r10kLine!.quantity_required, 4);
  assertEquals(r10kLine!.reference_designators, "R1,R2,R3,R4");

  await db.destroy();
});

Deno.test("importKicadBom - handles empty BOM", async () => {
  const db = await freshDb();
  const project = await createProject(db, { name: "Empty" });

  const result = await importKicadBom(db, project.id, "Reference,Value\n");
  assertEquals(result.matched, 0);
  assertEquals(result.unmatched.length, 0);

  await db.destroy();
});

// --- Round-trip test ---

Deno.test("round-trip: export JSON -> import JSON preserves data", async () => {
  const db = await freshDb();
  await createPart(db, {
    name: "NE555",
    description: "Timer IC",
    manufacturer: "TI",
    mpn: "NE555P",
    category: "ICs/Timers",
    stock: 25,
    tags: ["timer", "dip"],
  });

  // Export
  const json = await exportParts(db, { format: "json" });

  // Fresh DB for import
  const db2 = await setupDb(":memory:");
  const result = await importPartsFromJson(db2, json);
  assertEquals(result.created, 1);

  // Verify round-trip fidelity
  const imported = await getPart(db2, "NE555");
  assertExists(imported);
  assertEquals(imported!.name, "NE555");
  assertEquals(imported!.description, "Timer IC");
  assertEquals(imported!.manufacturer, "TI");
  assertEquals(imported!.mpn, "NE555P");
  assertEquals(imported!.stock, 25);
  assertEquals(imported!.category_path, "ICs/Timers");
  assertEquals(imported!.tags.sort(), ["dip", "timer"]);

  await db.destroy();
  await db2.destroy();
});
