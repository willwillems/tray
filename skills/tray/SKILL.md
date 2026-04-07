---
name: tray
description: Manage a parts inventory using the Tray CLI. Use when the user needs to add parts, track stock, search inventory, manage suppliers, build projects, import/export data, or integrate with KiCad. Triggers include mentions of parts, components, inventory, stock, BOM, bill of materials, KiCad, or the tray command.
license: MIT
compatibility: Requires the tray binary installed and available on PATH.
metadata:
  author: willwillems
  version: "0.1.3"
---

# Tray CLI

Tray is a CLI-first parts inventory tool. Every operation is a command. Output defaults to a human-readable table in TTY, or JSON when piped. Use `--format json` to force JSON output for parsing.

The database is at `~/.tray/data.db` by default. Override with `TRAY_DB` env var or `--db` flag.

## Parts

```bash
# Add a part
tray add "NE555" --category "ICs/Timers" --stock 25 --manufacturer "TI" --mpn "NE555P" --tags "timer,dip"

# Add a part with an image (URL or local path -- sets thumbnail automatically)
tray add "LM7805" --category "ICs/Regulators" --stock 10 --image "https://example.com/lm7805.jpg"

# List all parts
tray list

# Filter
tray list --category "ICs"           # includes all subcategories
tray list --tag "smd"
tray list --manufacturer "TI"
tray list --low                      # stock <= min_stock
tray list --favorites

# Search (FTS5 full-text, prefix matching)
tray search "555"
tray search "timer"

# Show detail
tray show NE555
tray show 1                          # by ID

# Edit
tray edit 1 --description "Timer IC" --tags "timer,smd" --min-stock 5

# Delete
tray rm 1
```

Categories are slash-delimited and auto-created: `--category "ICs/Timers"` creates both "ICs" and "Timers" if they don't exist.

## Stock

Stock is lot-based. Every unit lives in a lot with a quantity, location, and status.

```bash
# Add stock (creates or merges into existing lot)
tray stock add NE555 --qty 50
tray stock add NE555 --qty 25 --location "Lab/Shelf 1/Drawer 3"

# Adjust (requires a reason for the audit trail)
tray stock adjust NE555 --qty -5 --reason "used in prototype"

# Move between locations
tray stock move NE555 --qty 10 --from "Shelf 1" --to "Shelf 2"

# View lots for a part
tray stock list NE555

# Show all parts below minimum stock
tray stock low
```

Locations are slash-delimited and auto-created, like categories.

## Suppliers and Pricing

```bash
# Add a supplier
tray supplier add "DigiKey" --url "https://digikey.com"

# Link a part to a supplier with SKU and price
tray supplier link NE555 1 --sku "296-1411-5-ND" --price 0.58

# Find the best price across all suppliers
tray supplier buy NE555 --qty 100

# List suppliers
tray supplier list
```

## Projects and BOMs

```bash
# Create a project
tray project add "Synth VCO" --description "VCO oscillator module"

# Add parts to the BOM
tray project bom-add 1 NE555 --qty 2 --refs "U1,U2"
tray project bom-add 1 "10k Resistor" --qty 8 --refs "R1-R8"

# View project with BOM and availability
tray project show 1

# Check if you can build N units
tray project check 1 --qty 5

# Build (deducts stock for all BOM lines * quantity)
tray project build 1 --qty 5 --complete

# Import a KiCad BOM CSV into a project
tray bom-import 1 kicad-bom.csv
```

## Purchase Orders

Purchase orders track "I ordered these parts from this supplier -- have they arrived?"

```bash
# Create a PO for a supplier (by name or ID)
tray po create --supplier "Mouser" --notes "Synth VCO restock"

# Add lines by part name. If no supplier link exists, one is auto-created.
# Prices auto-fill from existing price breaks.
tray po add 1 "NE555" --qty 100
tray po add 1 "LM7805" --qty 50 --price 0.45 --currency EUR

# Review the PO with lines and totals
tray po show 1

# Edit a PO line (update quantity, price, or both atomically)
tray po edit-line 1 --qty 100 --price 0.0412
tray po edit-line 2 --currency EUR

# Mark as ordered (after placing the order on the supplier's website)
tray po submit 1

# Receive all outstanding lines at once
tray po receive 1 --location "Shelf A"

# Or receive a specific line (partial shipments)
tray po receive 1 --line 3 --qty 50 --location "Incoming"

# List POs, optionally filtered by status
tray po list
tray po list --status ordered

# Cancel a PO
tray po cancel 1
```

Status flow: `draft` -> `ordered` -> `partial` -> `received` (or `cancelled`). Receiving automatically creates stock lots and transitions the PO status. When adding lines, parts are resolved to the PO's supplier automatically -- if no supplier-part link exists, one is created with a notice.

## Attachments

Attach files (local or URL) to parts. Images automatically generate a 128x128 JPEG thumbnail.

```bash
# Attach a local file
tray attach NE555 ~/datasheets/ne555.pdf

# Attach from a URL (fetches and stores the file)
tray attach NE555 "https://example.com/ne555-photo.jpg"

# Specify attachment type
tray attach NE555 photo.jpg --type image

# List attachments for a part
tray attachments NE555

# Remove an attachment
tray detach 1
```

Supported image formats for thumbnail generation: **PNG, JPEG, GIF, WebP, BMP**. Other image formats (AVIF, TIFF, SVG, HEIC) will be attached but won't generate a thumbnail -- a warning is shown.

You can also attach an image at part creation time with `--image`:

```bash
tray add "ALPHA RV112FF" \
  --category "Potentiometers" \
  --manufacturer "ALPHA" \
  --image "https://example.com/product.jpg"
```

This creates the part and immediately attaches the image, setting it as the part thumbnail.

## Import and Export

```bash
# Export
tray export --format csv > inventory.csv
tray export --format json > inventory.json
tray export --format csv --category "ICs" > ics-only.csv

# Import
tray import parts.csv
tray import parts.json
```

## Backup and Restore

```bash
tray backup                                  # auto-named timestamped file
tray backup ~/backups/inventory.db           # specific path
tray restore ~/backups/inventory.db --yes    # full replacement
```

## KiCad Integration

```bash
# Start the HTTP server (serves both API and KiCad HTTP Library)
tray serve --port 8080

# Generate a .kicad_httplib config file for KiCad
tray kicad config > ~/my-inventory.kicad_httplib
```

Add the `.kicad_httplib` file to KiCad's symbol library manager. Your inventory categories appear as libraries in the Symbol Chooser.

## Output Formats

All commands support `--format json`, `--format csv`, or `--format table`. When stdout is piped, JSON is used automatically. Always use `--format json` when you need to parse output programmatically.

```bash
# Parse JSON output
tray show NE555 --format json | jq '.stock'
tray list --format json | jq '.[].name'
```
