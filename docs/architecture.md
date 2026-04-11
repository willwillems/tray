# Architecture

## Design Philosophy

**The CLI is always an HTTP client. The server is always the authority.**

Every operation goes through the Hono HTTP API. In local mode, the server is booted in-process for each command (~2ms overhead). In remote mode, the server is at a URL. The CLI code is identical in both cases.

```
CLI (HTTP client)         Server (Hono)              SQLite + Filesystem
  |                         |                           |
  |  POST /api/parts        |                           |
  |  { name: "NE555" }  --> |  Validate (Zod)           |
  |                         |  Call core logic           |
  |                         |  Write to database ------> |
  |                         |  Return JSON               |
  |  <-- 201 { id: 1 ... }  |                           |
```

This gives you exactly one code path for every operation. The CLI, the web UI, and any external client all use the same API.

## Package Structure

```
packages/
  core/     Domain logic only. No HTTP awareness. Imports: Kysely, Zod.
  api/      Hono routes with Zod validation. Imports: core.
  cli/      Cliffy commands + Hono RPC client. Imports: api types only.
```

**The one rule:** data flows inward. `core` never imports from `api` or `cli`. The CLI never imports from `core` directly -- it talks to the API.

## Database

SQLite via Deno's built-in `node:sqlite` module, accessed through a custom Kysely dialect (`packages/core/src/dialect.ts`). This bridges the synchronous `DatabaseSync` API to Kysely's async interface.

Key database features:
- **WAL mode** for concurrent reads
- **FTS5** for full-text search (synced via triggers)
- **Stock cache trigger** keeps `Part.stock` in sync with `SUM(stock_lots.quantity)`
- **Foreign keys ON** with cascade deletes
- **Content-addressed attachments** on disk, metadata in SQLite

### Schema

17 tables. Source of truth: `packages/core/src/schema.ts` (Kysely `Database` interface).

```
categories          -- Hierarchical tree (parent_id self-ref)
parts               -- Core entity, stock cached via trigger
part_tags           -- Junction table (part_id, tag)
stock_lots          -- Quantity at a location with status
storage_locations   -- Hierarchical tree
suppliers           -- Vendor (name, url)
supplier_parts      -- Links parts to suppliers (SKU)
price_breaks        -- Quantity-based pricing tiers
part_parameters     -- Key/value with SI-parsed numeric
attachments         -- File metadata (content on disk)
projects            -- Things you build
bom_lines           -- Bill of materials for a project
build_orders        -- Consume BOM, deduct stock
purchase_orders     -- Replenish stock from suppliers
po_lines            -- Lines on a purchase order
users               -- Multi-user (serve mode only)
audit_log           -- Every mutation logged
```

## Attachment Storage (BlobStore)

Attachment file content is stored via a `BlobStore` interface, not directly on disk. The default implementation is `FsBlobStore`, which writes to `~/.tray/blobs/`. Storage is content-addressed: files are named by their sha256 hash, so identical files are automatically deduplicated.

```typescript
interface BlobStore {
  /** Store a blob by key. Overwrites if key already exists. */
  put(key: string, data: Uint8Array): Promise<void>;
  /** Read a blob by key. Throws if not found. */
  get(key: string): Promise<Uint8Array>;
  /** Check if a blob exists by key. */
  has(key: string): Promise<boolean>;
  /** Delete a blob by key. No-op if not found. */
  delete(key: string): Promise<void>;
  /** Compute SHA-256 hash of data, return lowercase hex string. */
  hash(data: Uint8Array): Promise<string>;
}
```

The Hono app is created via `createApp(db, { blobs?: BlobStore })`. The Hono context carries `db: Kysely<Database>` and `blobs: BlobStore` -- routes access these via `c.var.db` and `c.var.blobs`. The old `attachments_dir: string` approach has been replaced by this abstraction.

The CLI never touches the blob store. Upload and download always go through the API. The server handles hashing, dedup, thumbnail generation, and streaming.

## API Routes

All routes are defined in `packages/api/src/router.ts` as a single Hono chain (required for RPC type inference).

### Parts
| Method | Path | Description |
|---|---|---|
| GET | `/api/parts` | List/filter parts |
| POST | `/api/parts` | Create a part |
| GET | `/api/parts/:id` | Get part by ID or name |
| PATCH | `/api/parts/:id` | Update a part |
| DELETE | `/api/parts/:id` | Delete a part |
| PUT | `/api/parts/:id/thumbnail` | Set thumbnail from attachment |
| DELETE | `/api/parts/:id/thumbnail` | Clear thumbnail |
| GET | `/api/parts/:id/suppliers` | Supplier parts for a part |
| GET | `/api/parts/:id/best-price` | Best price across suppliers |

### Categories
| Method | Path | Description |
|---|---|---|
| GET | `/api/categories` | List categories |
| POST | `/api/categories` | Create category |
| POST | `/api/categories/resolve` | Resolve/create category path |
| GET | `/api/categories/:id` | Get category with path |
| PATCH | `/api/categories/:id` | Update category |
| DELETE | `/api/categories/:id` | Delete category (re-parents children) |
| GET | `/api/categories/tree` | Full category tree |

### Search & Tags
| Method | Path | Description |
|---|---|---|
| GET | `/api/search?q=...` | Full-text search (FTS5) |
| GET | `/api/tags` | All tags with counts |

