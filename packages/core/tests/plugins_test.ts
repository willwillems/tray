/**
 * Core unit tests: Plugin system.
 *
 * Tests plugin loading, hook dispatch, error isolation, and custom commands.
 * Uses in-memory plugins (no config file) for test isolation.
 */

import { assertEquals, assertExists, assert } from "jsr:@std/assert";
import { setupDb } from "../src/db.ts";
import { createPart, getPart, updatePart, deletePart } from "../src/parts.ts";
import {
  PluginEngine,
  type PluginContext,
  type TrayPlugin,
} from "../src/plugins.ts";
import type { PartWithDetails } from "../src/parts.ts";
import type { Database, Part, BuildOrder } from "../src/schema.ts";
import type { Kysely } from "kysely";

async function freshDb() {
  return await setupDb(":memory:");
}

function createEngine(db: Kysely<Database>, plugins: TrayPlugin[]): { engine: PluginEngine; logs: string[] } {
  const logs: string[] = [];
  const ctx: PluginContext = {
    db,
    log: (msg: string) => logs.push(msg),
  };
  const engine = new PluginEngine(ctx);
  engine.register(plugins);
  return { engine, logs };
}

// --- Plugin Registration ---

Deno.test("PluginEngine - registers plugins and logs loading", () => {
  const db = {} as Kysely<Database>; // Not needed for registration test
  const { engine, logs } = createEngine(db, [
    { name: "alpha" },
    { name: "beta" },
  ]);

  assertEquals(engine.plugins.length, 2);
  assertEquals(engine.plugins[0].name, "alpha");
  assertEquals(logs.length, 2);
  assert(logs[0].includes("alpha"));
  assert(logs[1].includes("beta"));
});

Deno.test("PluginEngine - empty plugins list works", () => {
  const db = {} as Kysely<Database>;
  const { engine } = createEngine(db, []);
  assertEquals(engine.plugins.length, 0);
});

// --- Hook Dispatch ---

Deno.test("PluginEngine - firePartCreated calls all plugins", async () => {
  const db = await freshDb();
  const calls: string[] = [];

  const { engine } = createEngine(db, [
    {
      name: "a",
      onPartCreated: async (_ctx, part) => { calls.push(`a:${part.name}`); },
    },
    {
      name: "b",
      onPartCreated: async (_ctx, part) => { calls.push(`b:${part.name}`); },
    },
  ]);

  const part = await createPart(db, { name: "NE555" });
  await engine.firePartCreated(part);

  assertEquals(calls, ["a:NE555", "b:NE555"]);
  await db.destroy();
});

Deno.test("PluginEngine - firePartUpdated passes old and new", async () => {
  const db = await freshDb();
  // deno-lint-ignore no-explicit-any
  let captured: any = null;

  const { engine } = createEngine(db, [
    {
      name: "tracker",
      onPartUpdated: async (_ctx, part, old) => {
        captured = { oldName: old.name, newName: part.name };
      },
    },
  ]);

  const part = await createPart(db, { name: "NE555" });
  const oldPart: Part = { ...part }; // snapshot before update
  const updated = await updatePart(db, part.id, { name: "NE556" });
  await engine.firePartUpdated(updated, oldPart);

  assertExists(captured);
  assertEquals(captured!.oldName, "NE555");
  assertEquals(captured!.newName, "NE556");
  await db.destroy();
});

Deno.test("PluginEngine - firePartDeleted passes part ID", async () => {
  const db = await freshDb();
  let deletedId: number | null = null;

  const { engine } = createEngine(db, [
    {
      name: "tracker",
      onPartDeleted: async (_ctx, partId) => { deletedId = partId; },
    },
  ]);

  const part = await createPart(db, { name: "NE555" });
  await deletePart(db, part.id);
  await engine.firePartDeleted(part.id);

  assertEquals(deletedId, part.id);
  await db.destroy();
});

