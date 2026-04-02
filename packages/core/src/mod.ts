/**
 * @tray/core -- public exports.
 *
 * Core never imports from api, cli, or web. Data flows inward only.
 */

// Database
export { setupDb } from "./db.ts";
export { NodeSqliteDialect } from "./dialect.ts";

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
  UpdatePartInput,
  User,
} from "./schema.ts";

export {
  createCategorySchema,
  createPartSchema,
  listPartsSchema,
  manufacturingStatusEnum,
  stockAdjustSchema,
  createLocationSchema,
  updatePartSchema,
} from "./schema.ts";

// Parts
export { createPart, deletePart, getPart, listParts, updatePart } from "./parts.ts";
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
export { getAuditEntry, queryAuditLog, recordAudit } from "./audit.ts";

// Search
export {
  getPartTags,
  listAllTags,
  searchParts,
  setPartTags,
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
  resolveOrCreateLocationPath,
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
  addPriceBreak,
  createSupplier,
  createSupplierPart,
  deleteSupplier,
  deleteSupplierPart,
  getBestPrice,
  getPriceBreaks,
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
  PluginContext,
  TrayConfig,
  TrayPlugin,
} from "./plugins.ts";
