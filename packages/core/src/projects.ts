/**
 * Project domain: projects, BOM lines, build orders.
 *
 * A Project represents something you're building (a PCB, a kit, etc.).
 * It has a BOM (Bill of Materials) -- a list of parts and quantities needed.
 * Build orders consume the BOM, deducting stock from lots.
 */

import type { Kysely } from "kysely";
import { recordAudit } from "./audit.ts";
import { adjustStock, getStockLots } from "./stock.ts";
import type {
  BomLine,
  BuildOrder,
  Database,
  Project,
} from "./schema.ts";

// ---------------------------------------------------------------------------
// Enriched types
// ---------------------------------------------------------------------------

export interface BomLineWithDetails extends BomLine {
  part_name: string;
  stock_available: number;
  sufficient: boolean;
}

export interface ProjectWithBom extends Project {
  bom_lines: BomLineWithDetails[];
  total_line_items: number;
}

export interface BuildOrderWithDetails extends BuildOrder {
  project_name: string;
  shortages: { part_name: string; required: number; available: number }[];
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function createProject(
  db: Kysely<Database>,
  input: { name: string; description?: string },
): Promise<Project> {
  const project = await db
    .insertInto("projects")
    .values({
      name: input.name,
      description: input.description ?? null,
      status: "active",
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await recordAudit(db, {
    entity_type: "project",
    entity_id: project.id,
    action: "create",
    new_values: project as unknown as Record<string, unknown>,
  });

  return project;
}

export async function getProject(
  db: Kysely<Database>,
  id: number,
): Promise<ProjectWithBom | undefined> {
  const project = await db
    .selectFrom("projects")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();

  if (!project) return undefined;
  return await enrichProject(db, project);
}

export async function listProjects(
  db: Kysely<Database>,
  status?: string,
): Promise<ProjectWithBom[]> {
  let query = db.selectFrom("projects").selectAll().orderBy("name");
  if (status) query = query.where("status", "=", status);
  const projects = await query.execute();

  const result: ProjectWithBom[] = [];
  for (const p of projects) {
    result.push(await enrichProject(db, p));
  }
  return result;
}

export async function updateProject(
  db: Kysely<Database>,
  id: number,
  input: { name?: string; description?: string | null; status?: string },
): Promise<Project> {
  const existing = await db.selectFrom("projects").selectAll().where("id", "=", id).executeTakeFirst();
  if (!existing) throw new Error(`Project ${id} not found`);

  const updated = await db
    .updateTable("projects")
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.status !== undefined && { status: input.status }),
    })
    .where("id", "=", id)
    .returningAll()
    .executeTakeFirstOrThrow();

  await recordAudit(db, {
    entity_type: "project",
    entity_id: id,
    action: "update",
    old_values: existing as unknown as Record<string, unknown>,
    new_values: updated as unknown as Record<string, unknown>,
  });

  return updated;
}

