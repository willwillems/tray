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

## API Routes

All routes are defined in `packages/api/src/router.ts` as a single Hono chain (required for RPC type inference).

### Parts
| Method | Path | Description |
|---|---|---|
| POST | `/api/parts` | Create a part |
| GET | `/api/parts` | List/filter parts |
| GET | `/api/parts/:id` | Get part by ID or name |
| PATCH | `/api/parts/:id` | Update a part |
| DELETE | `/api/parts/:id` | Delete a part |
| GET | `/api/parts/:id/suppliers` | Supplier parts for a part |
| GET | `/api/parts/:id/best-price` | Best price across suppliers |

### Stock
| Method | Path | Description |
|---|---|---|
| POST | `/api/stock/add` | Add stock (create/merge lot) |
| POST | `/api/stock/adjust` | Adjust with reason |
| POST | `/api/stock/move` | Move between locations |
| GET | `/api/stock/:part_id` | List lots for a part |

### Categories & Locations
| Method | Path | Description |
|---|---|---|
| GET | `/api/categories` | List categories |
| GET | `/api/categories/tree` | Full category tree |
| POST | `/api/categories` | Create category |
| GET | `/api/locations` | List locations |
| GET | `/api/locations/tree` | Full location tree |

### Suppliers
| Method | Path | Description |
|---|---|---|
| POST | `/api/suppliers` | Create supplier |
| GET | `/api/suppliers` | List suppliers |
| GET | `/api/suppliers/:id` | Get supplier |
| POST | `/api/supplier-parts` | Link part to supplier |

### Projects & Builds
| Method | Path | Description |
|---|---|---|
| POST | `/api/projects` | Create project |
| GET | `/api/projects` | List projects |
| GET | `/api/projects/:id` | Get project with BOM |
| POST | `/api/projects/:id/bom` | Add BOM line |
| GET | `/api/projects/:id/check` | Check BOM availability |
| POST | `/api/builds` | Create build order |
| POST | `/api/builds/:id/complete` | Complete build (deduct stock) |

### Attachments
| Method | Path | Description |
|---|---|---|
| POST | `/api/attachments` | Upload file (multipart) |
| GET | `/api/attachments/:id` | Get metadata |
| GET | `/api/attachments/:id/file` | Download file |
| DELETE | `/api/attachments/:id` | Delete attachment |

### KiCad
| Method | Path | Description |
|---|---|---|
| GET | `/kicad/v1/` | Endpoint validation |
| GET | `/kicad/v1/categories.json` | Categories for Symbol Chooser |
| GET | `/kicad/v1/parts/category/:id.json` | Parts in a category |
| GET | `/kicad/v1/parts/:id.json` | Full part detail |

### Other
| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/api/search?q=...` | Full-text search |
| GET | `/api/tags` | All tags with counts |
| GET | `/api/audit` | Query audit log |

## Testing

216 tests across three layers:

- **Core unit tests** (`packages/core/tests/`): test domain functions directly with in-memory SQLite
- **API integration tests** (`packages/api/tests/`): test Hono routes via `app.fetch()` (no real server)
- **KiCad contract tests**: validate responses against the exact JSON schema KiCad expects

Every test gets its own `setupDb(":memory:")`. No shared state, no fixtures, no cleanup.

```bash
deno task test          # All 216 tests (~1 second)
deno task test:core     # Core only
deno task test:api      # API only
deno task check         # Type checking
deno task lint          # Linting
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
