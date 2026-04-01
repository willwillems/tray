/**
 * Core unit tests: Search (FTS5 + fuzzy fallback).
 */

import { assertEquals, assert } from "jsr:@std/assert";
import { setupDb } from "../src/db.ts";
import { createPart } from "../src/parts.ts";
import { searchParts, listAllTags, getPartTags, setPartTags } from "../src/search.ts";

async function freshDb() {
  return await setupDb(":memory:");
}

Deno.test("searchParts - FTS5 matches name", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", description: "Timer IC" });
  await createPart(db, { name: "LM7805", description: "Voltage regulator" });

  const results = await searchParts(db, "NE555");
  assertEquals(results.length, 1);
  assertEquals(results[0].part.name, "NE555");

  await db.destroy();
});

Deno.test("searchParts - FTS5 matches description", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", description: "Timer IC" });
  await createPart(db, { name: "LM7805", description: "Voltage regulator" });

  const results = await searchParts(db, "timer");
  assertEquals(results.length, 1);
  assertEquals(results[0].part.name, "NE555");

  await db.destroy();
});

Deno.test("searchParts - FTS5 matches manufacturer", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", manufacturer: "Texas Instruments" });
  await createPart(db, { name: "ATmega328", manufacturer: "Microchip" });

  const results = await searchParts(db, "texas");
  assertEquals(results.length, 1);
  assertEquals(results[0].part.name, "NE555");

  await db.destroy();
});

Deno.test("searchParts - FTS5 matches mpn", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", mpn: "NE555P" });

  const results = await searchParts(db, "NE555P");
  assertEquals(results.length, 1);

  await db.destroy();
});

Deno.test("searchParts - FTS5 prefix matching", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555" });
  await createPart(db, { name: "NE556" });
  await createPart(db, { name: "LM7805" });

  // "NE55" should prefix-match NE555 and NE556
  const results = await searchParts(db, "NE55");
  assertEquals(results.length, 2);
  const names = results.map((r) => r.part.name).sort();
  assertEquals(names, ["NE555", "NE556"]);

  await db.destroy();
});

Deno.test("searchParts - fallback LIKE when FTS5 returns nothing", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555" });

  // A substring that FTS5 might not match directly
  const results = await searchParts(db, "555");
  assert(results.length >= 1);
  assertEquals(results[0].part.name, "NE555");

  await db.destroy();
});

Deno.test("searchParts - fallback searches tags", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", tags: ["timer", "dip"] });
  await createPart(db, { name: "LM7805" });

  // "timer" should match via tag (LIKE fallback)
  // Note: FTS5 doesn't include tags, so if FTS5 hits on other fields, it will
  // match there. If not, the fallback should catch it via part_tags.
  const results = await searchParts(db, "dip");
  // "dip" won't be in any FTS5-indexed field, so fallback should find it via tags
  assertEquals(results.length, 1);
  assertEquals(results[0].part.name, "NE555");

  await db.destroy();
});

Deno.test("setPartTags - replaces all tags", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555", tags: ["old"] });
  assertEquals(part.tags, ["old"]);

  await setPartTags(db, part.id, ["new1", "new2"]);
  const tags = await getPartTags(db, part.id);
  assertEquals(tags, ["new1", "new2"]);

  await db.destroy();
});

Deno.test("setPartTags - deduplicates and lowercases", async () => {
  const db = await freshDb();
  const part = await createPart(db, { name: "NE555" });

  await setPartTags(db, part.id, ["SMD", "smd", "Smd", "timer"]);
  const tags = await getPartTags(db, part.id);
  assertEquals(tags, ["smd", "timer"]);

  await db.destroy();
});

Deno.test("listAllTags - returns counts", async () => {
  const db = await freshDb();
  await createPart(db, { name: "NE555", tags: ["timer", "dip"] });
  await createPart(db, { name: "LM7805", tags: ["regulator", "dip"] });
  await createPart(db, { name: "10k", tags: ["smd"] });

  const tags = await listAllTags(db);
  assertEquals(tags.length, 4);

  const dip = tags.find((t) => t.tag === "dip");
  assertEquals(dip?.count, 2);

  const smd = tags.find((t) => t.tag === "smd");
  assertEquals(smd?.count, 1);

  await db.destroy();
});
