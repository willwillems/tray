/**
 * Core unit tests: Projects, BOMs, Build Orders, Purchase Orders.
 *
 * This tests the full business workflow:
 *   Create project -> Add BOM -> Check availability -> Build -> Verify stock deducted
 *   Create PO -> Add lines -> Receive -> Verify stock added
 */

import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { setupDb } from "../src/db.ts";
import { createPart, getPart } from "../src/parts.ts";
import { createSupplier, createSupplierPart } from "../src/suppliers.ts";
import {
  addBomLine,
  checkBomAvailability,
  completeBuildOrder,
  createBuildOrder,
  createProject,
  deleteProject,
  getBomLines,
  getProject,
  listBuildOrders,
  listProjects,
  removeBomLine,
  updateProject,
} from "../src/projects.ts";
import {
  addPoLine,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  receivePOLine,
} from "../src/purchase_orders.ts";

async function freshDb() {
  return await setupDb(":memory:");
}

// --- Projects ---

Deno.test("createProject - basic", async () => {
  const db = await freshDb();
  const p = await createProject(db, { name: "Synth Module", description: "VCO module" });
  assertEquals(p.name, "Synth Module");
  assertEquals(p.status, "active");
  assertExists(p.id);
  await db.destroy();
});

Deno.test("getProject - returns project with BOM", async () => {
  const db = await freshDb();
  const project = await createProject(db, { name: "Test" });
  const part = await createPart(db, { name: "NE555", stock: 10 });
  await addBomLine(db, { project_id: project.id, part_id: part.id, quantity_required: 2 });

  const found = await getProject(db, project.id);
  assertExists(found);
  assertEquals(found!.bom_lines.length, 1);
  assertEquals(found!.bom_lines[0].part_name, "NE555");
  assertEquals(found!.bom_lines[0].stock_available, 10);
  assertEquals(found!.bom_lines[0].sufficient, true);
  assertEquals(found!.total_line_items, 1);

  await db.destroy();
});

Deno.test("listProjects - filters by status", async () => {
  const db = await freshDb();
  await createProject(db, { name: "Active" });
  const archived = await createProject(db, { name: "Old" });
  await updateProject(db, archived.id, { status: "archived" });

  const all = await listProjects(db);
  assertEquals(all.length, 2);

  const active = await listProjects(db, "active");
  assertEquals(active.length, 1);
  assertEquals(active[0].name, "Active");

  await db.destroy();
});

Deno.test("deleteProject - cascades BOM and builds", async () => {
  const db = await freshDb();
  const project = await createProject(db, { name: "Test" });
  const part = await createPart(db, { name: "NE555" });
  await addBomLine(db, { project_id: project.id, part_id: part.id, quantity_required: 1 });
  await createBuildOrder(db, { project_id: project.id, quantity: 1 });

  await deleteProject(db, project.id);

  assertEquals(await getProject(db, project.id), undefined);
  const lines = await getBomLines(db, project.id);
  assertEquals(lines.length, 0);
  const builds = await listBuildOrders(db, project.id);
  assertEquals(builds.length, 0);

  await db.destroy();
});

// --- BOM Lines ---

Deno.test("addBomLine - creates line", async () => {
  const db = await freshDb();
  const project = await createProject(db, { name: "Test" });
  const part = await createPart(db, { name: "NE555" });

  const line = await addBomLine(db, {
    project_id: project.id,
    part_id: part.id,
    quantity_required: 3,
    reference_designators: "U1, U2, U3",
  });

  assertEquals(line.quantity_required, 3);
  assertEquals(line.reference_designators, "U1, U2, U3");

  await db.destroy();
});

Deno.test("addBomLine - updates existing line for same part", async () => {
  const db = await freshDb();
  const project = await createProject(db, { name: "Test" });
  const part = await createPart(db, { name: "NE555" });

  await addBomLine(db, { project_id: project.id, part_id: part.id, quantity_required: 2 });
  await addBomLine(db, { project_id: project.id, part_id: part.id, quantity_required: 5 });

  const lines = await getBomLines(db, project.id);
  assertEquals(lines.length, 1); // No duplicate
  assertEquals(lines[0].quantity_required, 5); // Updated

  await db.destroy();
});

