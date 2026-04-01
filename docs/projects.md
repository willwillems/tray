# Projects, BOMs, and Build Orders

Projects represent things you build -- a PCB, a kit, a product. Each project has a BOM (Bill of Materials) listing the parts and quantities needed. Build orders consume the BOM, deducting stock from your inventory.

## Creating Projects

```bash
tray project add "Synth VCO" --description "Voltage-controlled oscillator module"
tray project add "LED Matrix Clock"
tray project list
```

## Building a BOM

Add parts to a project's BOM with quantities and reference designators:

```bash
tray project bom-add 1 NE555 --qty 2 --refs "U1,U2"
tray project bom-add 1 "10k Resistor" --qty 8 --refs "R1-R8"
tray project bom-add 1 "100nF Cap" --qty 4 --refs "C1-C4"
```

If you add the same part twice, the quantity is updated (not duplicated).

View the BOM with availability info:

```bash
tray project show 1
```

Output:
```
Project: Synth VCO [active]

BOM (3 line items):
part_name      quantity_required  reference_designators  stock_available  sufficient
-------------  -----------------  ---------------------  ---------------  ----------
NE555          2                  U1,U2                  25               yes
10k Resistor   8                  R1-R8                  100              yes
100nF Cap      4                  C1-C4                  50               yes
```

## Checking Availability

Before building, check if you have enough stock:

```bash
# Can I build 1 unit?
tray project check 1

# Can I build 10 units?
tray project check 1 --qty 10
```

If stock is insufficient:
```
Can build 10 unit(s): NO

Shortages:
part_name  required  available  short
---------  --------  ---------  -----
NE555      20        15         5
```

## Building

A build order deducts stock for every BOM line, multiplied by the build quantity:

```bash
# Create and immediately complete a build of 5 units
tray project build 1 --qty 5 --complete
```

This deducts:
- NE555: 2 * 5 = 10 units
- 10k Resistor: 8 * 5 = 40 units
- 100nF Cap: 4 * 5 = 20 units

The build will fail if any part has insufficient stock. Stock is not partially deducted -- it's all or nothing.

Without `--complete`, the build order is created in `draft` status for later completion.

## Importing a KiCad BOM

If you design PCBs in KiCad, you can export a BOM CSV and import it directly:

```bash
# Export BOM from KiCad (File -> Fabrication Outputs -> BOM)
# Then import into a Tray project:
tray bom-import 1 kicad-bom.csv
```

Output:
```
BOM import complete:
  Matched: 12 parts
  Unmatched: 3 parts (not in inventory)
    C5: 100pF (Capacitor_SMD:C_0402_1005Metric)
    U3: ATmega328P (Package_QFP:TQFP-32_7x7mm_P0.8mm)
    J1: USB_C (Connector_USB:USB_C_Receptacle_GCT_USB4085)

Tip: Add missing parts with 'tray add', then re-import.
```

Tray matches BOM entries to parts by the `Value` column. Unmatched parts are reported so you can add them and re-import.

## Purchase Orders

When you need to replenish stock, create a purchase order:

```bash
# Create a PO for DigiKey (supplier ID 1)
# (Purchase order management is available via the API)
```

The PO workflow:
1. Create a PO for a supplier (`draft`)
2. Add PO lines referencing supplier parts with quantities
3. Mark as `ordered` when you place the order
4. Receive items as they arrive -- stock is added automatically
5. PO transitions to `partial` then `received` as lines are fulfilled

Receiving a PO line automatically calls `stock add` for the corresponding part, so your inventory stays current.

## Full Workflow Example

```bash
# 1. Add parts to inventory
tray add "ATmega328P" --category "ICs/MCU" --stock 5
tray add "16MHz Crystal" --category "Passives/Crystals" --stock 20
tray add "22pF Cap" --category "Passives/Capacitors" --stock 100

# 2. Create project
tray project add "Arduino Clone"

# 3. Define BOM
tray project bom-add 1 ATmega328P --qty 1 --refs "U1"
tray project bom-add 1 "16MHz Crystal" --qty 1 --refs "Y1"
tray project bom-add 1 "22pF Cap" --qty 2 --refs "C1,C2"

# 4. Check availability for 3 units
tray project check 1 --qty 3

# 5. Build
tray project build 1 --qty 3 --complete

# 6. Verify stock deducted
tray list
# ATmega328P: 5 - 3 = 2
# 16MHz Crystal: 20 - 3 = 17
# 22pF Cap: 100 - 6 = 94
```