Deno.test("PluginEngine - fireStockChanged passes old and new stock", async () => {
  const db = await freshDb();
  // deno-lint-ignore no-explicit-any
  let captured: any = null;

  const { engine } = createEngine(db, [
    {
      name: "tracker",
      onStockChanged: async (_ctx, partId, oldStock, newStock) => {
        captured = { partId, old: oldStock, new_: newStock };
      },
    },
  ]);

  const part = await createPart(db, { name: "NE555", stock: 10 });
  await engine.fireStockChanged(part.id, 10, 25);

  assertExists(captured);
  assertEquals(captured!.old, 10);
  assertEquals(captured!.new_, 25);
  await db.destroy();
});

Deno.test("PluginEngine - fireStockChanged triggers onLowStock when appropriate", async () => {
  const db = await freshDb();
  let lowStockFired = false;

  const { engine } = createEngine(db, [
    {
      name: "alert",
      onLowStock: async (_ctx, part) => {
        lowStockFired = true;
      },
    },
  ]);

  // Create part with min_stock=10, current stock=15
  const part = await createPart(db, { name: "NE555", stock: 15, min_stock: 10 });

  // Stock decreases to 8 (below min_stock of 10) -> should fire onLowStock
  // First adjust stock in the DB so the check works
  await db.updateTable("stock_lots").set({ quantity: 8 }).where("part_id", "=", part.id).execute();
  await engine.fireStockChanged(part.id, 15, 8);

  assertEquals(lowStockFired, true);
  await db.destroy();
});

Deno.test("PluginEngine - fireStockChanged does NOT trigger onLowStock when stock increases", async () => {
  const db = await freshDb();
  let lowStockFired = false;

  const { engine } = createEngine(db, [
    {
      name: "alert",
      onLowStock: async () => { lowStockFired = true; },
    },
  ]);

  const part = await createPart(db, { name: "NE555", stock: 5, min_stock: 10 });
  // Stock increases from 5 to 20 -> should NOT fire (stock going up)
  await engine.fireStockChanged(part.id, 5, 20);

  assertEquals(lowStockFired, false);
  await db.destroy();
});

Deno.test("PluginEngine - fireBuildCompleted passes build order", async () => {
  const db = await freshDb();
  // deno-lint-ignore no-explicit-any
  let capturedBuild: any = null;

  const { engine } = createEngine(db, [
    {
      name: "tracker",
      onBuildCompleted: async (_ctx, build) => { capturedBuild = build; },
    },
  ]);

  const fakeBuild: BuildOrder = {
    id: 1, project_id: 1, quantity: 5, status: "complete",
    created_at: "2024-01-01", completed_at: "2024-01-02",
  };
  await engine.fireBuildCompleted(fakeBuild);

  assertExists(capturedBuild);
  assertEquals(capturedBuild!.quantity, 5);
  await db.destroy();
});

// --- Error Isolation ---

Deno.test("PluginEngine - plugin errors are caught and logged, don't crash", async () => {
  const db = await freshDb();

  const { engine, logs } = createEngine(db, [
    {
      name: "crasher",
      onPartCreated: async () => { throw new Error("plugin exploded!"); },
    },
    {
      name: "survivor",
      onPartCreated: async (_ctx, part) => {
        // This should still run even though "crasher" threw
        logs.push(`survivor saw: ${part.name}`);
      },
    },
  ]);

  const part = await createPart(db, { name: "NE555" });
  // Should NOT throw
  await engine.firePartCreated(part);

  // Crasher's error should be logged
  const errorLog = logs.find((l) => l.includes("plugin exploded!"));
  assertExists(errorLog, "Crasher error should be logged");

  // Survivor should have run
  const survivorLog = logs.find((l) => l.includes("survivor saw: NE555"));
  assertExists(survivorLog, "Survivor should still execute after crasher fails");

  await db.destroy();
});

