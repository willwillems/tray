# Import and Export

Move data in and out of Tray via CSV, JSON, and KiCad BOM files.

## Exporting Parts

### CSV

```bash
# Export all parts as CSV
tray export --format csv > inventory.csv

# Filter by category
tray export --format csv --category "ICs" > ics.csv

# Custom columns
tray export --format csv --columns "name,manufacturer,mpn,stock" > minimal.csv
```

Default CSV columns: `id`, `name`, `description`, `category_path`, `manufacturer`, `mpn`, `ipn`, `footprint`, `stock`, `min_stock`, `tags`, `keywords`, `manufacturing_status`, `datasheet_url`.

### JSON

```bash
# Export all parts as JSON
tray export --format json > inventory.json

# Pipe to jq for processing
tray export --format json | jq '[.[] | {name, stock, manufacturer}]'
```

JSON export includes all fields, tags, parameters, and category paths. This is the most complete format and the best choice for backup or migration.

## Importing Parts

### From CSV

```bash
tray import parts.csv
```

Expected CSV format -- the first row must be headers:

```csv
name,description,manufacturer,mpn,stock,category,tags
NE555,Timer IC,Texas Instruments,NE555P,25,ICs/Timers,"timer,dip"
LM7805,5V Regulator,TI,LM7805CT,10,ICs/Regulators,
10k Resistor,10k 0805,,RC0805,100,Passives/Resistors,smd
```

Recognized column names (case-insensitive):
- `name`, `value`, `component` -- part name (required)
- `description`
- `manufacturer`
- `mpn`, `manufacturer_part_number`
- `ipn`, `internal_part_number`
- `footprint`, `package`
- `stock`
- `min_stock`
- `category`, `category_path`
- `tags` -- comma or semicolon separated
- `keywords`
- `datasheet_url`, `datasheet`
- `manufacturing_status`

### From JSON

```bash
tray import parts.json
```

Expected format -- an array of objects:

```json
[
  {
    "name": "NE555",
    "description": "Timer IC",
    "manufacturer": "Texas Instruments",
    "stock": 25,
    "category": "ICs/Timers",
    "tags": ["timer", "dip"]
  }
]
```

### Import Behavior

- **Duplicate detection:** Parts with names that already exist in the database are skipped (not overwritten). The import report tells you how many were skipped.
- **Category auto-creation:** Category paths like `ICs/Timers` create the full hierarchy automatically.
- **Error handling:** Invalid rows are skipped with an error message. Other rows still import successfully.

```
Import complete:
  Created: 45
  Skipped: 3 (already exist)
  Errors:  1
    Line 22: Missing name/value/component field
```

## KiCad BOM Import

Import a BOM exported from KiCad into a Tray project:

```bash
tray bom-import 1 kicad-bom.csv
```

Tray reads the CSV, matches the `Value` column to part names in your inventory, and creates BOM lines with the correct quantities and reference designators.

```
BOM import complete:
  Matched: 12 parts
  Unmatched: 2 parts (not in inventory)
    C5: 100pF (Capacitor_SMD:C_0402_1005Metric)
    U3: ATmega328P (Package_QFP:TQFP-32_7x7mm_P0.8mm)

Tip: Add missing parts with 'tray add', then re-import.
```

### Expected BOM CSV Format

KiCad BOMs typically have these columns:

```csv
Reference,Value,Footprint,Qty
U1,NE555,Package_DIP:DIP-8_W7.62mm,1
"R1,R2,R3,R4",10k,Resistor_SMD:R_0805_2012Metric,4
C1,100nF,Capacitor_SMD:C_0805_2012Metric,1
```

Recognized columns: `Reference`/`Ref`, `Value`/`Val`, `Footprint`/`Package`, `Qty`/`Quantity`/`Count`.

## Round-Trip Fidelity

Export and re-import preserves all data:

```bash
# Export from one database
tray export --format json --db original.db > backup.json

# Import into a fresh database
tray import backup.json --db new.db

# Both databases now have identical parts, categories, tags, and stock
```

This is tested automatically in the test suite with a dedicated round-trip test.