Deno.test("removeBomLine - removes line", async () => {
  const db = await freshDb();
  const project = await createProject(db, { name: "Test" });
  const part = await createPart(db, { name: "NE555" });
  const line = await addBomLine(db, { project_id: project.id, part_id: part.id, quantity_required: 1 });

  await removeBomLine(db, line.id);
  const lines = await getBomLines(db, project.id);
  assertEquals(lines.length, 0);

  await db.destroy();
});

// --- BOM Availability ---

Deno.test("checkBomAvailability - sufficient stock", async () => {
  const db = await freshDb();
  const project = await createProject(db, { name: "Test" });
  const part = await createPart(db, { name: "NE555", stock: 10 });
  await addBomLine(db, { project_id: project.id, part_id: part.id, quantity_required: 3 });

  const result = await checkBomAvailability(db, project.id, 1);
  assertEquals(result.can_build, true);
  assertEquals(result.shortages.length, 0);

  await db.destroy();
});

Deno.test("checkBomAvailability - insufficient stock", async () => {
  const db = await freshDb();
  const project = await createProject(db, { name: "Test" });
  const part = await createPart(db, { name: "NE555", stock: 2 });
  await addBomLine(db, { project_id: project.id, part_id: part.id, quantity_required: 5 });

  const result = await checkBomAvailability(db, project.id, 1);
  assertEquals(result.can_build, false);
  assertEquals(result.shortages.length, 1);
  assertEquals(result.shortages[0].part_name, "NE555");
  assertEquals(result.shortages[0].short, 3);

  await db.destroy();
});

Deno.test("checkBomAvailability - multiplied by build quantity", async () => {
  const db = await freshDb();
  const project = await createProject(db, { name: "Test" });
  const part = await createPart(db, { name: "NE555", stock: 10 });
  await addBomLine(db, { project_id: project.id, part_id: part.id, quantity_required: 3 });

  // 3 per unit * 5 units = 15 needed, have 10 -> short 5
  const result = await checkBomAvailability(db, project.id, 5);
  assertEquals(result.can_build, false);
  assertEquals(result.shortages[0].required, 15);
  assertEquals(result.shortages[0].short, 5);

  await db.destroy();
});

// --- Build Orders ---

Deno.test("createBuildOrder - creates draft with shortage info", async () => {
  const db = await freshDb();
  const project = await createProject(db, { name: "Test" });
  const part = await createPart(db, { name: "NE555", stock: 2 });
  await addBomLine(db, { project_id: project.id, part_id: part.id, quantity_required: 5 });

  const build = await createBuildOrder(db, { project_id: project.id, quantity: 1 });
  assertEquals(build.status, "draft");
  assertEquals(build.project_name, "Test");
  assertEquals(build.shortages.length, 1);

  await db.destroy();
});

Deno.test("completeBuildOrder - deducts stock", async () => {
  const db = await freshDb();
  const project = await createProject(db, { name: "Test" });
  const ne555 = await createPart(db, { name: "NE555", stock: 10 });
  const resistor = await createPart(db, { name: "10k", stock: 50 });

  await addBomLine(db, { project_id: project.id, part_id: ne555.id, quantity_required: 2 });
  await addBomLine(db, { project_id: project.id, part_id: resistor.id, quantity_required: 8 });

  const build = await createBuildOrder(db, { project_id: project.id, quantity: 3 });
  const completed = await completeBuildOrder(db, build.id);

  assertEquals(completed.status, "complete");
  assertExists(completed.completed_at);

  // Verify stock deducted: NE555: 10 - (2*3) = 4, 10k: 50 - (8*3) = 26
  const ne555After = await getPart(db, ne555.id);
  assertEquals(ne555After!.stock, 4);

  const resistorAfter = await getPart(db, resistor.id);
  assertEquals(resistorAfter!.stock, 26);

  await db.destroy();
});

Deno.test("completeBuildOrder - rejects insufficient stock", async () => {
  const db = await freshDb();
  const project = await createProject(db, { name: "Test" });
  const part = await createPart(db, { name: "NE555", stock: 2 });
  await addBomLine(db, { project_id: project.id, part_id: part.id, quantity_required: 5 });

  const build = await createBuildOrder(db, { project_id: project.id, quantity: 1 });

  await assertRejects(
    () => completeBuildOrder(db, build.id),
    Error,
    "insufficient stock",
  );

  // Stock should be unchanged
  const after = await getPart(db, part.id);
  assertEquals(after!.stock, 2);

  await db.destroy();
});

