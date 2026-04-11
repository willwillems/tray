/**
 * Database schema types (Kysely) and input validation schemas (Zod v4).
 *
 * Kysely Database interface = source of truth for DB schema.
 * Zod schemas = source of truth for input validation.
 *
 * Design decisions applied:
 * - Manufacturer is freeform text on Part (no Manufacturer table)
 * - Hybrid stock: Part.stock field + optional StockLot rows for multi-location
 * - Tags use a part_tags junction table (not JSON array)
 * - Config via @std/toml
 */

import type { Generated, Insertable, Selectable, Updateable } from "kysely";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Kysely Database Interface
// ---------------------------------------------------------------------------

export interface Database {
  categories: CategoryTable;
  parts: PartTable;
  part_tags: PartTagTable;
  stock_lots: StockLotTable;
  storage_locations: StorageLocationTable;
  suppliers: SupplierTable;
  supplier_parts: SupplierPartTable;
  price_breaks: PriceBreakTable;
  part_parameters: PartParameterTable;
  attachments: AttachmentTable;
  projects: ProjectTable;
  bom_lines: BomLineTable;
  build_orders: BuildOrderTable;
  purchase_orders: PurchaseOrderTable;
  po_lines: PoLineTable;
  users: UserTable;
  audit_log: AuditLogTable;
}

// ---------------------------------------------------------------------------
// Table Interfaces
// ---------------------------------------------------------------------------

export interface CategoryTable {
  id: Generated<number>;
  name: string;
  parent_id: number | null;
  description: string | null;
  reference_prefix: string | null;
}

export interface PartTable {
  id: Generated<number>;
  name: string;
  description: string | null;
  category_id: number | null;
  template_id: number | null;
  is_template: number; // SQLite boolean (0/1)
  keywords: string | null;
  footprint: string | null;
  manufacturer: string | null; // freeform text, no FK
  mpn: string | null;
  ipn: string | null;
  manufacturing_status: string; // active, discontinued, eol, unknown
  stock: number; // cached sum of lots, or direct value if no lots
  min_stock: number;
  favorite: number; // SQLite boolean (0/1)
  datasheet_url: string | null;
  kicad_symbol_id: string | null;
  kicad_footprint: string | null;
  thumbnail: string | null; // base64 JPEG
  created_at: string;
  updated_at: string;
}

/** Junction table for part tags */
export interface PartTagTable {
  id: Generated<number>;
  part_id: number;
  tag: string;
}

