# Tray Documentation

Tray is a CLI-first inventory management tool for makers, hobbyists, and small teams. It runs as a single binary with a local SQLite database -- no servers, no Docker, no browser required.

## Quick Start

```bash
# Add some parts
tray add "NE555" --category "ICs/Timers" --stock 25 --manufacturer "TI" --mpn "NE555P"
tray add "10k Resistor" --category "Passives/Resistors" --stock 100 --footprint "0805"
tray add "100nF Cap" --category "Passives/Capacitors" --stock 50

# Find them
tray list
tray search "555"
tray list --category "Passives"
tray list --low

# Track where things are
tray stock add NE555 --qty 10 --location "Lab/Shelf 1/Drawer 3"
tray stock list NE555

# Build a project
tray project add "Synth VCO"
tray project bom-add 1 NE555 --qty 2 --refs "U1,U2"
tray project bom-add 1 "10k Resistor" --qty 8 --refs "R1-R8"
tray project check 1 --qty 5
tray project build 1 --qty 5 --complete
```

## Documentation

| Page | What it covers |
|---|---|
| [Installation](./installation.md) | Binary download, building from source, Deno install |
| [Parts](./parts.md) | Adding, editing, searching, categories, tags, parameters |
| [Stock](./stock.md) | Stock lots, storage locations, adjustments, moves, low stock |
| [Suppliers](./suppliers.md) | Supplier management, price breaks, finding the best price |
| [Projects](./projects.md) | Projects, BOMs, build orders, purchase orders |
| [KiCad](./kicad.md) | Using Tray as a KiCad symbol library |
| [Import & Export](./import-export.md) | CSV/JSON import and export, KiCad BOM import |
| [Backup](./backup.md) | Database backup and restore |
| [Architecture](./architecture.md) | How Tray works, API reference, development guide |

## Design Principles

**CLI is the primary interface.** Every operation is a command. Pipe-friendly JSON output for scripting. Table output for humans.

**Single source of truth.** SQLite database, no sync conflicts, no cloud dependency. Your data lives on your machine.

**One code path.** The CLI, the HTTP server, and the web UI all use the same Hono API. Local mode boots the server in-process (~2ms). Remote mode points at a URL. The code is identical.

**Zero configuration.** `tray add "NE555"` works immediately. No init command, no config file, no setup wizard. The database is created automatically at `~/.tray/data.db`.
