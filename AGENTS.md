# Tray -- Agent Development Guide

This document describes how to work on Tray effectively as an AI coding agent. Read `SPEC.md` for the full project specification.

---

## Core Design Philosophy

**The CLI is always an HTTP client. The server is always the authority.**

Every operation -- whether from the CLI, the web UI, or a remote client -- goes through the same Hono HTTP API. The CLI never touches the database directly. The CLI never writes files to the attachments directory. The CLI never generates thumbnails. The server does all of that.

In local mode, the server is booted in-process for each command (~2ms overhead). In remote mode, the server is at a URL. The CLI code is identical in both cases -- it just points the Hono RPC client (`hc`) at a different URL.

```
CLI (always an HTTP client)
  |
  |  POST /api/parts  { name: "NE555", ... }
  |  POST /api/attachments  (multipart file upload)
  |  GET  /api/parts?category=ICs
  v
Server (Hono, always the authority)
  |
  |  Validates input (Zod)
  |  Calls core logic
  |  Reads/writes SQLite (Kysely)
  |  Stores/serves attachment files
  |  Generates thumbnails (ImageScript)
  v
SQLite + filesystem
```

**Why this matters for development:** There is exactly one code path for every operation. If you implement a feature, you implement it in `core/` (logic) and `api/` (route). The CLI is just a thin adapter that parses flags, calls the API, and formats output. Never add business logic in `cli/`.

---

## Package Boundaries

```
packages/
  core/    Imports: nothing from other packages. Only Kysely, Zod, node:sqlite.
  api/     Imports: core. Never cli, never web.
  cli/     Imports: api types only (for hc<ApiType>). Never core directly.
  web/     Imports: api types only (for hc<ApiType>). Never core directly.
```

**The one rule:** Core never imports from api, cli, or web. Data flows inward only.

If you find yourself importing from `@parts/core` in the CLI, stop. The CLI talks to the API. The API talks to core. The CLI never talks to core.

---

## Module Patterns

Every domain module in `core/` follows the same shape:

```typescript
// packages/core/src/parts.ts
export async function createPart(db: Kysely<Database>, input: NewPart): Promise<Part> { ... }
export async function listParts(db: Kysely<Database>, filter?: PartFilter): Promise<Part[]> { ... }
export async function getPart(db: Kysely<Database>, id: number): Promise<Part | undefined> { ... }
export async function updatePart(db: Kysely<Database>, id: number, input: PartUpdate): Promise<Part> { ... }
export async function deletePart(db: Kysely<Database>, id: number): Promise<void> { ... }
```

- Every function takes `db` as first parameter (for test isolation)
- Every function takes a Zod-validated typed input
- Every function returns a typed output
- No side effects beyond the database
- No global state

Every API route follows the same shape:

```typescript
// packages/api/src/routes/parts.ts
.post("/", zValidator("json", newPartSchema), async (c) => {
  const input = c.req.valid("json");
  const result = await createPart(db, input);
  return c.json(result, 201);
})
```

Every CLI command follows the same shape:

```typescript
// packages/cli/src/commands/add.ts
new Command()
  .description("Add a part")
  .arguments("<name:string>")
  .option("--stock <qty:integer>", "Initial stock", { default: 0 })
  .action(async (options, name) => {
    const client = await getClient();
    const res = await client.parts.$post({ json: { name, stock: options.stock } });
    const part = await res.json();
    output(part);
  });
```

When adding a new feature, follow these patterns exactly. An agent should be able to scaffold new modules mechanically.

---

## Testing Strategy

Tray is designed for thorough, fast, isolated testing. Every test uses an in-memory SQLite database that is created and destroyed per test. No shared state. No fixtures. No Docker. No cleanup.

### Test Layers

**Layer 1: Core unit tests** (`packages/core/`)
- Test domain functions directly
- Each test gets its own `initDb(":memory:")`
- Pure input/output, no HTTP

**Layer 2: API integration tests** (`packages/api/`)
- Test Hono routes via `app.request()` (no real HTTP server)
- Each test gets its own app instance with fresh in-memory DB
- Tests validation, routing, status codes, response shapes

**Layer 3: CLI end-to-end tests** (`packages/cli/`)
- Run the actual CLI binary against a temp database file
- Parse JSON output (`--format json`) for assertions
- Tests the full stack: CLI parsing -> HTTP -> server -> core -> SQLite -> response -> output

**Layer 4: KiCad contract tests** (`packages/api/`)
- Verify KiCad HTTP Library API responses match the exact contract KiCad expects
- All values as strings, correct JSON structure, correct endpoint paths