export async function deleteProject(
  db: Kysely<Database>,
  id: number,
): Promise<void> {
  const existing = await db.selectFrom("projects").selectAll().where("id", "=", id).executeTakeFirst();
  if (!existing) throw new Error(`Project ${id} not found`);

  await db.deleteFrom("projects").where("id", "=", id).execute();

  await recordAudit(db, {
    entity_type: "project",
    entity_id: id,
    action: "delete",
    old_values: existing as unknown as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// BOM Lines
// ---------------------------------------------------------------------------

export async function addBomLine(
  db: Kysely<Database>,
  input: {
    project_id: number;
    part_id: number;
    quantity_required: number;
    reference_designators?: string;
    notes?: string;
  },
): Promise<BomLine> {
  // Verify project and part exist
  const project = await db.selectFrom("projects").select("id").where("id", "=", input.project_id).executeTakeFirst();
  if (!project) throw new Error(`Project ${input.project_id} not found`);
  const part = await db.selectFrom("parts").select("id").where("id", "=", input.part_id).executeTakeFirst();
  if (!part) throw new Error(`Part ${input.part_id} not found`);

  // Check if this part already has a BOM line in this project
  const existing = await db
    .selectFrom("bom_lines")
    .selectAll()
    .where("project_id", "=", input.project_id)
    .where("part_id", "=", input.part_id)
    .executeTakeFirst();

  if (existing) {
    // Update quantity instead of creating duplicate
    const updated = await db
      .updateTable("bom_lines")
      .set({
        quantity_required: input.quantity_required,
        reference_designators: input.reference_designators ?? existing.reference_designators,
        notes: input.notes ?? existing.notes,
      })
      .where("id", "=", existing.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await recordAudit(db, {
      entity_type: "bom_line",
      entity_id: existing.id,
      action: "update",
      old_values: { quantity_required: existing.quantity_required, reference_designators: existing.reference_designators },
      new_values: { quantity_required: updated.quantity_required, reference_designators: updated.reference_designators },
    });

    return updated;
  }

  const line = await db
    .insertInto("bom_lines")
    .values({
      project_id: input.project_id,
      part_id: input.part_id,
      quantity_required: input.quantity_required,
      reference_designators: input.reference_designators ?? null,
      notes: input.notes ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await recordAudit(db, {
    entity_type: "bom_line",
    entity_id: line.id,
    action: "create",
    new_values: { project_id: line.project_id, part_id: line.part_id, quantity_required: line.quantity_required },
  });

  return line;
}

export async function removeBomLine(
  db: Kysely<Database>,
  id: number,
): Promise<void> {
  const existing = await db.selectFrom("bom_lines").selectAll().where("id", "=", id).executeTakeFirst();
  if (!existing) throw new Error(`BOM line ${id} not found`);
  await db.deleteFrom("bom_lines").where("id", "=", id).execute();

  await recordAudit(db, {
    entity_type: "bom_line",
    entity_id: id,
    action: "delete",
    old_values: { project_id: existing.project_id, part_id: existing.part_id, quantity_required: existing.quantity_required },
  });
}

export async function getBomLines(
  db: Kysely<Database>,
  projectId: number,
): Promise<BomLineWithDetails[]> {
  const lines = await db
    .selectFrom("bom_lines")
    .selectAll()
    .where("project_id", "=", projectId)
    .orderBy("id")
    .execute();

  if (lines.length === 0) return [];

  // Batch load part names and stock
  const partIds = lines.map((l) => l.part_id);
  const parts = await db
    .selectFrom("parts")
    .select(["id", "name", "stock"])
    .where("id", "in", partIds)
    .execute();
  const partMap = new Map(parts.map((p) => [p.id, p]));

  return lines.map((line) => {
    const part = partMap.get(line.part_id);
    const stock = part?.stock ?? 0;
    return {
      ...line,
      part_name: part?.name ?? `Part #${line.part_id}`,
      stock_available: stock,
      sufficient: stock >= line.quantity_required,
    };
  });
}

/**
 * Check if a project's BOM can be fully built with current stock.
 * Returns shortages.
 */
export async function checkBomAvailability(
  db: Kysely<Database>,
  projectId: number,
  buildQuantity: number = 1,
): Promise<{
  can_build: boolean;
  shortages: { part_id: number; part_name: string; required: number; available: number; short: number }[];
}> {
  const lines = await getBomLines(db, projectId);
  const shortages: { part_id: number; part_name: string; required: number; available: number; short: number }[] = [];

  for (const line of lines) {
    const required = line.quantity_required * buildQuantity;
    if (line.stock_available < required) {
      shortages.push({
        part_id: line.part_id,
        part_name: line.part_name,
        required,
        available: line.stock_available,
        short: required - line.stock_available,
      });
    }
  }

  return { can_build: shortages.length === 0, shortages };
}

// ---------------------------------------------------------------------------
// Build Orders
// ---------------------------------------------------------------------------

export async function createBuildOrder(
  db: Kysely<Database>,
  input: { project_id: number; quantity: number },
): Promise<BuildOrderWithDetails> {
  const project = await db.selectFrom("projects").select(["id", "name"]).where("id", "=", input.project_id).executeTakeFirst();
  if (!project) throw new Error(`Project ${input.project_id} not found`);

  const now = new Date().toISOString();
  const build = await db
    .insertInto("build_orders")
    .values({
      project_id: input.project_id,
      quantity: input.quantity,
      status: "draft",
      created_at: now,
      completed_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await recordAudit(db, {
    entity_type: "build_order",
    entity_id: build.id,
    action: "create",
    new_values: build as unknown as Record<string, unknown>,
  });

  const { shortages } = await checkBomAvailability(db, input.project_id, input.quantity);

  return {
    ...build,
    project_name: project.name,
    shortages: shortages.map((s) => ({
      part_name: s.part_name,
      required: s.required,
      available: s.available,
    })),
  };
}

/**
 * Complete a build order: deduct stock for all BOM items.
 * Fails if there's insufficient stock (check with checkBomAvailability first).
 */
export async function completeBuildOrder(
  db: Kysely<Database>,
  buildId: number,
): Promise<BuildOrder> {
  const build = await db
    .selectFrom("build_orders")
    .selectAll()
    .where("id", "=", buildId)
    .executeTakeFirst();

  if (!build) throw new Error(`Build order ${buildId} not found`);
  if (build.status === "complete") throw new Error(`Build order ${buildId} is already complete`);
  if (build.status === "cancelled") throw new Error(`Build order ${buildId} is cancelled`);

  // Check availability
  const { can_build, shortages } = await checkBomAvailability(db, build.project_id, build.quantity);
  if (!can_build) {
    const shortList = shortages.map((s) => `${s.part_name}: need ${s.required}, have ${s.available}`).join("; ");
    throw new Error(`Cannot complete build: insufficient stock -- ${shortList}`);
  }

  // Deduct stock for each BOM line
  const lines = await getBomLines(db, build.project_id);
  for (const line of lines) {
    const qty = line.quantity_required * build.quantity;
    await adjustStock(db, {
      part_id: line.part_id,
      quantity: -qty,
      reason: `Build order #${buildId} (${build.quantity}x)`,
    });
  }

  const now = new Date().toISOString();
  const updated = await db
    .updateTable("build_orders")
    .set({ status: "complete", completed_at: now })
    .where("id", "=", buildId)
    .returningAll()
    .executeTakeFirstOrThrow();

  await recordAudit(db, {
    entity_type: "build_order",
    entity_id: buildId,
    action: "update",
    old_values: { status: build.status },
    new_values: { status: "complete", completed_at: now },
  });

  return updated;
}

export async function listBuildOrders(
  db: Kysely<Database>,
  projectId?: number,
): Promise<BuildOrderWithDetails[]> {
  let query = db.selectFrom("build_orders").selectAll().orderBy("created_at", "desc");
  if (projectId) query = query.where("project_id", "=", projectId);
  const builds = await query.execute();

  // Batch load project names
  const projectIds = [...new Set(builds.map((b) => b.project_id))];
  const projects = projectIds.length > 0
    ? await db.selectFrom("projects").select(["id", "name"]).where("id", "in", projectIds).execute()
    : [];
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  return builds.map((b) => ({
    ...b,
    project_name: projectMap.get(b.project_id) ?? "",
    shortages: [], // Shortages only computed on demand
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function enrichProject(
  db: Kysely<Database>,
  project: Project,
): Promise<ProjectWithBom> {
  const bom_lines = await getBomLines(db, project.id);
  return {
    ...project,
    bom_lines,
    total_line_items: bom_lines.length,
  };
}
