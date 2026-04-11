/**
 * @tray/core -- public exports.
 *
 * Core never imports from api, cli, or web. Data flows inward only.
 */

// Database
export { setupDb } from "./db.ts";
export { NodeSqliteDialect } from "./dialect.ts";

// Blob Storage
export type { BlobStore } from "./storage.ts";
export { FsBlobStore } from "./storage-fs.ts";
export { MemoryBlobStore } from "./storage-memory.ts";

// Schema types and Zod schemas
export type {
  AuditLogEntry,
  Attachment,
  BomLine,
  BuildOrder,
  Category,
  CreateCategoryInput,
  CreatePartInput,
  CreatePartRawInput,
  Database,
  ListPartsInput,
  ListPartsRawInput,
  NewAttachment,
  NewBomLine,
  NewBuildOrder,
  NewPurchaseOrder,
  NewStockLot,
  NewSupplier,
  NewSupplierPart,
  Part,
  PartParameter,
  PartTag,
  PartUpdate,
  PoLine,
  PriceBreak,
  Project,
  PurchaseOrder,
  StockAdjustInput,
  StockLot,
  StorageLocation,
  Supplier,
  SupplierPart,
  UpdateCategoryInput,
  UpdatePartInput,
  User,
} from "./schema.ts";

export {
  createCategorySchema,
  createPartSchema,
  listPartsSchema,
  updateCategorySchema,
  updatePartSchema,
} from "./schema.ts";

// Parts
export { clearPartThumbnail, createPart, deletePart, getPart, listParts, setPartThumbnail, updatePart } from "./parts.ts";
export type { PartWithDetails } from "./parts.ts";

// Categories
export {
  createCategory,
  deleteCategory,
  getCategory,
  getCategoryPath,
  getCategoryTree,
  listCategories,
  resolveOrCreateCategoryPath,
  updateCategory,
} from "./categories.ts";
export type { CategoryTreeNode } from "./categories.ts";

// Audit
export { getAuditEntry, queryAuditLog } from "./audit.ts";

// Search
export {
  listAllTags,
  searchParts,
} from "./search.ts";
export type { SearchResult } from "./search.ts";

// Parameters
export {
  parseParameterValue,
  parseParametricFilter,
} from "./parameters.ts";

// Stock
export {
  addStock,
  adjustStock,
  moveStock,
  getStockLots,
} from "./stock.ts";
export type { StockLotWithLocation } from "./stock.ts";

// Locations
export {
  deleteLocation,
  getLocation,
  getLocationPath,
  getLocationTree,
  listLocations,
} from "./locations.ts";
export type { LocationTreeNode } from "./locations.ts";

// Suppliers
export {
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
} from "./suppliers.ts";
export type {
  SupplierPartWithDetails,
  SupplierWithPartCount,
} from "./suppliers.ts";

// Attachments
export {
  deleteAttachment,
  generateThumbnail,
  getAttachment,
  listAttachments,
  readAttachmentFile,
  storeAttachment,
} from "./attachments.ts";

// Projects + BOM + Builds
export {
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
} from "./projects.ts";
export type {
  BomLineWithDetails,
  BuildOrderWithDetails,
  ProjectWithBom,
} from "./projects.ts";

// Purchase Orders
export {
  addPoLine,
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  receivePOLine,
  resolveSupplier,
  updatePoLine,
  updatePurchaseOrder,
  updatePurchaseOrderStatus,
} from "./purchase_orders.ts";
export type {
  AddPoLineResult,
  PoLineWithDetails,
  PurchaseOrderWithDetails,
} from "./purchase_orders.ts";

// KiCad HTTP Library
export {
  getKicadCategories,
  getKicadPartDetail,
  getKicadPartsForCategory,
  getKicadRoot,
} from "./kicad.ts";
export type {
  KicadCategory,
  KicadFieldValue,
  KicadPartDetail,
  KicadPartSummary,
  KicadRoot,
} from "./kicad.ts";

// Import/Export
export {
  exportParts,
  importKicadBom,
  importPartsFromCsv,
  importPartsFromJson,
} from "./import_export.ts";
export type { ExportOptions, ImportResult } from "./import_export.ts";

// Backup/Restore
export { createBackup, restoreBackup } from "./backup.ts";

// Plugins
export { PluginEngine, createPluginEngine, loadPluginConfig } from "./plugins.ts";
export type {
  CommandHandler,
  MiddlewareHandler,
  PluginContext,
  TrayConfig,
  TrayPlugin,
} from "./plugins.ts";
