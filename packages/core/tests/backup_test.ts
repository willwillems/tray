/**
 * Core unit tests: Backup and Restore.
 *
 * Tests the full cycle: create data -> backup -> modify data -> restore -> verify original data.
 */

import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { existsSync } from "node:fs";
import { setupDb } from "../src/db.ts";
import { createPart, getPart, listParts } from "../src/parts.ts";
import { setPartTags, getPartTags } from "../src/search.ts";
import { addStock, getStockLots } from "../src/stock.ts";
import { createBackup, restoreBackup } from "../src/backup.ts";

function tempPath(name: string): string {
  return `${Deno.makeTempDirSync({ prefix: "tray-backup-test-" })}/${name}`;
}

Deno.test("createBackup - creates a valid SQLite backup file", async () => {
  const dbPath = tempPath("source.db");
  const backupPath = tempPath("backup.db");

  const db = await setupDb(dbPath);
  await createPart(db, { name: "NE555", stock: 25, manufacturer: "TI" });
  await createPart(db, { name: "LM7805", stock: 10 });

  const result = await createBackup(db, backupPath);

  assertEquals(result.path, backupPath);
  assertEquals(result.size_bytes > 0, true);
  assertExists(result.timestamp);
  assertEquals(existsSync(backupPath), true);

  // Verify backup is a valid, readable database
  const backupDb = await setupDb(backupPath);
  const parts = await listParts(backupDb);
  assertEquals(parts.length, 2);
  assertEquals(parts.find((p) => p.name === "NE555")!.stock, 25);

  await db.destroy();
  await backupDb.destroy();
  Deno.removeSync(dbPath);
  Deno.removeSync(backupPath);
});

Deno.test("createBackup - preserves FTS5 index", async () => {
  const dbPath = tempPath("fts-source.db");
  const backupPath = tempPath("fts-backup.db");

  const db = await setupDb(dbPath);
  await createPart(db, { name: "NE555", description: "Timer IC", keywords: "oscillator" });

  await createBackup(db, backupPath);

  // Open backup and verify FTS5 search works
  const backupDb = await setupDb(backupPath);
  // FTS5 tables are created by setupDb, but data should be there from VACUUM INTO
  // The content-sync FTS5 will rebuild from the parts table
  const { searchParts } = await import("../src/search.ts");
  const results = await searchParts(backupDb, "timer");
  assertEquals(results.length, 1);
  assertEquals(results[0].part.name, "NE555");

  await db.destroy();
  await backupDb.destroy();
  Deno.removeSync(dbPath);
  Deno.removeSync(backupPath);
});

Deno.test("createBackup - preserves tags (junction table)", async () => {
  const dbPath = tempPath("tags-source.db");
  const backupPath = tempPath("tags-backup.db");

  const db = await setupDb(dbPath);
  const part = await createPart(db, { name: "NE555", tags: ["timer", "dip", "ic"] });

  await createBackup(db, backupPath);

  const backupDb = await setupDb(backupPath);
  const tags = await getPartTags(backupDb, part.id);
  assertEquals(tags.sort(), ["dip", "ic", "timer"]);

  await db.destroy();
  await backupDb.destroy();
  Deno.removeSync(dbPath);
  Deno.removeSync(backupPath);
});

Deno.test("createBackup - preserves stock lots and triggers", async () => {
  const dbPath = tempPath("stock-source.db");
  const backupPath = tempPath("stock-backup.db");

  const db = await setupDb(dbPath);
  const part = await createPart(db, { name: "NE555" });
  await addStock(db, { part_id: part.id, quantity: 10, location: "Shelf 1" });
  await addStock(db, { part_id: part.id, quantity: 5, location: "Shelf 2" });

  await createBackup(db, backupPath);

  const backupDb = await setupDb(backupPath);
  const lots = await getStockLots(backupDb, part.id);
  assertEquals(lots.length, 2);

  // Verify Part.stock is correct (trigger-maintained)
  const backupPart = await getPart(backupDb, part.id);
  assertEquals(backupPart!.stock, 15);

  await db.destroy();
  await backupDb.destroy();
  Deno.removeSync(dbPath);
  Deno.removeSync(backupPath);
});

Deno.test("createBackup - rejects existing output file", async () => {
  const dbPath = tempPath("reject-source.db");
  const backupPath = tempPath("reject-backup.db");

  const db = await setupDb(dbPath);
  // Create the output file first
  Deno.writeTextFileSync(backupPath, "existing");

  await assertRejects(
    () => createBackup(db, backupPath),
    Error,
    "already exists",
  );

  await db.destroy();
  Deno.removeSync(dbPath);
  Deno.removeSync(backupPath);
});