Deno.test("completeBuildOrder - rejects already complete", async () => {
  const db = await freshDb();
  const project = await createProject(db, { name: "Test" });
  const part = await createPart(db, { name: "NE555", stock: 10 });
  await addBomLine(db, { project_id: project.id, part_id: part.id, quantity_required: 1 });

  const build = await createBuildOrder(db, { project_id: project.id, quantity: 1 });
  await completeBuildOrder(db, build.id);

  await assertRejects(
    () => completeBuildOrder(db, build.id),
    Error,
    "already complete",
  );

  await db.destroy();
});

// --- Purchase Orders ---

Deno.test("createPurchaseOrder - basic", async () => {
  const db = await freshDb();
  const supplier = await createSupplier(db, { name: "DigiKey" });

  const po = await createPurchaseOrder(db, { supplier_id: supplier.id });
  assertEquals(po.status, "draft");
  assertEquals(po.supplier_id, supplier.id);

  await db.destroy();
});

Deno.test("addPoLine - adds line to PO", async () => {
  const db = await freshDb();
  const supplier = await createSupplier(db, { name: "DigiKey" });
  const part = await createPart(db, { name: "NE555" });
  const sp = await createSupplierPart(db, { part_id: part.id, supplier_id: supplier.id, sku: "DK-555" });

  const po = await createPurchaseOrder(db, { supplier_id: supplier.id });
  const line = await addPoLine(db, {
    purchase_order_id: po.id,
    supplier_part_id: sp.id,
    quantity_ordered: 100,
    unit_price: 0.58,
    currency: "USD",
  });

  assertEquals(line.quantity_ordered, 100);
  assertEquals(line.quantity_received, 0);
  assertEquals(line.unit_price, 0.58);

  await db.destroy();
});

Deno.test("getPurchaseOrder - returns PO with lines and cost", async () => {
  const db = await freshDb();
  const supplier = await createSupplier(db, { name: "DigiKey" });
  const part = await createPart(db, { name: "NE555" });
  const sp = await createSupplierPart(db, { part_id: part.id, supplier_id: supplier.id, sku: "DK-555" });

  const po = await createPurchaseOrder(db, { supplier_id: supplier.id });
  await addPoLine(db, { purchase_order_id: po.id, supplier_part_id: sp.id, quantity_ordered: 100, unit_price: 0.50 });

  const found = await getPurchaseOrder(db, po.id);
  assertExists(found);
  assertEquals(found!.supplier_name, "DigiKey");
  assertEquals(found!.lines.length, 1);
  assertEquals(found!.lines[0].part_name, "NE555");
  assertEquals(found!.lines[0].supplier_part_sku, "DK-555");
  assertEquals(found!.total_cost, 50); // 100 * 0.50

  await db.destroy();
});

Deno.test("receivePOLine - adds stock and updates received qty", async () => {
  const db = await freshDb();
  const supplier = await createSupplier(db, { name: "DigiKey" });
  const part = await createPart(db, { name: "NE555" });
  const sp = await createSupplierPart(db, { part_id: part.id, supplier_id: supplier.id });

  const po = await createPurchaseOrder(db, { supplier_id: supplier.id });
  const line = await addPoLine(db, { purchase_order_id: po.id, supplier_part_id: sp.id, quantity_ordered: 100 });

  // Receive 60 of 100
  const received = await receivePOLine(db, {
    po_line_id: line.id,
    quantity_received: 60,
    location: "Shelf 1",
  });
  assertEquals(received.quantity_received, 60);

  // Stock should increase
  const partAfter = await getPart(db, part.id);
  assertEquals(partAfter!.stock, 60);

  // PO status should be partial
  const poAfter = await getPurchaseOrder(db, po.id);
  assertEquals(poAfter!.status, "partial");

  await db.destroy();
});

Deno.test("receivePOLine - full receive marks PO as received", async () => {
  const db = await freshDb();
  const supplier = await createSupplier(db, { name: "DigiKey" });
  const part = await createPart(db, { name: "NE555" });
  const sp = await createSupplierPart(db, { part_id: part.id, supplier_id: supplier.id });

  const po = await createPurchaseOrder(db, { supplier_id: supplier.id });
  await updatePurchaseOrderStatus(db, po.id, "ordered");
  const line = await addPoLine(db, { purchase_order_id: po.id, supplier_part_id: sp.id, quantity_ordered: 50 });

  await receivePOLine(db, { po_line_id: line.id, quantity_received: 50 });

  const poAfter = await getPurchaseOrder(db, po.id);
  assertEquals(poAfter!.status, "received");

  const partAfter = await getPart(db, part.id);
  assertEquals(partAfter!.stock, 50);

  await db.destroy();
});

