# Stock Management

Tray uses a lot-based stock system. Every unit of stock exists in a *lot* -- a record with a quantity, a location, and a status. The `Part.stock` field is a cached sum of all `ok` lots, kept in sync automatically by a SQLite trigger.

This means you can use Tray in two ways:
- **Simple:** `tray add "NE555" --stock 25` -- one lot, no location, just a number.
- **Multi-location:** track stock across shelves, drawers, rooms, buildings.

Both paths use the same code. The lot abstraction is invisible until you need it.

## Adding Stock

```bash
# Add stock to a part (creates or adds to a lot)
tray stock add NE555 --qty 50

# Add stock at a specific location
tray stock add NE555 --qty 25 --location "Lab/Shelf 1/Drawer 3"
```

If a lot already exists at the same location with status `ok`, the quantity is added to it (merged). Otherwise, a new lot is created.

Location paths are slash-delimited and auto-created, just like categories:

```bash
tray stock add NE555 --qty 10 --location "Lab/Shelf 1/Drawer 3"
# Creates: Lab -> Shelf 1 -> Drawer 3 (if they don't exist)
```

## Adjusting Stock

Use `adjust` for corrections, consumption, or any change that needs a reason for the audit trail:

```bash
# Remove stock (used in a project)
tray stock adjust NE555 --qty -5 --reason "used in prototype"

# Add stock (found more in a drawer)
tray stock adjust NE555 --qty 3 --reason "found in old drawer"

# Adjust a specific lot
tray stock adjust NE555 --qty -2 --reason "damaged" --lot 3
```

A reason is always required. This creates an audit log entry so you can trace what happened to your stock.

Tray prevents overdraw -- you can't remove more stock than a lot contains:

```bash
# This will fail if the lot only has 5 units:
tray stock adjust NE555 --qty -10 --reason "oops"
# Error: Cannot adjust: lot #1 has 5, tried to remove 10
```

## Moving Stock

Move units between locations without changing the total:

```bash
tray stock move NE555 --qty 10 --from "Shelf 1" --to "Shelf 2"
```

If the destination location doesn't exist, it's created. If a lot already exists at the destination, the quantity is merged into it.

The total stock for the part is unchanged after a move -- it's a transfer, not a creation or destruction.

## Viewing Stock

```bash
# List all lots for a part
tray stock list NE555
```

Output:
```
id  quantity  status  location_path       expiry_date  notes
--  --------  ------  ------------------  -----------  -----
1   10        ok      (no location)
2   15        ok      Lab/Shelf 1/Drawer 3
3   5         ok      Lab/Shelf 2
```

## Low Stock Alerts

```bash
tray stock low
```

Lists all parts where `stock <= min_stock`. Set the threshold when creating or editing a part:

```bash
tray add "NE555" --stock 25 --min-stock 5
tray edit 1 --min-stock 10
```

## Storage Locations

Locations form a hierarchy, just like categories. They're created automatically when referenced in stock operations.

```bash
# These all auto-create the location tree:
tray stock add NE555 --qty 10 --location "Lab/Shelf 1/Drawer 3"
tray stock add LM7805 --qty 5 --location "Lab/Shelf 2"
tray stock add "10k" --qty 100 --location "Garage/Box A"
```

Result:
```
Lab/
  Shelf 1/
    Drawer 3/
  Shelf 2/
Garage/
  Box A/
```

## How Stock Accounting Works

Every stock change goes through the lots table. The `Part.stock` field is a cached column updated by a SQLite trigger:

```sql
-- Trigger fires on every lot insert/update/delete
UPDATE parts SET stock = (
  SELECT COALESCE(SUM(quantity), 0)
  FROM stock_lots
  WHERE part_id = NEW.part_id AND status = 'ok'
) WHERE id = NEW.part_id;
```

Only lots with `status = 'ok'` count toward stock. Lots marked as `damaged`, `quarantined`, or `returned` are excluded from the total but still tracked.