export interface StockLotTable {
  id: Generated<number>;
  part_id: number;
  location_id: number | null;
  quantity: number;
  status: string; // ok, damaged, quarantined, returned
  expiry_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StorageLocationTable {
  id: Generated<number>;
  name: string;
  parent_id: number | null;
  description: string | null;
}

export interface SupplierTable {
  id: Generated<number>;
  name: string;
  url: string | null;
  notes: string | null;
}

export interface SupplierPartTable {
  id: Generated<number>;
  part_id: number;
  supplier_id: number;
  sku: string | null;
  url: string | null;
  notes: string | null;
}

export interface PriceBreakTable {
  id: Generated<number>;
  supplier_part_id: number;
  min_quantity: number;
  price: number;
  currency: string;
}

export interface PartParameterTable {
  id: Generated<number>;
  part_id: number;
  key: string;
  value: string;
  value_numeric: number | null;
  unit: string | null;
}

export interface AttachmentTable {
  id: Generated<number>;
  entity_type: string;
  entity_id: number;
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  hash: string;
  type: string;
  source_url: string | null;
  created_at: string;
}

export interface ProjectTable {
  id: Generated<number>;
  name: string;
  description: string | null;
  status: string; // active, archived
}

export interface BomLineTable {
  id: Generated<number>;
  project_id: number;
  part_id: number;
  quantity_required: number;
  reference_designators: string | null;
  notes: string | null;
}

export interface BuildOrderTable {
  id: Generated<number>;
  project_id: number;
  quantity: number;
  status: string; // draft, allocated, complete, cancelled
  created_at: string;
  completed_at: string | null;
}

export interface PurchaseOrderTable {
  id: Generated<number>;
  supplier_id: number;
  status: string; // draft, ordered, partial, received, cancelled
  notes: string | null;
  created_at: string;
}

export interface PoLineTable {
  id: Generated<number>;
  purchase_order_id: number;
  supplier_part_id: number;
  quantity_ordered: number;
  quantity_received: number;
  unit_price: number | null;
  currency: string | null;
}

export interface UserTable {
  id: Generated<number>;
  username: string;
  role: string; // admin, editor, viewer
  token_hash: string | null;
}

export interface AuditLogTable {
  id: Generated<number>;
  timestamp: string;
  user: string | null;
  entity_type: string;
  entity_id: number;
  action: string; // create, update, delete
  old_values: string | null; // JSON
  new_values: string | null; // JSON
}

// ---------------------------------------------------------------------------
// Derived Types
// ---------------------------------------------------------------------------

export type Category = Selectable<CategoryTable>;
export type NewCategory = Insertable<CategoryTable>;
export type CategoryUpdate = Updateable<CategoryTable>;

export type Part = Selectable<PartTable>;
export type NewPart = Insertable<PartTable>;
export type PartUpdate = Updateable<PartTable>;

export type PartTag = Selectable<PartTagTable>;

export type StockLot = Selectable<StockLotTable>;
export type NewStockLot = Insertable<StockLotTable>;
export type StockLotUpdate = Updateable<StockLotTable>;

export type StorageLocation = Selectable<StorageLocationTable>;
export type NewStorageLocation = Insertable<StorageLocationTable>;
export type StorageLocationUpdate = Updateable<StorageLocationTable>;

export type Supplier = Selectable<SupplierTable>;
export type NewSupplier = Insertable<SupplierTable>;

export type SupplierPart = Selectable<SupplierPartTable>;
export type NewSupplierPart = Insertable<SupplierPartTable>;

export type PriceBreak = Selectable<PriceBreakTable>;
export type NewPriceBreak = Insertable<PriceBreakTable>;

export type PartParameter = Selectable<PartParameterTable>;
export type NewPartParameter = Insertable<PartParameterTable>;

export type Attachment = Selectable<AttachmentTable>;
export type NewAttachment = Insertable<AttachmentTable>;

export type Project = Selectable<ProjectTable>;
export type NewProject = Insertable<ProjectTable>;

export type BomLine = Selectable<BomLineTable>;
export type NewBomLine = Insertable<BomLineTable>;

export type BuildOrder = Selectable<BuildOrderTable>;
export type NewBuildOrder = Insertable<BuildOrderTable>;

export type PurchaseOrder = Selectable<PurchaseOrderTable>;
export type NewPurchaseOrder = Insertable<PurchaseOrderTable>;

export type PoLine = Selectable<PoLineTable>;
export type NewPoLine = Insertable<PoLineTable>;

export type User = Selectable<UserTable>;
export type AuditLogEntry = Selectable<AuditLogTable>;

// ---------------------------------------------------------------------------
// Zod Input Schemas
// ---------------------------------------------------------------------------

export const manufacturingStatusEnum = z.enum([
  "active",
  "discontinued",
  "eol",
  "unknown",
]);

export const createPartSchema = z.object({
  name: z.string().min(1, "Part name is required"),
  description: z.string().optional(),
  category: z.string().optional(), // slash-delimited path, resolved server-side
  category_id: z.number().int().positive().optional(),
  template_id: z.number().int().positive().optional(),
  is_template: z.boolean().default(false),
  tags: z.array(z.string()).optional(),
  keywords: z.string().optional(),
  footprint: z.string().optional(),
  manufacturer: z.string().optional(),
  mpn: z.string().optional(),
  ipn: z.string().optional(),
  manufacturing_status: manufacturingStatusEnum.default("unknown"),
  min_stock: z.number().int().min(0).default(0),
  favorite: z.boolean().default(false),
  datasheet_url: z.string().url().optional(),
  kicad_symbol_id: z.string().optional(),
  kicad_footprint: z.string().optional(),
  // Parameters can be provided inline on creation
  parameters: z
    .array(
      z.object({
        key: z.string().min(1),
        value: z.string().min(1),
        unit: z.string().optional(),
      }),
    )
    .optional(),
  // Stock can be provided inline for quick add
  stock: z.number().min(0).optional(),
  location: z.string().optional(), // slash-delimited path, resolved server-side
});

/** Output type (after Zod parsing, defaults applied) */
export type CreatePartInput = z.infer<typeof createPartSchema>;
/** Input type (before Zod parsing, defaults optional) */
export type CreatePartRawInput = z.input<typeof createPartSchema>;

export const updatePartSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: z.string().optional(),
  category_id: z.number().int().positive().nullable().optional(),
  template_id: z.number().int().positive().nullable().optional(),
  is_template: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  keywords: z.string().nullable().optional(),
  footprint: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  mpn: z.string().nullable().optional(),
  ipn: z.string().nullable().optional(),
  manufacturing_status: manufacturingStatusEnum.optional(),
  min_stock: z.number().int().min(0).optional(),
  favorite: z.boolean().optional(),
  datasheet_url: z.string().url().nullable().optional(),
  kicad_symbol_id: z.string().nullable().optional(),
  kicad_footprint: z.string().nullable().optional(),
});

export type UpdatePartInput = z.infer<typeof updatePartSchema>;

export const createCategorySchema = z.object({
  name: z.string().min(1, "Category name is required"),
  parent_id: z.number().int().positive().nullable().optional(),
  description: z.string().optional(),
  reference_prefix: z.string().optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  parent_id: z.number().int().positive().nullable().optional(),
  description: z.string().nullable().optional(),
  reference_prefix: z.string().nullable().optional(),
});

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const listPartsSchema = z.object({
  category: z.string().optional(),
  category_id: z.coerce.number().int().positive().optional(),
  tag: z.string().optional(),
  low: z.coerce.boolean().optional(),
  favorites: z.coerce.boolean().optional(),
  manufacturer: z.string().optional(),
  search: z.string().optional(),
  param: z.string().optional(), // "key>=value" format
  limit: z.coerce.number().int().positive().default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListPartsInput = z.infer<typeof listPartsSchema>;
export type ListPartsRawInput = z.input<typeof listPartsSchema>;

export const stockAdjustSchema = z.object({
  part_id: z.number().int().positive(),
  quantity: z.number(),
  location: z.string().optional(),
  location_id: z.number().int().positive().optional(),
  reason: z.string().min(1, "Reason is required for stock adjustments"),
  status: z.enum(["ok", "damaged", "quarantined", "returned"]).default("ok"),
  expiry_date: z.string().optional(),
});

export type StockAdjustInput = z.infer<typeof stockAdjustSchema>;

export const createLocationSchema = z.object({
  path: z.string().min(1, "Location path is required"), // slash-delimited
  description: z.string().optional(),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
