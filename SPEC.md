# Tray -- Specification

**CLI-first inventory management for makers.**

Domain: tray.parts
Target audience: Makers, hobbyists, home makers, small teams (1-5 people), makerspaces

---

## 1. Vision & Vibe

Tray is the inventory tool you actually want to use. It should feel like `git` -- fast, composable, invisible infrastructure. The CLI is the product. The web UI is a convenience. Everything that takes a web form in Part-DB or InvenTree should be a single command.

**Design principles:**
- Zero to productive in 30 seconds
- One command, not five clicks
- Smart defaults everywhere (base currency from locale, categories auto-created, locations auto-parented)
- Never lose data (every change logged and revertable)
- Works offline, works alone, works in a team -- same tool scales without config changes
- Respect the terminal (pretty when interactive, machine-readable when piped, fast always)
- Single binary, single file database, no infrastructure

**What we're NOT building:**
- Not an ERP system. Not SAP. Not for factories.
- Not a SaaS platform. No multi-tenancy.
- Not a full accounting system. No invoices, payments, or taxes.
- No workflow approvals ("approve this PO" -- just order it).
- No Gantt charts, scheduling, or project management.
- No complex role-based permissions. Admin/editor/viewer is enough.

---

## 2. Competitive Context

### Part-DB (github.com/Part-DB/Part-DB-server)
- PHP/Symfony, Bootstrap, MySQL/SQLite/PostgreSQL. ~1.5k stars, AGPL-3.0.
- Strong on: footprint tracking (hierarchical with images/3D), parametric search, KiCad integration (built-in HTTP library), distributor auto-fetch (Octopart, DigiKey, LCSC, Mouser, Farnell, TME), webcam barcode scanner, audit log with full versioning and revert, 2FA (TOTP + WebAuthn).
- Weak on: no purchase orders, no build orders, no manufacturing, no serial tracking, no plugin system, no mobile app.
- Data model: Part, Category (tree), Storage Location (tree), Footprint (tree, with images/3D), Supplier, Manufacturer, Part Lot, Purchase Information with nested Price Information, Parameters, Measurement Unit, Currency, Attachment, Attachment Type, User, Group, Project (BOM), Label Profile, Event Log.

### InvenTree (github.com/inventree/inventree)
- Python/Django, React/TypeScript, PostgreSQL/MySQL/SQLite. ~6.7k stars, MIT.
- Strong on: full procurement lifecycle (PO -> receive -> track -> SO -> ship), multi-level BOMs, build orders with stock allocation, serial/batch tracking, test templates and results, rich plugin system (Python, pip installable, event/export/label/notification/currency mixins), mobile app (iOS + Android), comprehensive REST API + Python client library, OAuth2/OIDC.
- Weak on: no built-in EDA/KiCad integration (plugin only), no built-in distributor auto-fetch (plugin only), no webcam barcode scanner, no version history/revert for parts, heavy web UI (full React SPA).
- Data model: Part (with template/variant/virtual/assembly/component/trackable/testable/purchaseable/salable flags), Part Category (tree), Stock Item (with serial, batch, status, expiry, per-item tracking), Stock Location (tree, with types), Supplier, Supplier Part, Manufacturer, Manufacturer Part, Purchase Order, Sales Order, Return Order, Customer, BOM, Build Order, Stock Allocation, Test Template, Test Result, Report Template, Label Template, Plugin.

### Tray's Position
Neither competitor is CLI-first. Both require a web server, a database server, and browser-based interaction for all operations. Tray takes the useful data model from both (Part-DB's parametric search and audit log, InvenTree's procurement lifecycle and BOMs) and delivers it as a fast, local-first CLI tool with an optional web UI.

---

## 3. Architecture

### 3.1 The CLI Is Always an HTTP Client

This is the most important architectural decision in the project.

Every operation goes through the Hono HTTP API. The CLI never touches the database directly. The CLI never writes files to the attachments directory. The CLI never generates thumbnails. The server does all of that.

In local mode, the server is booted in-process for each command (~2ms overhead). In remote mode, the server is at a URL. The CLI code is identical in both cases.

```
$ tray list --category "ICs"

  1. Init SQLite via node:sqlite (~1ms)
  2. Start Hono server on random localhost port (~0.6ms)
  3. Create hc<ApiType> typed client (~0.1ms)
  4. Client calls GET /api/parts?category=ICs
  5. Hono route handler calls core logic -> Kysely -> SQLite
  6. Return typed result, render to terminal
  7. Server shuts down

  Total overhead: ~2ms
  Total wall clock (compiled binary): ~50ms

$ tray attach 1 ./photo.jpg --type image

  1. Boot in-process server (same as above)
  2. CLI reads file, sends POST /api/attachments (multipart)
  3. Server stores file, generates thumbnail, inserts metadata
  4. Return attachment metadata, render to terminal
  5. Server shuts down
```

**Why one code path matters:**
- Zero duplication between local and remote mode
- Every feature (including file uploads, thumbnail generation, validation) is implemented once, in the server
- The web UI, CLI, and any future client all use the same API
- Testing is straightforward -- test the API, and all clients are tested
- `tray serve` (persistent server for web UI, KiCad HTTP library, remote access) requires zero changes to core or API code

**Why not a background daemon (Option A):**
We prototyped both. A background server doesn't save time because Deno's module loading (~50ms compiled) happens on the CLI client side regardless. The in-process server boots in ~2ms. The bottleneck is runtime startup, not server startup.

**Why not direct core import (no server):**
We want a local web UI. If a web UI exists, a server must exist. Once a server exists, the CLI might as well use it too. One code path is simpler than two. The ~2ms overhead is undetectable. And critically: if the CLI could bypass the server for some operations (like file storage), you'd end up with two implementations of the same logic.

