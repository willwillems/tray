/**
 * Main API router.
 *
 * For Hono RPC type inference to work, all routes must be defined
 * in a single chain. Sub-routers via .route() lose type info.
 */

import { Hono } from "hono";
import type { Kysely } from "kysely";
import type { Database } from "@tray/core";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  createCategorySchema,
  createPart,
  createPartSchema,
  deletePart,
  getPart,
  listParts,
  listPartsSchema,
  searchParts,
  listAllTags,
  updatePart,
  updatePartSchema,
  queryAuditLog,
  getAuditEntry,
  createCategory,
  deleteCategory,
  getCategory,
  getCategoryPath,
  getCategoryTree,
  listCategories,
  resolveOrCreateCategoryPath,
  updateCategory,
  addStock,
  adjustStock,
  moveStock,
  getStockLots,
  getLocationTree,
  listLocations,
  deleteLocation,
  getLocation,
  getLocationPath,
  createSupplier,
  createSupplierPart,
  deleteSupplier,
  deleteSupplierPart,
  getBestPrice,
  getSupplier,
  getSupplierPartsForPart,
  getSupplierPartsForSupplier,
  listSuppliers,
  updateSupplier,
  storeAttachment,
  getAttachment,
  readAttachmentFile,
  listAttachments,
  deleteAttachment,
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject,
  addBomLine,
  removeBomLine,
  getBomLines,
  checkBomAvailability,
  createBuildOrder,
  completeBuildOrder,
  listBuildOrders,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  addPoLine,
  receivePOLine,
  resolveSupplier,
  updatePoLine,
  updatePurchaseOrder,
  getKicadRoot,
  getKicadCategories,
  getKicadPartsForCategory,
  getKicadPartDetail,
} from "@tray/core";
import type { Env } from "./context.ts";

/**
 * Build the full typed route chain.
 * The db is injected into the Hono env at construction time,
 * not via middleware (which breaks type inference).
 */