**Layer 5: Scenario tests** (top-level `tests/`)
- Multi-step business workflow tests
- e.g. "add parts, create project, import BOM, check stock, create build order, complete build, verify stock deducted"
- Run via CLI e2e for maximum coverage

### JSON Output as Assertion Interface

Every CLI command supports `--format json`. This is the primary assertion mechanism for e2e tests. An agent should never parse table output or regex match strings. Use `--format json` and parse the structured response:

```typescript
const output = await run(`tray show "NE555" --format json`, { db });
const part = JSON.parse(output);
assertEquals(part.stock, 20);
```

### Error Output

When `--format json` is active, errors are also structured JSON on stderr:

```json
{"error": "not_found", "message": "No part found matching 'DOESNT_EXIST'"}
```

Check exit codes (0 = success, 1 = error) and parse stderr for error details.

### Database as Ground Truth

For any test, you can bypass the API and query SQLite directly to verify state:

```typescript
const db = new DatabaseSync(dbPath);
const rows = db.prepare("SELECT * FROM parts WHERE name = ?").all("NE555");
```

This gives two verification paths: CLI output AND direct database query. If they disagree, that's a bug.

### Running Tests

```bash
deno task test:core       # Core unit tests
deno task test:api        # API integration tests
deno task test:e2e        # CLI end-to-end tests
deno task test:kicad      # KiCad contract tests
deno task test:scenarios  # Workflow scenario tests
deno task test            # All of the above
deno task check           # Type checking (deno check)
deno task lint            # Linting (deno lint)
```

All tests run against in-memory SQLite. The entire suite should finish in under 30 seconds.

---

## Attachment Handling

Attachments (images, datasheets, CAD files) are always handled through the API, never directly by the CLI.

**Upload flow (same for local and remote):**
1. CLI reads file from disk
2. CLI sends `POST /api/attachments` (multipart form data)
3. Server receives file, computes sha256 hash
4. Server stores file at `~/.tray/attachments/{first-2-chars}/{hash}.{ext}` (content-addressed, dedup by hash)
5. Server inserts metadata row in Attachment table
6. If image + attached to a Part: server generates 128x128 JPEG thumbnail via ImageScript, stores as base64 on `Part.thumbnail`
7. Server returns attachment metadata as JSON

**Download flow:**
- Local mode: `GET /api/attachments/:id/file` reads from local disk, streams response
- Remote mode: same endpoint, CLI streams to temp file or pipes to stdout

The CLI never touches `~/.tray/attachments/` directly. The server is the only writer.

---

## Thumbnail Pipeline

Thumbnails are base64-encoded 128x128 JPEG images stored inline on the `Part.thumbnail` column (~2-5KB each). They are included in every list/search API response for zero-cost display.

Generation uses ImageScript (`deno.land/x/imagescript`, 148KB, pure TS + embedded WASM codecs):

```typescript
import { decode } from "imagescript";
const img = await decode(fileBytes);
const thumb = img.resize(128, 128);
const jpeg = await thumb.encodeJPEG(65);
const base64 = btoa(String.fromCharCode(...jpeg));
// Store base64 on Part.thumbnail
```

~50ms per image. Happens once on upload. Never on read.

---

## Key Conventions

- **ISO 8601 for all timestamps.** Stored as TEXT in SQLite. `new Date().toISOString()`.
- **Zod schemas define the source of truth** for input validation. Shared between API routes and any other validation point.
- **Kysely `Database` interface defines the source of truth** for the database schema. All table types are inferred from this interface.
- **Content-addressed attachment storage.** Files named by sha256 hash. Dedup is automatic.
- **Audit log on every mutation.** Every create/update/delete records old_values and new_values as JSON in the audit_log table.
- **SI prefix parsing** for part parameters: p, n, u/µ, m, k, M, G. Parsed to numeric on insert, stored alongside the raw text value.
- **FTS5 index** on parts (name, description, manufacturer, mpn, ipn, tags, keywords). Kept in sync via SQLite triggers.

---

## What NOT to Do

- Do NOT add business logic in `cli/`. The CLI is a thin HTTP client + output formatter.
- Do NOT import `@parts/core` in `cli/` or `web/`. Only `api/` imports core.
- Do NOT use global/singleton database connections. Pass `db` as a parameter for test isolation.
- Do NOT store file content in SQLite. Files go on disk, metadata goes in the database, thumbnails (small, derived) go inline on Part.
- Do NOT parse CLI table output in tests. Use `--format json`.
- Do NOT skip the audit log. Every mutation must be logged.
- Do NOT assume local mode. The CLI code should work identically whether the server is in-process or remote.