### 3.2 Package Structure

```
packages/
  core/              # Domain logic + database. No HTTP, no terminal awareness.
    schema.ts        # Kysely Database interface + Zod input schemas
    dialect.ts       # node:sqlite custom dialect for Kysely (~100 lines)
    db.ts            # Connection factory + table creation / migrations
    parts.ts         # Part domain: CRUD, search, parametric filter
    stock.ts         # Stock domain: lots, adjustments, movements
    locations.ts     # Location domain: tree operations
    suppliers.ts     # Supplier domain: links, pricing
    attachments.ts   # Attachment domain: metadata CRUD, thumbnail generation
    projects.ts      # Project/BOM domain
    builds.ts        # Build order domain
    orders.ts        # Purchase order domain
    audit.ts         # Audit log: record, query, revert
    search.ts        # FTS5 index management, fuzzy fallback
    mod.ts           # Public exports

  api/               # Hono HTTP server. Imports core, exports typed routes.
    router.ts        # Main API routes with Zod validation, exports ApiType
    attachments.ts   # Attachment upload/download routes (multipart + file streaming)
    kicad.ts         # KiCad HTTP Library API (4 endpoints)
    server.ts        # Server lifecycle (start/stop/health)
    mod.ts

  cli/               # Cliffy commands + Hono RPC client. Imports api types only.
    commands/        # One file per command group
      add.ts
      list.ts
      show.ts
      search.ts
      stock.ts
      location.ts
      supplier.ts
      attach.ts      # Attachment upload/download/list/open/rm
      bom.ts
      build.ts
      po.ts
      log.ts
      status.ts
      import.ts
      export.ts
      serve.ts
      remote.ts
      plugin.ts
      init.ts
    output/          # Rendering: tables, JSON, CSV, color
      table.ts
      format.ts
    client.ts        # hc<ApiType> typed client factory
    daemon.ts        # Find/start local server, manage pid
    mod.ts           # Cliffy command tree + entry point

  web/               # SPA served as static files by api
    (later)
```

**The one rule:** Core never imports from api, cli, or web. Data flows inward only.

### 3.3 Remote Mode

The CLI always talks to a server via HTTP. In local mode, that server is in-process. In remote mode, it's a URL:

```toml
# ~/.config/tray/config.toml

# Local mode (default)
[database]
path = "~/.tray/data.db"

# Remote mode
[remote]
url = "https://tray.our-makerspace.org"
token = "sk_abc123"
```

```
tray remote connect https://tray.our-makerspace.org
tray remote disconnect
tray remote status
```

No code changes in CLI commands. The client factory checks config and points `hc` at the right URL.

### 3.4 Database Portability

Kysely's dialect system means the same query code runs against SQLite (local, embedded via `node:sqlite`) or PostgreSQL (remote, via Kysely's built-in `PostgresDialect`). The dialect is a config choice, not a code change. A custom `NodeSqliteDialect` (~100 lines) bridges Deno's built-in `node:sqlite` (synchronous `DatabaseSync` API) to Kysely's async `Dialect` interface.

---

## 4. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | **Deno** | Built-in SQLite (`node:sqlite`), `deno compile` for single binary, permissions model, JSR-native |
| Database | **node:sqlite** (built into Deno) | Zero external deps, works with `deno compile`, synchronous, compiled into the Deno binary itself |
| Query builder | **Kysely** (JSR) | Type-safe SQL query builder (not ORM), dialect-swappable (SQLite now, Postgres later), 6.3MB, clean custom dialect system |
| HTTP server | **Hono** (JSR) | Ultrafast, Deno-native, built-in typed RPC client (`hc`), Zod validator middleware |
| Type safety | **Hono RPC** (`hc`) | End-to-end type safety from route definition to client call. Zero extra packages. Same value prop as tRPC but built into Hono |
| Validation | **Zod** (JSR) | Input validation on API routes via `@hono/zod-validator`, shared schema definitions |
| CLI framework | **Cliffy** (JSR) | Deno-native, subcommands, shell completions (bash/zsh/fish), prompts, tables |
| Image processing | **ImageScript** (deno.land/x) | 148KB total, pure TS + tiny embedded WASM codecs, resize + JPEG encode for thumbnails |
| Monorepo | **Deno workspaces** | Native workspace support via `deno.json`, no Turborepo or extra tooling |
| Distribution | **`deno compile`** | Single binary, cross-platform (macOS, Linux, Windows), embeds runtime + deps + app code |

### All dependencies (zero npm):
```json
{
  "@hono/hono": "jsr:@hono/hono@^4",
  "@hono/zod-validator": "jsr:@hono/zod-validator@^0.7",
  "zod": "jsr:@zod/zod@^4",
  "kysely": "jsr:@kysely/kysely@^0.28",
  "@cliffy/command": "jsr:@cliffy/command@^1.0.0"
}
```

### Decisions and alternatives considered

**Why Kysely over Drizzle ORM:**
Both work with `node:sqlite`. Drizzle needed a hacky `.raw()` monkey-patch on `node:sqlite`'s `StatementSync` to emulate `better-sqlite3`. Kysely uses a proper custom `Dialect` extensibility point (~100 lines, one-time write). Drizzle also pulled in 81MB of embedded dependencies (adapters for Postgres, MySQL, PlanetScale, Neon, libsql all bundled) vs Kysely's 6.5MB. Compiled binary: 146MB (Drizzle) vs 74MB (Kysely). Kysely's query API also reads closer to raw SQL which fits a project with simple queries.