function buildRoutes(db: Kysely<Database>, attachmentsDir: string) {
  const app = new Hono<Env>()
    // Inject db and attachments dir into every request
    .use("*", async (c, next) => {
      c.set("db", db);
      c.set("attachments_dir", attachmentsDir);
      await next();
    })
    // Health check
    .get("/health", (c) => c.json({ ok: true }))

    // --- Parts ---
    .post(
      "/api/parts",
      zValidator("json", createPartSchema),
      async (c) => {
        const input = c.req.valid("json");
        const result = await createPart(c.get("db"), input);
        return c.json(result, 201);
      },
    )
    .get(
      "/api/parts",
      zValidator("query", listPartsSchema),
      async (c) => {
        const filters = c.req.valid("query");
        const results = await listParts(c.get("db"), filters);
        return c.json(results);
      },
    )
    .get("/api/parts/:id", async (c) => {
      const db = c.get("db");
      const idStr = c.req.param("id");
      // Only treat as numeric ID if the entire string is digits
      const isNumeric = /^\d+$/.test(idStr);
      const result = isNumeric ? await getPart(db, parseInt(idStr, 10)) : await getPart(db, idStr);
      if (!result) {
        return c.json({ error: "not_found", message: `No part found matching '${idStr}'` }, 404);
      }
      return c.json(result);
    })
    .patch(
      "/api/parts/:id",
      zValidator("json", updatePartSchema),
      async (c) => {
        const db = c.get("db");
        const id = parseInt(c.req.param("id"), 10);
        if (isNaN(id)) {
          return c.json({ error: "invalid_id", message: "Part ID must be a number" }, 400);
        }
        const input = c.req.valid("json");
        try {
          const result = await updatePart(db, id, input);
          return c.json(result);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return c.json({ error: "not_found", message: msg }, 404);
        }
      },
    )
    .delete("/api/parts/:id", async (c) => {
      const db = c.get("db");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "invalid_id", message: "Part ID must be a number" }, 400);
      }
      try {
        await deletePart(db, id);
        return c.json({ ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return c.json({ error: "not_found", message: msg }, 404);
      }
    })

    // --- Categories ---
    .get("/api/categories", async (c) => {
      const db = c.get("db");
      const parentIdStr = c.req.query("parent_id");
      const parentId = parentIdStr === undefined
        ? undefined
        : parentIdStr === "null"
        ? null
        : parseInt(parentIdStr, 10);
      const results = await listCategories(db, parentId);
      return c.json(results);
    })
    .get("/api/categories/tree", async (c) => {
      const tree = await getCategoryTree(c.get("db"));
      return c.json(tree);
    })
    .post(
      "/api/categories",
      zValidator("json", createCategorySchema),
      async (c) => {
        const input = c.req.valid("json");
        const result = await createCategory(c.get("db"), input);
        return c.json(result, 201);
      },
    )
    .post(
      "/api/categories/resolve",
      zValidator("json", z.object({ path: z.string().min(1) })),
      async (c) => {
        const { path } = c.req.valid("json");
        const db = c.get("db");
        const id = await resolveOrCreateCategoryPath(db, path);
        const cat = await getCategory(db, id);
        const fullPath = await getCategoryPath(db, id);
        return c.json({ ...cat, path: fullPath }, 201);
      },
    )
    .get("/api/categories/:id", async (c) => {
      const db = c.get("db");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "invalid_id", message: "Category ID must be a number" }, 400);
      }
      const cat = await getCategory(db, id);
      if (!cat) {
        return c.json({ error: "not_found", message: `Category ${id} not found` }, 404);
      }
      const path = await getCategoryPath(db, id);
      return c.json({ ...cat, path });
    })
    .delete("/api/categories/:id", async (c) => {
      const db = c.get("db");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "invalid_id", message: "Category ID must be a number" }, 400);
      }
      try {
        await deleteCategory(db, id);
        return c.json({ ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return c.json({ error: "not_found", message: msg }, 404);
      }
    })

    // --- Search ---
    .get(
      "/api/search",
      zValidator(
        "query",
        z.object({
          q: z.string().min(1),
          limit: z.coerce.number().int().positive().default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      ),
      async (c) => {
        const { q, limit, offset } = c.req.valid("query");
        const results = await searchParts(c.get("db"), q, { limit, offset });
        return c.json(results);
      },
    )
    .get("/api/tags", async (c) => {
      const tags = await listAllTags(c.get("db"));
      return c.json(tags);
    })

    // --- Audit ---
    .get(
      "/api/audit",
      zValidator(
        "query",
        z.object({
          entity_type: z.string().optional(),
          entity_id: z.coerce.number().int().positive().optional(),
          action: z.string().optional(),
          user: z.string().optional(),
          since: z.string().optional(),
          limit: z.coerce.number().int().positive().default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      ),
      async (c) => {
        const filters = c.req.valid("query");
        const results = await queryAuditLog(c.get("db"), filters);
        return c.json(results);
      },
    )
    .get("/api/audit/:id", async (c) => {
      const db = c.get("db");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "invalid_id", message: "Audit entry ID must be a number" }, 400);
      }
      const entry = await getAuditEntry(db, id);
      if (!entry) {
        return c.json({ error: "not_found", message: `Audit entry ${id} not found` }, 404);
      }
      return c.json(entry);
    })

    // --- Stock ---
    .post(
      "/api/stock/add",
      zValidator(
        "json",
        z.object({
          part_id: z.number().int().positive(),
          quantity: z.number().positive(),
          location: z.string().optional(),
          location_id: z.number().int().positive().optional(),
          status: z.enum(["ok", "damaged", "quarantined", "returned"]).default("ok"),
          expiry_date: z.string().optional(),
          notes: z.string().optional(),
        }),
      ),
      async (c) => {
        const input = c.req.valid("json");
        const lot = await addStock(c.get("db"), input);
        return c.json(lot, 201);
      },
    )
    .post(
      "/api/stock/adjust",
      zValidator(
        "json",
        z.object({
          part_id: z.number().int().positive(),
          quantity: z.number(),
          reason: z.string().min(1),
          lot_id: z.number().int().positive().optional(),
        }),
      ),
      async (c) => {
        const input = c.req.valid("json");
        try {
          const lot = await adjustStock(c.get("db"), input);
          return c.json(lot);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return c.json({ error: "stock_error", message: msg }, 400);
        }
      },
    )
    .post(
      "/api/stock/move",
      zValidator(
        "json",
        z.object({
          part_id: z.number().int().positive(),
          quantity: z.number().positive(),
          from_lot_id: z.number().int().positive().optional(),
          from_location: z.string().optional(),
          to_location: z.string().min(1),
          notes: z.string().optional(),
        }),
      ),
      async (c) => {
        const input = c.req.valid("json");
        try {
          const result = await moveStock(c.get("db"), input);
          return c.json(result);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return c.json({ error: "stock_error", message: msg }, 400);
        }
      },
    )
    .get("/api/stock/:part_id", async (c) => {
      const db = c.get("db");
      const partId = parseInt(c.req.param("part_id"), 10);
      if (isNaN(partId)) {
        return c.json({ error: "invalid_id", message: "Part ID must be a number" }, 400);
      }
      const lots = await getStockLots(db, partId);
      return c.json(lots);
    })

    // --- Locations ---
    .get("/api/locations", async (c) => {
      const db = c.get("db");
      const parentIdStr = c.req.query("parent_id");
      const parentId = parentIdStr === undefined
        ? undefined
        : parentIdStr === "null"
        ? null
        : parseInt(parentIdStr, 10);
      const results = await listLocations(db, parentId);
      return c.json(results);
    })
    .get("/api/locations/tree", async (c) => {
      const tree = await getLocationTree(c.get("db"));
      return c.json(tree);
    })
    .get("/api/locations/:id", async (c) => {
      const db = c.get("db");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "invalid_id", message: "Location ID must be a number" }, 400);
      }
      const loc = await getLocation(db, id);
      if (!loc) {
        return c.json({ error: "not_found", message: `Location ${id} not found` }, 404);
      }
      const path = await getLocationPath(db, id);
      return c.json({ ...loc, path });
    })
    .delete("/api/locations/:id", async (c) => {
      const db = c.get("db");
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) {
        return c.json({ error: "invalid_id", message: "Location ID must be a number" }, 400);
      }
      try {
        await deleteLocation(db, id);
        return c.json({ ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return c.json({ error: "not_found", message: msg }, 404);
      }
    })

    // --- Suppliers ---
    .post(
      "/api/suppliers",
      zValidator(
        "json",
        z.object({
          name: z.string().min(1),
          url: z.string().url().optional(),
          notes: z.string().optional(),
        }),
      ),
      async (c) => {
        const input = c.req.valid("json");
        const supplier = await createSupplier(c.get("db"), input);
        return c.json(supplier, 201);
      },
    )
    .get("/api/suppliers", async (c) => {
      const suppliers = await listSuppliers(c.get("db"));
      return c.json(suppliers);
    })
    .get("/api/suppliers/:id", async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "invalid_id", message: "Supplier ID must be a number" }, 400);
      const supplier = await getSupplier(c.get("db"), id);
      if (!supplier) return c.json({ error: "not_found", message: `Supplier ${id} not found` }, 404);
      return c.json(supplier);
    })
    .patch(
      "/api/suppliers/:id",
      zValidator(
        "json",
        z.object({
          name: z.string().min(1).optional(),
          url: z.string().url().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      ),
      async (c) => {
        const id = parseInt(c.req.param("id"), 10);
        if (isNaN(id)) return c.json({ error: "invalid_id", message: "Supplier ID must be a number" }, 400);
        const input = c.req.valid("json");
        try {
          const supplier = await updateSupplier(c.get("db"), id, input);
          return c.json(supplier);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return c.json({ error: "not_found", message: msg }, 404);
        }
      },
    )
    .delete("/api/suppliers/:id", async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "invalid_id", message: "Supplier ID must be a number" }, 400);
      try {
        await deleteSupplier(c.get("db"), id);
        return c.json({ ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return c.json({ error: "not_found", message: msg }, 404);
      }
    })

    // --- Supplier Parts ---
    .post(
      "/api/supplier-parts",
      zValidator(
        "json",
        z.object({
          part_id: z.number().int().positive(),
          supplier_id: z.number().int().positive(),
          sku: z.string().optional(),
          url: z.string().url().optional(),
          notes: z.string().optional(),
          price_breaks: z
            .array(
              z.object({
                min_quantity: z.number().int().positive(),
                price: z.number().positive(),
                currency: z.string().default("USD"),
              }),
            )
            .optional(),
        }),
      ),
      async (c) => {
        const input = c.req.valid("json");
        try {
          const sp = await createSupplierPart(c.get("db"), input);
          return c.json(sp, 201);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return c.json({ error: "not_found", message: msg }, 400);
        }
      },
    )
    .get("/api/parts/:id/suppliers", async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "invalid_id", message: "Part ID must be a number" }, 400);
      const sps = await getSupplierPartsForPart(c.get("db"), id);
      return c.json(sps);
    })
    .get("/api/suppliers/:id/parts", async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "invalid_id", message: "Supplier ID must be a number" }, 400);
      const sps = await getSupplierPartsForSupplier(c.get("db"), id);
      return c.json(sps);
    })
    .delete("/api/supplier-parts/:id", async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "invalid_id", message: "Supplier part ID must be a number" }, 400);
      try {
        await deleteSupplierPart(c.get("db"), id);
        return c.json({ ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return c.json({ error: "not_found", message: msg }, 404);
      }
    })

    // --- Best Price ---
    .get(
      "/api/parts/:id/best-price",
      zValidator("query", z.object({ quantity: z.coerce.number().int().positive().default(1) })),
      async (c) => {
        const id = parseInt(c.req.param("id"), 10);
        if (isNaN(id)) return c.json({ error: "invalid_id", message: "Part ID must be a number" }, 400);
        const { quantity } = c.req.valid("query");
        const result = await getBestPrice(c.get("db"), id, quantity);
        if (!result) return c.json({ error: "no_price", message: "No pricing available for this quantity" }, 404);
        return c.json(result);
      },
    )

    // --- Attachments ---
    .post("/api/attachments", async (c) => {
      const body = await c.req.parseBody();
      const file = body["file"];
      if (!file || typeof file === "string") {
        return c.json({ error: "missing_file", message: "File upload required (multipart field 'file')" }, 400);
      }

      const entityType = (body["entity_type"] as string) ?? "part";
      const entityIdStr = body["entity_id"] as string;
      if (!entityIdStr) {
        return c.json({ error: "missing_field", message: "entity_id is required" }, 400);
      }
      const entityId = parseInt(entityIdStr, 10);
      if (isNaN(entityId)) {
        return c.json({ error: "invalid_id", message: "entity_id must be a number" }, 400);
      }

      const data = new Uint8Array(await file.arrayBuffer());
      const att = await storeAttachment(c.get("db"), {
        entity_type: entityType,
        entity_id: entityId,
        filename: file.name || "unnamed",
        data,
        mime_type: file.type || "application/octet-stream",
        type: (body["type"] as string) ?? undefined,
        source_url: (body["source_url"] as string) ?? undefined,
        attachments_dir: c.get("attachments_dir"),
      });
      return c.json(att, 201);
    })
    .get("/api/attachments/:id", async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "invalid_id", message: "Attachment ID must be a number" }, 400);
      const att = await getAttachment(c.get("db"), id);
      if (!att) return c.json({ error: "not_found", message: `Attachment ${id} not found` }, 404);
      return c.json(att);
    })
    .get("/api/attachments/:id/file", async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "invalid_id", message: "Attachment ID must be a number" }, 400);
      const att = await getAttachment(c.get("db"), id);
      if (!att) return c.json({ error: "not_found", message: `Attachment ${id} not found` }, 404);

      try {
        const data = readAttachmentFile(c.get("attachments_dir"), att.storage_key);
        return new Response(data, {
          headers: {
            "Content-Type": att.mime_type,
            "Content-Disposition": `attachment; filename="${att.filename}"`,
            "Content-Length": String(data.length),
          },
        });
      } catch {
        return c.json({ error: "file_missing", message: "Attachment file not found on disk" }, 404);
      }
    })
    .get(
      "/api/attachments",
      zValidator(
        "query",
        z.object({
          entity_type: z.string(),
          entity_id: z.coerce.number().int().positive(),
        }),
      ),
      async (c) => {
        const { entity_type, entity_id } = c.req.valid("query");
        const atts = await listAttachments(c.get("db"), entity_type, entity_id);
        return c.json(atts);
      },
    )
    .delete("/api/attachments/:id", async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "invalid_id", message: "Attachment ID must be a number" }, 400);
      try {
        await deleteAttachment(c.get("db"), id, c.get("attachments_dir"));
        return c.json({ ok: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return c.json({ error: "not_found", message: msg }, 404);
      }
    })

    // --- Projects ---
    .post(
      "/api/projects",
      zValidator("json", z.object({ name: z.string().min(1), description: z.string().optional() })),
      async (c) => {
        const input = c.req.valid("json");
        const project = await createProject(c.get("db"), input);
        return c.json(project, 201);
      },
    )
    .get("/api/projects", async (c) => {
      const status = c.req.query("status");
      const projects = await listProjects(c.get("db"), status);
      return c.json(projects);
    })
    .get("/api/projects/:id", async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "invalid_id", message: "Project ID must be a number" }, 400);
      const project = await getProject(c.get("db"), id);
      if (!project) return c.json({ error: "not_found", message: `Project ${id} not found` }, 404);
      return c.json(project);
    })
    .patch(
      "/api/projects/:id",
      zValidator("json", z.object({
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        status: z.enum(["active", "archived"]).optional(),
      })),
      async (c) => {
        const id = parseInt(c.req.param("id"), 10);
        if (isNaN(id)) return c.json({ error: "invalid_id", message: "Project ID must be a number" }, 400);
        try {
          const project = await updateProject(c.get("db"), id, c.req.valid("json"));
          return c.json(project);
        } catch (e) {
          return c.json({ error: "not_found", message: (e as Error).message }, 404);
        }
      },
    )
    .delete("/api/projects/:id", async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "invalid_id", message: "Project ID must be a number" }, 400);
      try {
        await deleteProject(c.get("db"), id);
        return c.json({ ok: true });
      } catch (e) {
        return c.json({ error: "not_found", message: (e as Error).message }, 404);
      }
    })

    // --- BOM Lines ---
    .post(
      "/api/projects/:id/bom",
      zValidator("json", z.object({
        part_id: z.number().int().positive(),
        quantity_required: z.number().positive(),
        reference_designators: z.string().optional(),
        notes: z.string().optional(),
      })),
      async (c) => {
        const projectId = parseInt(c.req.param("id"), 10);
        if (isNaN(projectId)) return c.json({ error: "invalid_id", message: "Project ID must be a number" }, 400);
        const input = c.req.valid("json");
        try {
          const line = await addBomLine(c.get("db"), { project_id: projectId, ...input });
          return c.json(line, 201);
        } catch (e) {
          return c.json({ error: "not_found", message: (e as Error).message }, 400);
        }
      },
    )
    .get("/api/projects/:id/bom", async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "invalid_id", message: "Project ID must be a number" }, 400);
      const lines = await getBomLines(c.get("db"), id);
      return c.json(lines);
    })
    .delete("/api/bom-lines/:id", async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "invalid_id", message: "BOM line ID must be a number" }, 400);
      try {
        await removeBomLine(c.get("db"), id);
        return c.json({ ok: true });
      } catch (e) {
        return c.json({ error: "not_found", message: (e as Error).message }, 404);
      }
    })
    .get(
      "/api/projects/:id/check",
      zValidator("query", z.object({ quantity: z.coerce.number().int().positive().default(1) })),
      async (c) => {
        const id = parseInt(c.req.param("id"), 10);
        if (isNaN(id)) return c.json({ error: "invalid_id", message: "Project ID must be a number" }, 400);
        const { quantity } = c.req.valid("query");
        const result = await checkBomAvailability(c.get("db"), id, quantity);
        return c.json(result);
      },
    )

    // --- Build Orders ---
    .post(
      "/api/builds",
      zValidator("json", z.object({ project_id: z.number().int().positive(), quantity: z.number().int().positive() })),
      async (c) => {
        const input = c.req.valid("json");
        try {
          const build = await createBuildOrder(c.get("db"), input);
          return c.json(build, 201);
        } catch (e) {
          return c.json({ error: "not_found", message: (e as Error).message }, 400);
        }
      },
    )
    .post("/api/builds/:id/complete", async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "invalid_id", message: "Build order ID must be a number" }, 400);
      try {
        const build = await completeBuildOrder(c.get("db"), id);
        return c.json(build);
      } catch (e) {
        return c.json({ error: "build_error", message: (e as Error).message }, 400);
      }
    })
    .get("/api/builds", async (c) => {
      const projectId = c.req.query("project_id");
      const builds = await listBuildOrders(c.get("db"), projectId ? parseInt(projectId, 10) : undefined);
      return c.json(builds);
    })

    // --- Purchase Orders ---
    .post(
      "/api/purchase-orders",
      zValidator("json", z.object({
        supplier_id: z.number().int().positive().optional(),
        supplier: z.string().optional(),
        notes: z.string().optional(),
      })),
      async (c) => {
        const input = c.req.valid("json");
        try {
          let supplierId = input.supplier_id;
          if (!supplierId && input.supplier) {
            const resolved = await resolveSupplier(c.get("db"), input.supplier);
            supplierId = resolved.id;
          }
          if (!supplierId) {
            return c.json({ error: "validation", message: "Either supplier_id or supplier (name) is required" }, 400);
          }
          const po = await createPurchaseOrder(c.get("db"), { supplier_id: supplierId, notes: input.notes });
          return c.json(po, 201);
        } catch (e) {
          return c.json({ error: "not_found", message: (e as Error).message }, 400);
        }
      },
    )
    .get("/api/purchase-orders", async (c) => {
      const status = c.req.query("status");
      const pos = await listPurchaseOrders(c.get("db"), status);
      return c.json(pos);
    })
    .get("/api/purchase-orders/:id", async (c) => {
      const id = parseInt(c.req.param("id"), 10);
      if (isNaN(id)) return c.json({ error: "invalid_id", message: "PO ID must be a number" }, 400);
      const po = await getPurchaseOrder(c.get("db"), id);
      if (!po) return c.json({ error: "not_found", message: `Purchase order ${id} not found` }, 404);
      return c.json(po);
    })
    .patch(
      "/api/purchase-orders/:id",
      zValidator("json", z.object({
        status: z.enum(["draft", "ordered", "partial", "received", "cancelled"]).optional(),
        notes: z.string().optional(),
      })),
      async (c) => {
        const id = parseInt(c.req.param("id"), 10);
        if (isNaN(id)) return c.json({ error: "invalid_id", message: "PO ID must be a number" }, 400);
        const input = c.req.valid("json");
        try {
          const po = await updatePurchaseOrder(c.get("db"), id, input);
          return c.json(po);
        } catch (e) {
          return c.json({ error: "not_found", message: (e as Error).message }, 400);
        }
      },
    )
    .post(
      "/api/purchase-orders/:id/lines",
      zValidator("json", z.object({
        supplier_part_id: z.number().int().positive().optional(),
        part_id: z.number().int().positive().optional(),
        quantity_ordered: z.number().int().positive(),
        unit_price: z.number().optional(),
        currency: z.string().default("USD"),
      })),
      async (c) => {
        const poId = parseInt(c.req.param("id"), 10);
        if (isNaN(poId)) return c.json({ error: "invalid_id", message: "PO ID must be a number" }, 400);
        const input = c.req.valid("json");
        if (!input.supplier_part_id && !input.part_id) {
          return c.json({ error: "validation", message: "Either supplier_part_id or part_id is required" }, 400);
        }
        try {
          const lineInput = input.supplier_part_id
            ? { purchase_order_id: poId, supplier_part_id: input.supplier_part_id, quantity_ordered: input.quantity_ordered, unit_price: input.unit_price, currency: input.currency }
            : { purchase_order_id: poId, part_id: input.part_id!, quantity_ordered: input.quantity_ordered, unit_price: input.unit_price, currency: input.currency };
          const line = await addPoLine(c.get("db"), lineInput);
          return c.json(line, 201);
        } catch (e) {
          return c.json({ error: "not_found", message: (e as Error).message }, 400);
        }
      },
    )
    .patch(
      "/api/po-lines/:id",
      zValidator("json", z.object({
        quantity_ordered: z.number().int().positive().optional(),
        unit_price: z.number().nullable().optional(),
        currency: z.string().nullable().optional(),
      })),
      async (c) => {
        const id = parseInt(c.req.param("id"), 10);
        if (isNaN(id)) return c.json({ error: "invalid_id", message: "PO line ID must be a number" }, 400);
        const input = c.req.valid("json");
        try {
          const line = await updatePoLine(c.get("db"), id, input);
          return c.json(line);
        } catch (e) {
          return c.json({ error: "update_error", message: (e as Error).message }, 400);
        }
      },
    )
    .post(
      "/api/po-lines/:id/receive",
      zValidator("json", z.object({
        quantity_received: z.number().int().positive(),
        location: z.string().optional(),
      })),
      async (c) => {
        const id = parseInt(c.req.param("id"), 10);
        if (isNaN(id)) return c.json({ error: "invalid_id", message: "PO line ID must be a number" }, 400);
        const input = c.req.valid("json");
        try {
          const line = await receivePOLine(c.get("db"), { po_line_id: id, ...input });
          return c.json(line);
        } catch (e) {
          return c.json({ error: "receive_error", message: (e as Error).message }, 400);
        }
      },
    )

    // --- KiCad HTTP Library API ---
    // Endpoint validation: GET /kicad/v1/
    .get("/kicad/v1/", (c) => {
      return c.json(getKicadRoot());
    })
    // Fetch categories: GET /kicad/v1/categories.json
    .get("/kicad/v1/categories.json", async (c) => {
      const categories = await getKicadCategories(c.get("db"));
      return c.json(categories);
    })
    // KiCad uses .json suffix on URLs. We handle this with wildcard routes.
    // Fetch parts for category: GET /kicad/v1/parts/category/:id.json
    .get("/kicad/v1/parts/category/*", async (c) => {
      const path = c.req.path;
      const match = path.match(/\/kicad\/v1\/parts\/category\/(.+?)(?:\.json)?$/);
      if (!match) return c.json([], 200);
      const categoryId = match[1];
      const parts = await getKicadPartsForCategory(c.get("db"), categoryId);
      return c.json(parts);
    })
    // Fetch part detail: GET /kicad/v1/parts/:id.json
    // Must come after /parts/category/* to avoid route conflicts
    .get("/kicad/v1/parts/*", async (c) => {
      const path = c.req.path;
      const match = path.match(/\/kicad\/v1\/parts\/(.+?)(?:\.json)?$/);
      if (!match) return c.json({ error: "not_found", message: "Invalid path" }, 404);
      const partId = match[1];
      // Skip if this is a category path (handled above)
      if (partId.startsWith("category/")) return c.notFound();
      const detail = await getKicadPartDetail(c.get("db"), partId);
      if (!detail) {
        return c.json({ error: "not_found", message: `Part ${partId} not found` }, 404);
      }
      return c.json(detail);
    });

  return app;
}

function getDefaultAttachmentsDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
  const dir = `${home}/.tray/attachments`;
  try {
    Deno.mkdirSync(dir, { recursive: true });
  } catch {
    // Already exists
  }
  return dir;
}

/** The Hono app type for RPC client inference */
export type AppType = ReturnType<typeof buildRoutes>;

/**
 * Create a Hono app with all routes and db middleware.
 * Adds global error handling for unhandled exceptions.
 */
export function createApp(db: Kysely<Database>, attachmentsDir?: string): AppType {
  const dir = attachmentsDir ?? getDefaultAttachmentsDir();
  const app = buildRoutes(db, dir);

  // Global error handler: catch unhandled throws, return structured JSON
  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[tray] Unhandled error: ${message}`);
    return c.json({ error: "server_error", message }, 500);
  });

  // 404 handler for unknown routes
  app.notFound((c) => {
    return c.json(
      { error: "not_found", message: `Route not found: ${c.req.method} ${c.req.path}` },
      404,
    );
  });

  return app;
}
