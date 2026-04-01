/**
 * Database connection factory and table creation.
 *
 * Every function in core/ takes `db: Kysely<Database>` as first parameter
 * for test isolation. This module creates those instances.
 */

import { Kysely, sql } from "kysely";
import { DatabaseSync } from "node:sqlite";
import { NodeSqliteDialect } from "./dialect.ts";
import type { Database } from "./schema.ts";

/**
 * Initialize a Kysely instance backed by node:sqlite and create all tables.
 * Pass ":memory:" for tests, a file path for production.
 */
export async function setupDb(path: string): Promise<Kysely<Database>> {
  const sqlite = new DatabaseSync(path);

  // Enable WAL mode for better concurrent read performance
  if (path !== ":memory:") {
    sqlite.exec("PRAGMA journal_mode = WAL");
  }
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA busy_timeout = 5000");

  const db = new Kysely<Database>({
    dialect: new NodeSqliteDialect({ database: sqlite }),
  });

  // Create all tables, indexes, FTS5, and triggers
  for (const ddl of DDL_STATEMENTS) {
    await sql.raw(ddl).execute(db);
  }

  return db;
}

// ---------------------------------------------------------------------------
// DDL Statements
// ---------------------------------------------------------------------------

const DDL_STATEMENTS: string[] = [
  // Categories (tree)
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    description TEXT,
    reference_prefix TEXT
  )`,

  // Parts (hybrid stock: Part.stock field + optional lots)
  `CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    template_id INTEGER REFERENCES parts(id) ON DELETE SET NULL,
    is_template INTEGER NOT NULL DEFAULT 0,
    keywords TEXT,
    footprint TEXT,
    manufacturer TEXT,
    mpn TEXT,
    ipn TEXT,
    manufacturing_status TEXT NOT NULL DEFAULT 'unknown',
    stock INTEGER NOT NULL DEFAULT 0,
    min_stock INTEGER NOT NULL DEFAULT 0,
    favorite INTEGER NOT NULL DEFAULT 0,
    datasheet_url TEXT,
    kicad_symbol_id TEXT,
    kicad_footprint TEXT,
    thumbnail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Part Tags (junction table)
  `CREATE TABLE IF NOT EXISTS part_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    tag TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_part_tags_unique ON part_tags(part_id, tag)`,
  `CREATE INDEX IF NOT EXISTS idx_part_tags_tag ON part_tags(tag)`,

  // Storage Locations (tree) -- must come before stock_lots due to FK
  `CREATE TABLE IF NOT EXISTS storage_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES storage_locations(id) ON DELETE SET NULL,
    description TEXT
  )`,

  // Stock Lots (optional, for multi-location tracking)
  `CREATE TABLE IF NOT EXISTS stock_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    location_id INTEGER REFERENCES storage_locations(id) ON DELETE SET NULL,
    quantity REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    expiry_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Suppliers
  `CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT,
    notes TEXT
  )`,

  // Supplier Parts
  `CREATE TABLE IF NOT EXISTS supplier_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    sku TEXT,
    url TEXT,
    notes TEXT
  )`,

  // Price Breaks
  `CREATE TABLE IF NOT EXISTS price_breaks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_part_id INTEGER NOT NULL REFERENCES supplier_parts(id) ON DELETE CASCADE,
    min_quantity INTEGER NOT NULL,
    price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD'
  )`,

  // Part Parameters (SI unit parsing)
  `CREATE TABLE IF NOT EXISTS part_parameters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    value_numeric REAL,
    unit TEXT
  )`,

  // Attachments (metadata only, files on disk)
  `CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    hash TEXT NOT NULL,
    type TEXT NOT NULL,
    source_url TEXT,
    created_at TEXT NOT NULL
  )`,

  // Projects
  `CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active'
  )`,

  // BOM Lines
  `CREATE TABLE IF NOT EXISTS bom_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    quantity_required REAL NOT NULL,
    reference_designators TEXT,
    notes TEXT
  )`,

  // Build Orders
  `CREATE TABLE IF NOT EXISTS build_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`,

  // Purchase Orders
  `CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT,
    created_at TEXT NOT NULL
  )`,

  // PO Lines
  `CREATE TABLE IF NOT EXISTS po_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    supplier_part_id INTEGER NOT NULL REFERENCES supplier_parts(id) ON DELETE CASCADE,
    quantity_ordered INTEGER NOT NULL,
    quantity_received INTEGER NOT NULL DEFAULT 0,
    unit_price REAL,
    currency TEXT
  )`,

  // Users (multi-user serve mode only)
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'editor',
    token_hash TEXT
  )`,

  // Audit Log
  `CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    user TEXT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    old_values TEXT,
    new_values TEXT
  )`,

  // Stock cache triggers: keep Part.stock in sync with SUM(stock_lots.quantity)
  // These fire on every lot insert/update/delete and recompute the cached stock.
  `CREATE TRIGGER IF NOT EXISTS stock_lots_insert AFTER INSERT ON stock_lots BEGIN
    UPDATE parts SET stock = (
      SELECT COALESCE(SUM(quantity), 0) FROM stock_lots WHERE part_id = new.part_id AND status = 'ok'
    ) WHERE id = new.part_id;
  END`,

  `CREATE TRIGGER IF NOT EXISTS stock_lots_update AFTER UPDATE ON stock_lots BEGIN
    UPDATE parts SET stock = (
      SELECT COALESCE(SUM(quantity), 0) FROM stock_lots WHERE part_id = new.part_id AND status = 'ok'
    ) WHERE id = new.part_id;
  END`,

  `CREATE TRIGGER IF NOT EXISTS stock_lots_delete AFTER DELETE ON stock_lots BEGIN
    UPDATE parts SET stock = (
      SELECT COALESCE(SUM(quantity), 0) FROM stock_lots WHERE part_id = old.part_id AND status = 'ok'
    ) WHERE id = old.part_id;
  END`,

  // FTS5 Index for parts (tags indexed via part_tags join in search logic)
  `CREATE VIRTUAL TABLE IF NOT EXISTS parts_fts USING fts5(
    name, description, manufacturer, mpn, ipn, keywords,
    content='parts',
    content_rowid='id'
  )`,

  // FTS5 sync triggers
  `CREATE TRIGGER IF NOT EXISTS parts_fts_insert AFTER INSERT ON parts BEGIN
    INSERT INTO parts_fts(rowid, name, description, manufacturer, mpn, ipn, keywords)
    VALUES (new.id, new.name, new.description, new.manufacturer, new.mpn, new.ipn, new.keywords);
  END`,

  `CREATE TRIGGER IF NOT EXISTS parts_fts_update AFTER UPDATE ON parts BEGIN
    INSERT INTO parts_fts(parts_fts, rowid, name, description, manufacturer, mpn, ipn, keywords)
    VALUES ('delete', old.id, old.name, old.description, old.manufacturer, old.mpn, old.ipn, old.keywords);
    INSERT INTO parts_fts(rowid, name, description, manufacturer, mpn, ipn, keywords)
    VALUES (new.id, new.name, new.description, new.manufacturer, new.mpn, new.ipn, new.keywords);
  END`,

  `CREATE TRIGGER IF NOT EXISTS parts_fts_delete AFTER DELETE ON parts BEGIN
    INSERT INTO parts_fts(parts_fts, rowid, name, description, manufacturer, mpn, ipn, keywords)
    VALUES ('delete', old.id, old.name, old.description, old.manufacturer, old.mpn, old.ipn, old.keywords);
  END`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_parts_category ON parts(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_parts_template ON parts(template_id)`,
  `CREATE INDEX IF NOT EXISTS idx_parts_manufacturer ON parts(manufacturer)`,
  `CREATE INDEX IF NOT EXISTS idx_parts_mpn ON parts(mpn)`,
  `CREATE INDEX IF NOT EXISTS idx_parts_ipn ON parts(ipn)`,
  `CREATE INDEX IF NOT EXISTS idx_stock_lots_part ON stock_lots(part_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stock_lots_location ON stock_lots(location_id)`,
  `CREATE INDEX IF NOT EXISTS idx_part_parameters_part ON part_parameters(part_id)`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bom_lines_project ON bom_lines(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)`,
];
