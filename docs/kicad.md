# KiCad Integration

Tray implements the [KiCad HTTP Library API](https://dev-docs.kicad.org/en/apis-and-binding/http-libraries/), allowing you to use your parts inventory as a KiCad symbol library. When you place a component in KiCad's schematic editor, it pulls data directly from Tray.

## Setup

### 1. Start the Tray Server

```bash
tray serve --port 8080
```

This starts the HTTP server with both the regular API and the KiCad endpoints.

### 2. Generate the Configuration File

```bash
tray kicad config > ~/my-inventory.kicad_httplib
```

This outputs a `.kicad_httplib` file that KiCad can use. To customize:

```bash
tray kicad config --url http://192.168.1.100:8080 --name "Workshop Inventory"
```

### 3. Add to KiCad

1. Open KiCad
2. Go to **Preferences -> Manage Symbol Libraries**
3. Click **Add existing library to table** (folder icon)
4. Select your `.kicad_httplib` file
5. Click OK

Your inventory categories now appear as libraries in the Symbol Chooser.

## How It Works

KiCad's HTTP Library feature queries four endpoints:

| Endpoint | What KiCad Does |
|---|---|
| `GET /kicad/v1/` | Validates the server is a KiCad HTTP Library |
| `GET /kicad/v1/categories.json` | Fetches category list (shown as libraries) |
| `GET /kicad/v1/parts/category/{id}.json` | Fetches parts in a category (shown in Symbol Chooser) |
| `GET /kicad/v1/parts/{id}.json` | Fetches full part detail when you click on it |

Tray maps its data model to KiCad's expected format:

| Tray Field | KiCad Field |
|---|---|
| `kicad_symbol_id` | `symbolIdStr` (e.g., `Device:R`, `Timer:NE555`) |
| `kicad_footprint` | `fields.footprint.value` |
| `datasheet_url` | `fields.datasheet.value` |
| `name` | `fields.value.value` |
| `manufacturer`, `mpn` | Custom fields |
| Part parameters | Custom fields |

## Setting Up Parts for KiCad

For a part to work in KiCad, it needs at minimum a `kicad_symbol_id` that references a symbol in your KiCad symbol libraries:

```bash
tray add "10k Resistor" \
  --category "Passives/Resistors" \
  --stock 100 \
  --footprint "0805" \
  --manufacturer "Yageo" \
  --mpn "RC0805FR-0710KL"

# Set KiCad-specific fields via the API:
# kicad_symbol_id: "Device:R"
# kicad_footprint: "Resistor_SMD:R_0805_2012Metric"
```

The `kicad_symbol_id` tells KiCad which symbol to use for the schematic (e.g., `Device:R` uses the standard resistor symbol from KiCad's Device library). The `kicad_footprint` tells KiCad which footprint to assign for PCB layout.

## What KiCad Sees

When you open the Symbol Chooser in KiCad:

```
Tray Inventory                      <- Your .kicad_httplib library
  ICs/Timers                        <- Category
    NE555                           <- Part (click to place)
  ICs/Regulators
    LM7805
  Passives/Resistors
    10k Resistor
    4.7k Resistor
```

Clicking a part loads its full details including footprint, datasheet URL, manufacturer info, and all parameters as custom fields on the schematic symbol.

## Contract Compliance

Tray's KiCad implementation is tested against 12 contract tests that validate:

- All response values are strings (KiCad requirement -- no numbers or booleans)
- Response structure matches the exact JSON schema KiCad expects
- A mock KiCad client can successfully complete the full browse/select/detail flow
- Edge cases: empty categories, missing fields, parts without footprints

These tests run as part of `deno task test` and are designed to catch any deviation from KiCad's expected contract before you discover it in the field.
