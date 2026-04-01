# Parts

Parts are the core entity in Tray. A part represents a component in your inventory -- an IC, a resistor, a connector, a module.

## Adding Parts

```bash
# Minimal
tray add "NE555"

# With details
tray add "NE555" \
  --description "CMOS single timer" \
  --category "ICs/Timers" \
  --manufacturer "Texas Instruments" \
  --mpn "NE555P" \
  --ipn "IC-001" \
  --footprint "DIP-8" \
  --stock 25 \
  --location "Lab/Shelf 1/Drawer 3" \
  --tags "timer,dip,through-hole" \
  --keywords "oscillator monostable astable" \
  --min-stock 5 \
  --datasheet "https://www.ti.com/lit/ds/symlink/ne555.pdf"
```

Stock and location are optional at creation time. If you provide `--stock`, a stock lot is created automatically. If you also provide `--location`, the lot is placed there.

## Listing and Filtering

```bash
# All parts
tray list

# Filter by category (includes all subcategories)
tray list --category "ICs"
tray list --category "Passives/Resistors"

# Filter by tag
tray list --tag "smd"

# Filter by manufacturer
tray list --manufacturer "Texas Instruments"

# Low stock (stock <= min_stock)
tray list --low

# Favorites only
tray list --favorites
```

`--category "ICs"` returns parts in ICs *and all subcategories* (ICs/Timers, ICs/Regulators, etc.).

## Searching

```bash
# Full-text search (FTS5) across name, description, manufacturer, MPN, IPN, keywords
tray search "555"
tray search "timer"
tray search "texas instruments"

# Prefix matching: "NE55" matches NE555, NE556
tray search "NE55"
```

Search uses SQLite FTS5 for fast full-text matching. If FTS5 returns no results, Tray falls back to LIKE-based search which also checks tags.

## Viewing Details

```bash
# By name
tray show NE555

# By ID
tray show 1
```

The detail view includes all fields, tags, parameters, category path, and stock.

## Editing

```bash
tray edit 1 --description "Updated description"
tray edit 1 --tags "smd,timer,new-tag"
tray edit 1 --manufacturer "ON Semiconductor" --mpn "NE555DR"
tray edit 1 --min-stock 10
tray edit 1 --favorite
tray edit 1 --no-favorite
```

Only the fields you specify are changed. Everything else is untouched.

## Deleting

```bash
tray rm 1
```

Deleting a part cascades: stock lots, tags, parameters, supplier links, BOM references, and attachments are all removed.

## Categories

Categories are hierarchical, separated by `/`. They are created automatically when you first reference them.

```bash
# These create the full hierarchy automatically:
tray add "NE555" --category "ICs/Timers"
tray add "LM7805" --category "ICs/Regulators"
tray add "10k" --category "Passives/Resistors"
```

This creates:
```
ICs/
  Timers/
  Regulators/
Passives/
  Resistors/
```

No separate "create category" step needed. Categories exist because parts reference them.

## Tags

Tags are freeform labels stored in a junction table. They're lowercased and deduplicated automatically.

```bash
tray add "NE555" --tags "timer,dip,through-hole"
tray edit 1 --tags "timer,dip,smd"      # replaces all tags
tray list --tag "smd"                    # filter by tag
```

## Parameters

Parts can have typed parameters with SI prefix parsing. Parameters are stored with both the raw text value and a parsed numeric value for range queries.

```bash
tray add "10k Resistor" --category "Passives/Resistors"
# Parameters are set via the API (CLI flag coming in a future release)
```

Supported SI prefixes: `p` (pico), `n` (nano), `u`/`µ` (micro), `m` (milli), `k` (kilo), `M` (mega), `G` (giga).

Examples: `10k` = 10000, `4.7uF` = 0.0000047, `100nF` = 0.0000001, `2.4GHz` = 2400000000.

## Output Formats

Every command supports `--format`:

```bash
tray list --format json     # Structured JSON (for scripting)
tray list --format csv      # CSV (for spreadsheets)
tray list --format table    # Human-readable table (default in TTY)
```

When stdout is piped (not a TTY), Tray automatically switches to JSON:

```bash
tray list | jq '.[].name'              # Auto-JSON
tray list --format table | less         # Force table even when piped
```