**Why Hono RPC over tRPC:**
Prototyped with tRPC first. It works but: per-operation latency was ~1.8ms (batch link protocol, serialization, middleware chain) vs ~0.2ms for Hono's native RPC -- nearly 10x slower. tRPC also requires npm packages (`@trpc/server`, `@trpc/client`, `@hono/trpc-server`) that break the all-JSR goal. Hono's `hc` client provides the same end-to-end type inference with zero extra packages. The tradeoff: Hono RPC returns `Response` objects (need `.json()` call), tRPC returns data directly. Hono forces HTTP method thinking (`$get`, `$post`), tRPC has explicit `.query()` / `.mutate()`. For this project, the performance win and dependency simplicity outweigh tRPC's slightly cleaner client API. REST compatibility (curl, Python, any HTTP client) comes free with Hono.

**Why Deno over Bun:**
Both work. Deno was chosen for: built-in `node:sqlite` that works with `deno compile` (Bun's SQLite also works but Deno's `node:sqlite` is compiled into the binary, zero FFI), JSR-native package management (no npm required at all), permission model (nice security story for remote mode). Bun would also work -- the architecture is runtime-agnostic.

**Why not Go or Rust for the CLI shell:**
Evaluated Charm ecosystem (Bubble Tea, Lip Gloss, Huh), Ratatui, Cobra, Clap. Go/Rust would give faster startup (~5-20ms vs ~50ms compiled Deno) and better TUI rendering. But: introduces a language boundary that doubles maintenance, breaks the shared-core pattern (would need IPC between Go/Rust CLI and TypeScript core), and 50ms is below the human perception threshold for "instant." One language = faster iteration for a small team. Can reconsider for a dedicated TUI dashboard mode later.

**Why in-process server over background daemon:**
A background daemon doesn't save time. Deno's module loading (~50ms compiled) happens on the client side regardless. The in-process server boots in ~2ms. The server is not the bottleneck.

---

## 5. Data Model

### Part
- `id` INTEGER PRIMARY KEY
- `name` TEXT NOT NULL
- `description` TEXT (markdown)
- `category_id` INTEGER -> Category
- `template_id` INTEGER -> Part (nullable, for variants inheriting from a template)
- `is_template` BOOLEAN DEFAULT FALSE
- `tags` TEXT (JSON array, user-defined organizational labels: "smd", "made to order", "project-x")
- `keywords` TEXT (space-separated search terms: "resistor thick film chip" -- also served as KiCad keywords in HTTP library API)
- `footprint` TEXT (human-readable: "0805", "DIP-8", "SOT-23")
- `manufacturer` TEXT
- `mpn` TEXT (manufacturer part number)
- `ipn` TEXT (internal part number, user-defined)
- `manufacturing_status` TEXT (active, discontinued, eol, unknown)
- `min_stock` INTEGER DEFAULT 0 (threshold for low stock alerts)
- `favorite` BOOLEAN DEFAULT FALSE
- `datasheet_url` TEXT (nullable, URL to manufacturer datasheet)
- `kicad_symbol_id` TEXT (nullable, KiCad symbol library reference e.g. "Device:R", "MCU_Microchip_ATmega:ATmega328P-AU")
- `kicad_footprint` TEXT (nullable, full KiCad footprint library reference e.g. "Resistor_SMD:R_0603_1608Metric")
- `thumbnail` TEXT (nullable, base64-encoded 128x128 JPEG, ~2-5KB. Auto-generated when first image attachment is added.)
- `created_at` TEXT NOT NULL (ISO 8601)
- `updated_at` TEXT NOT NULL (ISO 8601)

### Category
- `id` INTEGER PRIMARY KEY
- `name` TEXT NOT NULL
- `parent_id` INTEGER -> Category (nullable, self-referencing tree)
- `description` TEXT
- `reference_prefix` TEXT (nullable, e.g. "R" for resistors, "C" for capacitors, "U" for ICs -- used as KiCad reference designator prefix, inherited by parts in this category)

### Stock Lot
- `id` INTEGER PRIMARY KEY
- `part_id` INTEGER NOT NULL -> Part
- `location_id` INTEGER -> Storage Location
- `quantity` REAL NOT NULL (decimal for non-discrete parts: meters of wire, grams of paste)
- `status` TEXT NOT NULL DEFAULT 'ok' (ok, damaged, quarantined, returned)
- `expiry_date` TEXT (nullable, ISO 8601, for perishable materials: solder paste, flux, adhesives)
- `notes` TEXT
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

Note: "stock" on a Part is always a computed sum of its lots. Never stored directly on Part.

### Storage Location
- `id` INTEGER PRIMARY KEY
- `name` TEXT NOT NULL
- `parent_id` INTEGER -> Storage Location (nullable, self-referencing tree)
- `description` TEXT

### Supplier
- `id` INTEGER PRIMARY KEY
- `name` TEXT NOT NULL
- `url` TEXT
- `notes` TEXT