### Stock & Locations
| Method | Path | Description |
|---|---|---|
| POST | `/api/stock/add` | Add stock (create/merge lot) |
| POST | `/api/stock/adjust` | Adjust with reason |
| POST | `/api/stock/move` | Move between locations |
| GET | `/api/stock/:part_id` | List lots for a part |
| GET | `/api/locations` | List locations |
| GET | `/api/locations/tree` | Location tree |
| GET | `/api/locations/:id` | Get location with path |
| DELETE | `/api/locations/:id` | Delete location |

### Suppliers
| Method | Path | Description |
|---|---|---|
| POST | `/api/suppliers` | Create supplier |
| GET | `/api/suppliers` | List suppliers |
| GET | `/api/suppliers/:id` | Get supplier |
| PATCH | `/api/suppliers/:id` | Update supplier |
| DELETE | `/api/suppliers/:id` | Delete supplier |
| POST | `/api/supplier-parts` | Link part to supplier |
| GET | `/api/suppliers/:id/parts` | Parts for a supplier |
| DELETE | `/api/supplier-parts/:id` | Unlink part from supplier |

### Attachments
| Method | Path | Description |
|---|---|---|
| POST | `/api/attachments` | Upload file (multipart) |
| GET | `/api/attachments/:id` | Get metadata |
| GET | `/api/attachments/:id/file` | Download file |
| GET | `/api/attachments?entity_type=...&entity_id=...` | List attachments for entity |
| DELETE | `/api/attachments/:id` | Delete attachment |

### Projects & BOM
| Method | Path | Description |
|---|---|---|
| POST | `/api/projects` | Create project |
| GET | `/api/projects` | List projects |
| GET | `/api/projects/:id` | Get project with BOM |
| PATCH | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| POST | `/api/projects/:id/bom` | Add BOM line |
| GET | `/api/projects/:id/bom` | Get BOM lines |
| DELETE | `/api/bom-lines/:id` | Remove BOM line |
| GET | `/api/projects/:id/check` | Check BOM availability |

### Builds
| Method | Path | Description |
|---|---|---|
| POST | `/api/builds` | Create build order |
| POST | `/api/builds/:id/complete` | Complete build (deduct stock) |
| GET | `/api/builds` | List build orders |

### Purchase Orders
| Method | Path | Description |
|---|---|---|
| POST | `/api/purchase-orders` | Create PO |
| GET | `/api/purchase-orders` | List POs |
| GET | `/api/purchase-orders/:id` | Get PO with lines |
| PATCH | `/api/purchase-orders/:id` | Update PO |
| POST | `/api/purchase-orders/:id/lines` | Add PO line |
| PATCH | `/api/po-lines/:id` | Update PO line |
| POST | `/api/po-lines/:id/receive` | Receive PO line (adds stock) |

### KiCad HTTP Library
| Method | Path | Description |
|---|---|---|
| GET | `/kicad/v1/` | Root (schema info) |
| GET | `/kicad/v1/categories.json` | Categories for Symbol Chooser |
| GET | `/kicad/v1/parts/:category.json` | Parts in a category |
| GET | `/kicad/v1/parts/:id.json` | Full part detail |

### Other
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/audit` | Query audit log |
| GET | `/api/audit/:id` | Get audit entry |

## Testing

Tests across five layers:

- **Core unit tests** (`packages/core/tests/`): test domain functions directly with in-memory SQLite
- **API integration tests** (`packages/api/tests/`): test Hono routes via `app.fetch()` (no real server)
- **CLI end-to-end tests** (`packages/cli/`): run the actual CLI binary against a temp database, assert on `--format json` output
- **KiCad contract tests** (`packages/api/tests/`): validate responses against the exact JSON schema KiCad expects
- **Scenario tests** (top-level `tests/`): multi-step business workflow tests (add parts, create project, import BOM, build, verify stock)

Every test gets its own `setupDb(":memory:")`. No shared state, no fixtures, no cleanup.

```bash
deno task test            # All tests
deno task test:core       # Core only
deno task test:api        # API only
deno task test:e2e        # CLI end-to-end
deno task test:kicad      # KiCad contract tests
deno task test:scenarios  # Workflow scenario tests
deno task check           # Type checking
deno task lint            # Linting
```

## Development

### Adding a New Feature

1. Add the domain function in `packages/core/src/` (takes `db` as first parameter)
2. Write tests in `packages/core/tests/`
3. Add the API route in `packages/api/src/router.ts`
4. Write API tests in `packages/api/tests/`
5. Add the CLI command in `packages/cli/src/commands/`
6. Export from `packages/core/src/mod.ts`
7. Register the command in `packages/cli/src/mod.ts`

### Conventions

- **ISO 8601 timestamps** stored as TEXT in SQLite
- **Zod schemas** define input validation, Kysely interfaces define the DB schema
- **Every mutation** creates an audit log entry with old/new values
- **SI prefix parsing** for parameters (p, n, u, m, k, M, G)
- **Content-addressed** attachment storage (sha256 hash as filename)
- **`--format json`** on every CLI command for scriptability

### Tech Stack

| Component | Technology |
|---|---|
| Runtime | Deno 2+ |
| Database | SQLite via `node:sqlite` (built into Deno) |
| Query builder | Kysely with custom `NodeSqliteDialect` |
| HTTP framework | Hono |
| RPC client | Hono `hc` with full type inference |
| Validation | Zod v4 |
| CLI framework | Cliffy |
| Image processing | ImageScript (128x128 JPEG thumbnails) |
| Dependencies | 100% JSR, zero npm |
| Binary size | ~75MB (Deno compiled) |
| Startup time | ~50ms (compiled), ~200ms (Deno runtime) |