Deno.test("restoreBackup - replaces database and saves pre-restore", async () => {
  const dbPath = tempPath("restore-target.db");
  const backupPath = tempPath("restore-backup.db");

  // Create original DB with some data
  const db = await setupDb(dbPath);
  await createPart(db, { name: "Original", stock: 1 });
  await createPart(db, { name: "Backup Part A", stock: 100 });
  await createPart(db, { name: "Backup Part B", stock: 200 });

  // Create a real backup via VACUUM INTO (clean, no WAL)
  await createBackup(db, backupPath);

  // Now delete the extra parts to simulate divergence
  const partA = await getPart(db, "Backup Part A");
  await db.deleteFrom("parts").where("id", "=", partA!.id).execute();
  const partB = await getPart(db, "Backup Part B");
  await db.deleteFrom("parts").where("id", "=", partB!.id).execute();
  await db.destroy();

  // At this point: dbPath has only "Original", backupPath has all 3

  // Restore
  const result = restoreBackup(dbPath, backupPath);
  assertEquals(result.restored_from, backupPath);
  assertEquals(result.previous_saved_as, `${dbPath}.pre-restore`);

  // Verify pre-restore file exists
  assertEquals(existsSync(`${dbPath}.pre-restore`), true);

  // Open restored DB and verify it has all three parts
  const restoredDb = await setupDb(dbPath);
  const parts = await listParts(restoredDb);
  assertEquals(parts.length, 3);
  assertEquals(parts.find((p) => p.name === "Backup Part A")!.stock, 100);
  assertEquals(parts.find((p) => p.name === "Backup Part B")!.stock, 200);

  await restoredDb.destroy();
  Deno.removeSync(dbPath);
  Deno.removeSync(`${dbPath}.pre-restore`);
  Deno.removeSync(backupPath);
});

Deno.test("restoreBackup - rejects nonexistent backup file", () => {
  try {
    restoreBackup("/tmp/tray-doesnt-exist.db", "/tmp/tray-no-backup.db");
    throw new Error("Should have thrown");
  } catch (e) {
    assertEquals((e as Error).message.includes("not found"), true);
  }
});

Deno.test("restoreBackup - rejects non-SQLite file", () => {
  const fakePath = tempPath("fake-backup.db");
  const dbPath = tempPath("target.db");
  Deno.writeTextFileSync(fakePath, "this is not a sqlite database");
  Deno.writeTextFileSync(dbPath, "placeholder");

  try {
    restoreBackup(dbPath, fakePath);
    throw new Error("Should have thrown");
  } catch (e) {
    assertEquals((e as Error).message.includes("not a valid SQLite"), true);
  }

  Deno.removeSync(fakePath);
  Deno.removeSync(dbPath);
});

Deno.test("full cycle: create -> backup -> modify -> restore -> verify", async () => {
  const dbPath = tempPath("cycle-db.db");
  const backupPath = tempPath("cycle-backup.db");

  // Step 1: Create database with initial data
  const db = await setupDb(dbPath);
  await createPart(db, { name: "NE555", stock: 25, tags: ["timer"], category: "ICs" });
  await createPart(db, { name: "LM7805", stock: 10 });

  // Step 2: Backup
  await createBackup(db, backupPath);

  // Step 3: Modify the original (simulate accidental changes)
  await createPart(db, { name: "OOPS", stock: 999 });
  // Delete NE555
  const ne555 = await getPart(db, "NE555");
  await db.deleteFrom("parts").where("id", "=", ne555!.id).execute();
  await db.destroy();

  // Step 4: Restore from backup
  restoreBackup(dbPath, backupPath);

  // Step 5: Verify original state is restored
  const restoredDb = await setupDb(dbPath);
  const parts = await listParts(restoredDb);
  assertEquals(parts.length, 2); // NE555 and LM7805 (OOPS is gone)

  const ne555Restored = await getPart(restoredDb, "NE555");
  assertExists(ne555Restored);
  assertEquals(ne555Restored!.stock, 25);
  assertEquals(ne555Restored!.tags, ["timer"]);
  assertEquals(ne555Restored!.category_path, "ICs");

  const oops = await getPart(restoredDb, "OOPS");
  assertEquals(oops, undefined); // Gone -- restore wiped it

  await restoredDb.destroy();
  Deno.removeSync(dbPath);
  Deno.removeSync(`${dbPath}.pre-restore`);
  Deno.removeSync(backupPath);
});