Deno.test("PluginEngine - multiple hook errors don't stop other plugins", async () => {
  const db = await freshDb();
  const calls: string[] = [];

  const { engine, logs } = createEngine(db, [
    {
      name: "bad1",
      onPartCreated: async () => { throw new Error("bad1"); },
    },
    {
      name: "bad2",
      onPartCreated: async () => { throw new Error("bad2"); },
    },
    {
      name: "good",
      onPartCreated: async () => { calls.push("good"); },
    },
  ]);

  const part = await createPart(db, { name: "NE555" });
  await engine.firePartCreated(part);

  assertEquals(calls, ["good"]);
  const errorLogs = logs.filter((l) => l.includes("Error"));
  assertEquals(errorLogs.length, 2);

  await db.destroy();
});

// --- Custom Commands ---

Deno.test("PluginEngine - getCommands collects from all plugins", () => {
  const db = {} as Kysely<Database>;
  const { engine } = createEngine(db, [
    {
      name: "digikey",
      commands: {
        "digikey-search": async () => {},
        "digikey-fetch": async () => {},
      },
    },
    {
      name: "mouser",
      commands: {
        "mouser-search": async () => {},
      },
    },
  ]);

  const commands = engine.getCommands();
  assertEquals(commands.size, 3);
  assertEquals(commands.get("digikey-search")!.plugin, "digikey");
  assertEquals(commands.get("mouser-search")!.plugin, "mouser");
});

Deno.test("PluginEngine - command name collision logs warning", () => {
  const db = {} as Kysely<Database>;
  const { engine, logs } = createEngine(db, [
    {
      name: "plugin-a",
      commands: { "search": async () => {} },
    },
    {
      name: "plugin-b",
      commands: { "search": async () => {} },
    },
  ]);

  engine.getCommands();
  const warning = logs.find((l) => l.includes("overrides"));
  assertExists(warning, "Should warn about command name collision");
});

Deno.test("PluginEngine - custom command receives context and args", async () => {
  const db = await freshDb();
  let capturedArgs: string[] = [];

  const { engine } = createEngine(db, [
    {
      name: "test-plugin",
      commands: {
        "test-cmd": async (ctx, args) => {
          capturedArgs = args;
          // Verify context has db access
          const parts = await ctx.db.selectFrom("parts").selectAll().execute();
          ctx.log(`found ${parts.length} parts`);
        },
      },
    },
  ]);

  const commands = engine.getCommands();
  const cmd = commands.get("test-cmd")!;
  await cmd.handler({ db, log: () => {} }, ["arg1", "arg2"]);

  assertEquals(capturedArgs, ["arg1", "arg2"]);
  await db.destroy();
});

// --- Plugins with no hooks (just commands, or empty) ---

Deno.test("PluginEngine - plugins without hooks are fine", async () => {
  const db = await freshDb();

  const { engine } = createEngine(db, [
    { name: "commands-only", commands: { "hello": async (ctx) => ctx.log("hi") } },
    { name: "empty-plugin" },
  ]);

  const part = await createPart(db, { name: "NE555" });
  // Should not throw even though plugins have no hooks
  await engine.firePartCreated(part);
  await engine.firePartDeleted(1);
  await engine.fireStockChanged(1, 0, 10);

  await db.destroy();
});

// --- Plugin as a factory function (Vite-style) ---

Deno.test("Plugin factory pattern works (Vite-style)", async () => {
  const db = await freshDb();
  const events: string[] = [];

  // Plugin is a function that returns a TrayPlugin
  function loggerPlugin(prefix: string): TrayPlugin {
    return {
      name: "logger",
      onPartCreated: async (_ctx, part) => {
        events.push(`${prefix}: created ${part.name}`);
      },
      onStockChanged: async (_ctx, partId, oldStock, newStock) => {
        events.push(`${prefix}: stock ${oldStock} -> ${newStock}`);
      },
    };
  }

  const { engine } = createEngine(db, [loggerPlugin("[LOG]")]);

  const part = await createPart(db, { name: "NE555", stock: 10 });
  await engine.firePartCreated(part);
  await engine.fireStockChanged(part.id, 0, 10);

  assertEquals(events, ["[LOG]: created NE555", "[LOG]: stock 0 -> 10"]);
  await db.destroy();
});