### Supplier Part
- `id` INTEGER PRIMARY KEY
- `part_id` INTEGER NOT NULL -> Part
- `supplier_id` INTEGER NOT NULL -> Supplier
- `sku` TEXT (supplier's part number)
- `url` TEXT (direct product page link)
- `notes` TEXT

### Price Break
- `id` INTEGER PRIMARY KEY
- `supplier_part_id` INTEGER NOT NULL -> Supplier Part
- `min_quantity` INTEGER NOT NULL
- `price` REAL NOT NULL
- `currency` TEXT NOT NULL DEFAULT 'USD'

### Manufacturer
- `id` INTEGER PRIMARY KEY
- `name` TEXT NOT NULL
- `url` TEXT

### Part Parameter
- `id` INTEGER PRIMARY KEY
- `part_id` INTEGER NOT NULL -> Part
- `key` TEXT NOT NULL (e.g. "resistance", "capacitance", "voltage_max")
- `value` TEXT NOT NULL (as entered: "10k", "4.7uF", "50V")
- `value_numeric` REAL (parsed: 10000, 0.0000047, 50 -- for range queries)
- `unit` TEXT (normalized: "ohm", "farad", "volt" -- for unit-aware comparisons)

SI prefix parsing: p=10^-12, n=10^-9, u/µ=10^-6, m=10^-3, k=10^3, M=10^6, G=10^9. Parsing happens on insert/update. Covers 95% of electronics values.

### Attachment
- `id` INTEGER PRIMARY KEY
- `entity_type` TEXT NOT NULL (part, location, supplier, project)
- `entity_id` INTEGER NOT NULL
- `filename` TEXT NOT NULL (original filename: "NE555-datasheet.pdf")
- `storage_key` TEXT NOT NULL (content-addressed path: "a3/f2c8e9.pdf")
- `mime_type` TEXT NOT NULL ("application/pdf", "image/jpeg", "image/png")
- `size_bytes` INTEGER NOT NULL
- `hash` TEXT NOT NULL (sha256, for dedup and integrity)
- `type` TEXT NOT NULL (datasheet, image, note, cad, other)
- `source_url` TEXT (nullable, original URL if downloaded -- preserved for reference and re-fetch)
- `created_at` TEXT NOT NULL

### Project
- `id` INTEGER PRIMARY KEY
- `name` TEXT NOT NULL
- `description` TEXT
- `status` TEXT NOT NULL DEFAULT 'active' (active, archived)

### BOM Line
- `id` INTEGER PRIMARY KEY
- `project_id` INTEGER NOT NULL -> Project
- `part_id` INTEGER NOT NULL -> Part
- `quantity_required` REAL NOT NULL (per single unit of the project)
- `reference_designators` TEXT (e.g. "R1, R2, R3")
- `notes` TEXT

### Build Order
- `id` INTEGER PRIMARY KEY
- `project_id` INTEGER NOT NULL -> Project (which has the BOM)
- `quantity` INTEGER NOT NULL (how many units to build)
- `status` TEXT NOT NULL DEFAULT 'draft' (draft, allocated, complete, cancelled)
- `created_at` TEXT NOT NULL
- `completed_at` TEXT

Flow: draft -> allocated (stock reserved) -> complete (stock deducted) or cancelled (allocation released).
A build order is always tied to a project. You can't build without a BOM.

### Purchase Order
- `id` INTEGER PRIMARY KEY
- `supplier_id` INTEGER NOT NULL -> Supplier
- `status` TEXT NOT NULL DEFAULT 'draft' (draft, ordered, partial, received, cancelled)
- `notes` TEXT
- `created_at` TEXT NOT NULL

Flow: draft -> ordered (you placed the order) -> partial (some items arrived) -> received (all arrived) or cancelled.
A purchase order is tied to a supplier, not a project. The connection to builds is indirect: build depletes stock, low stock triggers PO.

### PO Line
- `id` INTEGER PRIMARY KEY
- `purchase_order_id` INTEGER NOT NULL -> Purchase Order
- `supplier_part_id` INTEGER NOT NULL -> Supplier Part
- `quantity_ordered` INTEGER NOT NULL
- `quantity_received` INTEGER NOT NULL DEFAULT 0
- `unit_price` REAL
- `currency` TEXT

### User
- `id` INTEGER PRIMARY KEY
- `username` TEXT NOT NULL UNIQUE
- `role` TEXT NOT NULL DEFAULT 'editor' (admin, editor, viewer)
- `token_hash` TEXT

For multi-user `tray serve` mode only. Single-user local mode has no users.

### Audit Log
- `id` INTEGER PRIMARY KEY
- `timestamp` TEXT NOT NULL (ISO 8601)
- `user` TEXT
- `entity_type` TEXT NOT NULL
- `entity_id` INTEGER NOT NULL
- `action` TEXT NOT NULL (create, update, delete)
- `old_values` TEXT (JSON)
- `new_values` TEXT (JSON)

### FTS5 Index
```sql
CREATE VIRTUAL TABLE parts_fts USING fts5(
  name, description, manufacturer, mpn, ipn, tags, keywords,
  content='parts',
  content_rowid='id'
);
```
Kept in sync via triggers on insert/update/delete of the parts table.

### Entity Relationships

```
Category (tree) ─────────── Part ─────────── Part Parameter
  (reference_prefix)          │  (thumbnail)       (key/value/numeric/unit)
                              │
                  Part Template ──── Part Variant
                              │
                              ├──── Stock Lot ─── Storage Location (tree)
                              │       (qty, status, expiry)
                              │
                              ├──── Supplier Part ─── Supplier
                              │       └── Price Break
                              │
                              ├──── Attachment (metadata in DB, files on disk)
                              │       (content-addressed, sha256, dedup)
                              │
                              └──── BOM Line ─── Project
                                                   └── Build Order

Supplier ─── Purchase Order
               └── PO Line ─── Supplier Part

Part ──── FTS5 Index (name, description, manufacturer, mpn, ipn, tags, keywords)
```

---

## 6. Features

### 6.1 Parts & Categories
- Add/edit/remove parts with all fields. Markdown in descriptions.
- Hierarchical categories with auto-create parents: `tray add "NE555" --category "ICs/Timers"` creates both "ICs" and "Timers" if they don't exist.
- Part templates: define a template (e.g. "0805 Resistor") and create variants (10k, 22k, 47k) that inherit the template's properties (footprint, category, KiCad symbol, parameters). Variants can override inherited values.
- Tags for user-defined organizational grouping ("smd", "made to order", "project-x"). Used for filtering: `tray list --tag "smd"`.
- Keywords for search discoverability ("resistor thick film chip"). Also served as KiCad keywords in the HTTP library API.
- Favorite/pin parts. `tray list --favorites`.
- Internal part number (IPN), optional. For users with their own numbering scheme.
- Part parameters with SI unit parsing (see Search section).
- Manufacturing status: active, discontinued, eol, unknown.
- KiCad fields: `kicad_symbol_id`, `kicad_footprint`, `datasheet_url`. Optional, only needed for KiCad integration.

### 6.2 Stock
- Multi-lot: a part can exist in multiple locations with different quantities. "Stock" on a part is always the sum of its lots.
- Operations: add (`tray stock add`), remove, adjust (`tray stock adjust --qty -5 --reason "used"`), move (`tray stock move <lot> --to "Shelf 2"`).
- Reason/note required on adjustments (for audit trail).
- Stock status per lot: ok, damaged, quarantined, returned.
- Expiry dates on lots for perishable materials (solder paste, flux, adhesives, chemicals). `tray stock list --expiring` shows lots nearing expiry.
- Min-stock threshold per part. `tray low` lists all parts below threshold.
- Interactive stocktake: `tray stocktake "Shelf 1"` walks through each lot at that location.

### 6.3 Storage Locations
- Hierarchical tree, slash-delimited: "Shelf 1/Drawer 3/Row A".
- Auto-create parents on first reference.
- `tray location tree` renders ASCII tree.
- Descriptions per location.

### 6.4 Suppliers & Pricing
- Supplier entities with name, URL, notes.
- Supplier Part links a Part to a Supplier with: SKU, product URL, notes.
- Price Breaks: quantity-based pricing tiers on each Supplier Part.
- Multi-currency with configurable base currency.
- `tray buy <part>` shows all supplier options sorted by unit price.

### 6.5 Manufacturers
- Manufacturer entities with name, URL.
- Linked to parts via `manufacturer` and `mpn` fields on Part.
- Distinct from suppliers (TI makes the NE555, DigiKey sells it).

### 6.6 Attachments & Thumbnails

Attachments are always handled through the API, never directly by the CLI. The same code path runs in local mode (in-process server) and remote mode (remote server). The server is the only thing that writes to the attachments directory.

**Storage:** Content-addressed on local disk at `~/.tray/attachments/{first-2-chars-of-hash}/{hash}.{ext}`. Deduplication is automatic -- if two parts have the same datasheet, it's stored once. The database stores metadata only (filename, hash, size, mime type, type).

**Upload flow (identical for local and remote mode):**
1. CLI reads file from disk
2. CLI sends `POST /api/attachments` (multipart form data)
3. Server receives file, computes sha256 hash
4. Server checks for existing file with same hash (dedup)
5. Server stores file at `~/.tray/attachments/{hash-prefix}/{hash}.{ext}`
6. Server inserts Attachment metadata row
7. If image + attached to a Part: server generates 128x128 JPEG thumbnail via ImageScript (~50ms), stores as base64 on `Part.thumbnail`
8. Server returns attachment metadata as JSON

**Download flow:**
- `GET /api/attachments/:id/file` streams the file from server disk
- In remote mode, CLI streams to temp file for `tray attach open` or pipes to stdout

**Thumbnails:** Base64-encoded 128x128 JPEG stored inline on `Part.thumbnail` (~2-5KB). Included in every list/search API response for zero-cost display. Generated automatically when first image attachment is added to a part. Regenerated via `tray attach set-preview <attachment-id>`. Uses ImageScript (148KB, pure TS + tiny WASM codecs, pipeline: decode -> resize Lanczos -> JPEG quality 65 -> base64).

**URL-only attachments:** `tray attach <part> --url <url> --type datasheet` stores just the link, no download. For datasheets you want to reference but not store.

**Downloaded attachments:** `tray attach <part> <url> --type datasheet` downloads the file AND stores `source_url` for reference and potential re-fetch.

**Types:** datasheet, image, note, cad, other.

**CLI commands:**
```
tray attach <part> ./photo.jpg --type image        # Upload local file
tray attach <part> https://ti.com/ne555.pdf --type datasheet  # Download + store
tray attach <part> --url https://ti.com/ne555.pdf --type datasheet  # Link only
tray attach set-preview <attachment-id>             # Regenerate thumbnail from this image
tray attachments <part>                             # List attachments
tray attach open <attachment-id>                    # Open in system viewer
tray attach rm <attachment-id>                      # Remove
```

**Web UI:** Thumbnails render as `<img src="data:image/jpeg;base64,...">` (inline, zero requests). Full images/files load via `<img src="/api/attachments/:id/file">` (standard HTTP, browser-cached).

### 6.7 Search & Filter

**Full-text search (FTS5):**
- `tray search "555 timer"` -- hits FTS5 index across name, description, manufacturer, mpn, ipn, tags, keywords.
- Supports: prefix matching (`NE55*`), phrase matching (`"voltage regulator"`), boolean operators (`voltage OR current`), relevance ranking.
- Sub-millisecond even with thousands of parts.

**Parametric search with SI unit parsing:**
- `tray list --param "resistance>=10k" --param "package=0805"`
- Part Parameters store both the raw text value ("10k") and a parsed numeric value (10000) + normalized unit ("ohm").
- SI prefix parsing on insert: p=10^-12, n=10^-9, u/µ=10^-6, m=10^-3, k=10^3, M=10^6, G=10^9.
- Range queries work across prefixes: "resistance >= 1k AND resistance <= 100k" correctly compares numeric values.

**Fuzzy matching:**
- Primary: FTS5 search.
- Fallback (zero FTS5 results): `LIKE '%query%'` scan with application-side Levenshtein/trigram ranking.
- Handles typos: "NE55" finds "NE555".

**Column filtering:**
- `tray list --category "ICs" --location "Drawer 3" --tag "smd" --low`
- Composable, all filters AND together.

### 6.8 Projects & BOMs
- Create projects: `tray project create "Amplifier v2"`.
- Add BOM lines manually: `tray bom add amplifier-v2 --component "NE555" --qty 1 --ref "U1"`.
- Import BOM from KiCad: `tray bom import amplifier-v2 --format kicad ./amplifier-v2.xml`. Matches by MPN, value+footprint, or symbol reference. Near-perfect matching when parts were placed from Tray's KiCad HTTP library.
- `tray bom show amplifier-v2 --check-stock` -- shows each line with available stock vs required.
- `tray bom check amplifier-v2 --qty 5` -- can I build 5? Shows shortages.
- `tray bom withdraw amplifier-v2 --qty 1` -- quick one-step stock deduction (no build order).
- Multi-level BOMs: a BOM line can reference another project (sub-assembly).
- `tray bom export amplifier-v2 --format csv|kicad`.

### 6.9 Build Orders
A build order is: "I'm making N units of this project. Deduct N x BOM from stock."

Always tied to a project (which has the BOM). The chain: Project -> BOM -> Build Order.

```
tray build create amplifier-v2 --qty 5    # Check stock, create draft
tray build allocate BUILD-0001             # Reserve stock (prevents double-use)
tray build complete BUILD-0001             # Deduct reserved stock, record history
```

Status flow: draft -> allocated -> complete (or cancelled, releasing allocation).

For solo makers who don't need allocation: `tray bom withdraw` is the one-step alternative.

A project can have many build orders over time. Each is a separate event with its own stock deductions and audit trail.

### 6.10 Purchase Orders
A purchase order is: "I ordered these parts from this supplier. Have they arrived?"

Tied to a supplier, NOT a project. The connection is indirect: build depletes stock -> `tray low` shows shortages -> create PO to restock.

```
tray po create --supplier "DigiKey"              # Draft PO
tray po add PO-0001 "NE555" --qty 20             # Add lines (auto-fills SKU + price)
tray po show PO-0001                              # Review with totals
tray po submit PO-0001                            # Mark as ordered
tray po receive PO-0001 --location "Incoming"     # Receive into stock
```

Status flow: draft -> ordered -> partial -> received (or cancelled).

Not accounting. No invoices. No payments. Just "did the package arrive?" and auto-stock-update on receive.

### 6.11 KiCad Integration

Two-way integration creating a tight design-to-inventory loop.

**Tray as a KiCad Symbol Library (HTTP Library):**

`tray serve` exposes a KiCad HTTP Library API at `/kicad-api/v1/`. User creates a `.kicad_httplib` file pointing at it:

```json
{
  "meta": { "version": 1.0 },
  "name": "My Tray Inventory",
  "source": {
    "type": "REST_API",
    "api_version": "v1",
    "root_url": "http://localhost:4827/kicad-api",
    "token": ""
  }
}
```

KiCad HTTP Library API (4 endpoints, all return JSON, all values as strings):

1. `GET /v1/` -> `{"categories": "", "parts": ""}` (endpoint validation)
2. `GET /v1/categories.json` -> `[{"id": "1", "name": "Resistors"}, ...]` (from Category table, `name` = full path for hierarchical categories)
3. `GET /v1/parts/category/{id}.json` -> `[{"id": "42", "name": "NE555", "description": "Timer IC"}, ...]` (lightweight, from Part table filtered by category_id)
4. `GET /v1/parts/{id}.json` -> full part detail:
   ```json
   {
     "id": "42",
     "name": "NE555",
     "symbolIdStr": "Timer:NE555",        // from Part.kicad_symbol_id
     "fields": {
       "footprint": {"value": "Package_DIP:DIP-8_W7.62mm", "visible": "False"},  // from Part.kicad_footprint
       "value": {"value": "NE555"},
       "reference": {"value": "U"},        // from Category.reference_prefix
       "datasheet": {"value": "https://...", "visible": "False"},  // from Part.datasheet_url
       "description": {"value": "Timer IC", "visible": "False"},
       "keywords": {"value": "timer oscillator", "visible": "False"},  // from Part.keywords
       "MPN": {"value": "NE555P", "visible": "False"}  // from Part.mpn
       // Part Parameters also mapped as custom fields
     }
   }
   ```

What it does in KiCad: Tray categories appear as library folders in the symbol chooser. Tray parts appear as selectable components. When placed, KiCad auto-fills footprint, value, MPN, datasheet, and all custom fields. You're designing from your actual inventory.

KiCad doesn't see stock levels. Stock awareness comes after design, via BOM import.

**KiCad BOM Import:**

After PCB design: export BOM from KiCad (XML/CSV) -> `tray bom import project --format kicad file.xml`. Since parts were placed from Tray's HTTP library, MPN and part ID are already in the schematic. Matching is near-perfect.

**The Full Loop:**
1. Manage parts in Tray (CLI)
2. Design PCB in KiCad (parts sourced from Tray via HTTP library)
3. Export BOM from KiCad
4. `tray bom import` links BOM to inventory
5. `tray bom check` shows what you have vs what you need
6. `tray po create` for missing parts
7. `tray po receive` when they arrive
8. `tray build create` to make it

### 6.12 Audit Log
- Every mutation logged: timestamp, user, entity type+id, action (create/update/delete), old_values JSON, new_values JSON.
- `tray log` -- filterable by `--part`, `--user`, `--since`.
- `tray log show <id>` -- full diff.
- `tray undo <log-id>` -- revert a single change by applying the inverse operation.

### 6.13 Import / Export
- CSV and JSON import/export for parts and other entities.
- Smart column mapping on import: interactive prompts in TTY, explicit `--column-map` flag in scripts.
- KiCad BOM import (covered in 6.8 / 6.11).
- `tray export --format csv --category "Resistors"` -- export filtered subsets.

### 6.14 Output & UX
- Auto-detect TTY: pretty tables with color when interactive, raw JSON when piped. Override with `--format json|csv|table`.
- Color-coded stock levels: green (ok), yellow (low / below min_stock), red (zero).
- Interactive prompts (via Cliffy) when required info is missing. Every prompt skippable with explicit flags for scriptability.
- Short aliases: `tray ls` = `tray list`, `tray mv` = `tray stock move`, `tray rm` = `tray remove`.
- `tray status` -- dashboard showing total parts, total stock value, low stock count, expiring lots, recent activity.
- Tab completion for bash, zsh, fish (via Cliffy's built-in completion).
- `tray init` -- guided setup ("What's your base currency?", "Where do you want the database?").

### 6.15 Web UI
- `tray serve` starts persistent Hono server: REST API + static SPA + KiCad HTTP Library.
- "Glance at it on a tablet in the workshop."
- Read-only by default, `tray serve --writable` enables mutations.
- Built into the compiled binary, no separate install.
- Framework TBD (likely SolidJS or React + lightweight component library).

### 6.16 Multi-User
- User accounts with roles: admin (full access), editor (read + write), viewer (read only).
- Token-based auth for API access.
- For `tray serve` in a makerspace/team setting.
- Per-user audit trail (audit log records which user made each change).

### 6.17 Plugins

**TypeScript plugins (Vite-style, config-as-code):**
- Plugins are TypeScript modules that export a function returning a `TrayPlugin` object.
- Registered in `~/.tray/config.ts` (TypeScript config file, like Vite/ESLint flat config).
- Plugins can: add custom CLI commands, hook into lifecycle events (fire-and-forget).
- Plugin context provides direct database access (`Kysely<Database>`) and the Hono RPC client.
- Plugin errors are logged but never block or crash the main operation.

**Plugin interface:**
```typescript
interface TrayPlugin {
  name: string;
  commands?: Record<string, CommandHandler>;
  onPartCreated?:    (ctx: PluginContext, part: PartWithDetails) => Promise<void>;
  onPartUpdated?:    (ctx: PluginContext, part: PartWithDetails, old: Part) => Promise<void>;
  onPartDeleted?:    (ctx: PluginContext, partId: number) => Promise<void>;
  onStockChanged?:   (ctx: PluginContext, partId: number, oldStock: number, newStock: number) => Promise<void>;
  onLowStock?:       (ctx: PluginContext, part: PartWithDetails) => Promise<void>;
  onBuildCompleted?: (ctx: PluginContext, buildOrder: BuildOrder) => Promise<void>;
}
```

**Config file (`~/.tray/config.ts`):**
```typescript
import type { TrayConfig } from "@tray/core";
import digikey from "./plugins/digikey.ts";
import slackNotify from "./plugins/slack.ts";

export default {
  plugins: [
    digikey({ apiKey: Deno.env.get("DIGIKEY_API_KEY")! }),
    slackNotify({ webhook: "https://hooks.slack.com/..." }),
  ],
} satisfies TrayConfig;
```

**Plugin examples (community/ecosystem):**
- Distributor auto-fetch (DigiKey, Mouser, LCSC, Octopart, Farnell, TME)
- Barcode/label printing (Brother, Dymo, Zebra -- too many printers for core)
- Barcode scanning (webcam, USB scanner, phone camera)
- EDA integrations (EasyEDA, Altium, Eagle)
- Notifications (email/webhook on low stock, PO received)
- Currency exchange rate auto-update
- Home Assistant / MQTT integration
- Sync/replication between machines

### 6.18 Data Storage & Backup

**Database:** SQLite by default, single file, zero config. Stored at `~/.tray/data.db` (global) or `.tray/data.db` (project-scoped, if `tray init` run in a directory). Thumbnails stored inline on Part rows. All structured data in the database.

**Attachments:** Full-size files stored on disk at `~/.tray/attachments/`, content-addressed by sha256 hash. The database stores metadata only. The server is the only writer.

**Backup:**
```
tray backup
  Creating backup...
  Database: ~/.tray/data.db (12MB)
  Attachments: ~/.tray/attachments/ (847MB, 234 files)
  Written to: ~/.tray/backups/tray-2026-04-01-143022.tar.gz

tray restore tray-2026-04-01-143022.tar.gz
  Restoring database... done
  Restoring 234 attachments... done
```

`tray backup` creates a tar.gz archive of `data.db` + `attachments/` directory. One command, one output file. `tray restore` extracts both. In remote mode, backup is a server-side operation (requires admin role).

---

## 7. CLI Command Reference

```
tray init                                          # Initialize database
tray add <name> [options]                          # Add a part
tray list [--category] [--tag] [--param] [--low]   # List/filter parts
tray show <id|name>                                # Part details
tray search <query>                                # Full-text + fuzzy search
tray edit <id> --field value                       # Edit a part
tray rm <id>                                       # Remove a part

tray stock add <part> --qty N --location <loc>     # Add stock
tray stock move <lot-id> --to <loc>                # Move stock
tray stock adjust <lot-id> --qty <delta> --reason  # Adjust stock
tray stock list [--part] [--location] [--expiring] # List stock lots
tray stocktake <location>                          # Interactive stocktake
tray low                                           # Parts below min_stock

tray location add <path>                           # Add location (auto-parents)
tray location tree                                 # ASCII tree view
tray location show <location>                      # Location details

tray supplier add <name> [--url]                   # Add supplier
tray supplier link <part> --supplier --sku --price # Link part to supplier
tray buy <part>                                    # Compare supplier prices

tray bom import <project> --format kicad <file>    # Import BOM from KiCad
tray bom add <project> --component <part> --qty N  # Manual BOM line
tray bom show <project> [--check-stock]            # View BOM
tray bom check <project> [--qty N]                 # Check buildability
tray bom withdraw <project> --qty N                # Quick stock deduct
tray bom export <project> --format csv|kicad       # Export BOM

tray build create <project> --qty N                # Create build order
tray build allocate <build>                        # Reserve stock
tray build complete <build>                        # Deduct and finish
tray build list                                    # Build history

tray po create --supplier <name>                   # Create purchase order
tray po add <po> <part> --qty N                    # Add PO line
tray po show <po>                                  # View PO with totals
tray po submit <po>                                # Mark as ordered
tray po receive <po> --location <loc>              # Receive into stock
tray po list                                       # PO history

tray attach <part> <file|url> --type <type>         # Add attachment
tray attach <part> --url <url> --type <type>       # Link URL only
tray attach set-preview <attachment-id>             # Set thumbnail source
tray attachments <part>                             # List attachments
tray attach open <attachment-id>                    # Open in system viewer
tray attach rm <attachment-id>                      # Remove attachment

tray log [--part] [--user] [--since]               # View audit log
tray undo <log-id>                                 # Revert a change

tray import <file.csv|json>                        # Import data
tray export [--format csv|json] [--category]       # Export data

tray status                                        # Dashboard
tray serve [--port 8080] [--writable]              # Start server
tray remote connect <url>                          # Connect to remote
tray remote disconnect                             # Back to local
tray remote status                                 # Show mode
tray backup                                        # Backup database
tray restore <backup>                              # Restore from backup

tray plugin add <url|path>                         # Install plugin
tray plugin list                                   # List plugins
tray plugin remove <name>                          # Remove plugin
```

All commands support `--format json|csv|table` to override output format.
All commands support `--help` for usage information.

---

## 8. Benchmarks

Measured on Apple Silicon, Deno 2.2.4, compiled binary. In-process server with `node:sqlite` + Kysely + Hono.

### Compiled Binary
| Metric | Value |
|---|---|
| Binary size | 74MB |
| Embedded application files | 6.5MB |
| Cold start (wall clock) | ~50ms |
| Boot (DB + server + client) | ~2ms |

### Per-Operation Latency
| Operation | avg | median | p95 |
|---|---|---|---|
| create (mutation) | 0.24ms | 0.21ms | 0.44ms |
| list 50 rows (query) | 0.29ms | 0.24ms | 0.41ms |
| get single (query) | 0.15ms | 0.13ms | 0.25ms |
| stock adjust (mutation) | 0.19ms | 0.17ms | 0.29ms |

### Evolution Through Prototyping
| Iteration | Binary | Embedded deps | Op Latency | npm packages |
|---|---|---|---|---|
| Drizzle + tRPC (all npm) | 146MB | 81MB | ~1.8ms | 6 |
| Kysely + tRPC (mixed) | 95MB | 31MB | ~1.7ms | 3 |
| **Kysely + Hono RPC (all JSR)** | **74MB** | **6.5MB** | **~0.2ms** | **0** |

---

## 9. Testing

Testing is a crucial part of this application. The architecture is designed to make thorough testing easy, fast, and natural.

**The CLI IS the test harness.** Most projects need a separate test framework to exercise the product. For Tray, the product itself is the test interface. `tray add "NE555" --format json` is both the user interface and the assertion mechanism. An agent can run the command, parse the JSON, and verify the operation worked. No special test infrastructure needed.

This is enabled by three architectural decisions: every command supports `--format json` for structured output, every error returns structured JSON on stderr with a non-zero exit code, and SQLite in-memory databases make test isolation trivial (fresh DB in <1ms, no cleanup).

### Suggested test layers

The architecture naturally supports multiple levels of testing. These are recommendations, not prescriptions:

- **Core unit tests** (`packages/core/`) -- test domain functions directly against in-memory SQLite. Pure input/output, no HTTP.
- **API integration tests** (`packages/api/`) -- test Hono routes via `app.request()` without a real HTTP server. Good for testing validation, status codes, response shapes.
- **CLI end-to-end tests** (`packages/cli/`) -- run the actual binary against a temp database, parse `--format json` output. Tests the full stack.
- **KiCad contract tests** -- verify the HTTP Library API responses exactly match KiCad's expected format (all values as strings, correct JSON structure).
- **Scenario tests** -- multi-step workflow tests covering real usage patterns (add parts, create project, import BOM, build, verify stock deducted).

---

## 10. Prototype

Working prototype at `~/projects/parts-latency-test`. Implements: Deno workspaces, Kysely + `node:sqlite` custom dialect, Hono API with typed routes + Zod validation, Hono RPC client (`hc`), Cliffy CLI with `add`, `list`, and `bench` commands. Persistent SQLite database. Compiles to single binary.

```bash
# Run from source
deno run -A packages/cli/src/mod.ts add "NE555" --stock 25 --location "Drawer 3"

# Compile to binary
deno compile -A --output ./tray packages/cli/src/mod.ts

# Use with persistent database
PARTS_DB=./inventory.db ./tray add "NE555" --description "Timer IC" --stock 25 --location "Drawer 3"
PARTS_DB=./inventory.db ./tray add "LM7805" --description "5V Regulator" --stock 10 --location "Shelf 1"
PARTS_DB=./inventory.db ./tray list

# Run benchmark
./tray bench --ops 200
```
