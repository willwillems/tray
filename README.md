# Tray

CLI-first inventory management for makers.

```
tray add "NE555" --category "ICs/Timers" --stock 25 --location "Drawer 3"
tray add "LM7805" --category "ICs/Voltage Regulators" --stock 10 --location "Shelf 1"
tray list --low
tray search "555"
tray buy "NE555"
```

## What is Tray?

Tray is an inventory management tool built for makers, hobbyists, and small teams. It runs as a single binary with a local SQLite database. No servers to configure, no Docker, no web browser required.

Every operation is a CLI command. A web UI is available via `tray serve` for when you want a visual overview on a tablet in the workshop.

## Key Features

- **Parts with categories, tags, parameters, and images** -- organize your inventory the way you think about it
- **Multi-location stock tracking** -- know what you have, where it is, and when you're running low
- **Suppliers and pricing** -- track where to buy parts and compare prices
- **Projects and BOMs** -- define what you need to build, check stock, and deduct on completion
- **Purchase orders** -- track what you've ordered and receive parts into stock
- **Build orders** -- allocate and deduct stock when building projects
- **KiCad integration** -- use your inventory as a KiCad symbol library, import BOMs back
- **Full audit log** -- every change is logged and revertable with `tray undo`
- **Parametric search** -- find parts by specs: `tray list --param "resistance>=10k"`
- **Plugin system** -- extend with scripts in any language

## Architecture

Tray uses an in-process HTTP server for every command. The CLI is always an HTTP client talking to a Hono server, whether that server is local (booted in-process, ~2ms) or remote (`tray remote connect <url>`).

This means:
- The CLI, web UI, and any external client all use the same API
- Every feature is implemented once, in the server
- Local and remote mode use identical code paths

See [SPEC.md](./SPEC.md) for the full specification and [AGENTS.md](./AGENTS.md) for development guidelines.

## Tech Stack

| | |
|---|---|
| Runtime | Deno |
| Database | SQLite (node:sqlite, built into Deno) |
| Query builder | Kysely |
| HTTP server | Hono |
| Type safety | Hono RPC (hc) + Zod |
| CLI | Cliffy |
| Image processing | ImageScript |
| Dependencies | 100% JSR, zero npm |

## Development

```bash
# Run from source
deno run -A packages/cli/src/mod.ts add "NE555" --stock 25

# Run tests
deno task test

# Compile to single binary
deno compile -A --output ./tray packages/cli/src/mod.ts
```

## Project Structure

```
packages/
  core/     Domain logic + database (Kysely + SQLite). No HTTP awareness.
  api/      Hono server with typed routes. Imports core.
  cli/      Cliffy commands + Hono RPC client. Imports api types only.
  web/      SPA served by api (planned).
```

## Agent Skill

Install the [Tray skill](https://skills.sh) so your AI coding agent knows how to use the CLI:

```bash
npx skills add willwillems/tray
```

## Docs

- [SPEC.md](./SPEC.md) -- Full project specification: features, data model, architecture, decisions
- [AGENTS.md](./AGENTS.md) -- Agent/developer guide: patterns, testing, conventions