Deno.test("receivePOLine - rejects over-receive", async () => {
  const db = await freshDb();
  const supplier = await createSupplier(db, { name: "DigiKey" });
  const part = await createPart(db, { name: "NE555" });
  const sp = await createSupplierPart(db, { part_id: part.id, supplier_id: supplier.id });

  const po = await createPurchaseOrder(db, { supplier_id: supplier.id });
  const line = await addPoLine(db, { purchase_order_id: po.id, supplier_part_id: sp.id, quantity_ordered: 10 });

  await assertRejects(
    () => receivePOLine(db, { po_line_id: line.id, quantity_received: 15 }),
    Error,
    "exceed ordered qty",
  );

  await db.destroy();
});

// --- Full Workflow Scenario ---

Deno.test("scenario: project -> BOM -> build -> verify stock", async () => {
  const db = await freshDb();

  // Setup inventory
  const ne555 = await createPart(db, { name: "NE555", stock: 20 });
  const resistor = await createPart(db, { name: "10k Resistor", stock: 100 });
  const cap = await createPart(db, { name: "100nF Cap", stock: 50 });

  // Create project with BOM
  const project = await createProject(db, { name: "Synth VCO" });
  await addBomLine(db, { project_id: project.id, part_id: ne555.id, quantity_required: 1, reference_designators: "U1" });
  await addBomLine(db, { project_id: project.id, part_id: resistor.id, quantity_required: 4, reference_designators: "R1-R4" });
  await addBomLine(db, { project_id: project.id, part_id: cap.id, quantity_required: 2, reference_designators: "C1, C2" });

  // Check availability for 5 units
  const avail = await checkBomAvailability(db, project.id, 5);
  assertEquals(avail.can_build, true); // 5*1=5 NE555 (have 20), 5*4=20 R (have 100), 5*2=10 C (have 50)

  // Build 5 units
  const build = await createBuildOrder(db, { project_id: project.id, quantity: 5 });
  assertEquals(build.shortages.length, 0);

  const completed = await completeBuildOrder(db, build.id);
  assertEquals(completed.status, "complete");

  // Verify stock: NE555: 20-5=15, 10k: 100-20=80, 100nF: 50-10=40
  assertEquals((await getPart(db, ne555.id))!.stock, 15);
  assertEquals((await getPart(db, resistor.id))!.stock, 80);
  assertEquals((await getPart(db, cap.id))!.stock, 40);

  await db.destroy();
});

Deno.test("scenario: purchase order -> receive -> verify stock", async () => {
  const db = await freshDb();

  const supplier = await createSupplier(db, { name: "DigiKey" });
  const ne555 = await createPart(db, { name: "NE555" }); // stock: 0
  const sp = await createSupplierPart(db, { part_id: ne555.id, supplier_id: supplier.id, sku: "DK-555" });

  // Create PO
  const po = await createPurchaseOrder(db, { supplier_id: supplier.id });
  await addPoLine(db, { purchase_order_id: po.id, supplier_part_id: sp.id, quantity_ordered: 100, unit_price: 0.58 });

  // Partial receive
  const poLine = (await getPurchaseOrder(db, po.id))!.lines[0];
  await receivePOLine(db, { po_line_id: poLine.id, quantity_received: 60, location: "Shelf 1" });

  assertEquals((await getPart(db, ne555.id))!.stock, 60);
  assertEquals((await getPurchaseOrder(db, po.id))!.status, "partial");

  // Receive rest
  await receivePOLine(db, { po_line_id: poLine.id, quantity_received: 40, location: "Shelf 1" });

  assertEquals((await getPart(db, ne555.id))!.stock, 100);
  assertEquals((await getPurchaseOrder(db, po.id))!.status, "received");

  await db.destroy();
});

// Import updatePurchaseOrderStatus for the test that needs it
import { updatePurchaseOrderStatus } from "../src/purchase_orders.ts";
