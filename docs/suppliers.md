# Suppliers and Pricing

Track where to buy parts, at what price, and find the cheapest option across vendors.

## Managing Suppliers

```bash
# Add suppliers
tray supplier add "DigiKey" --url "https://digikey.com"
tray supplier add "Mouser" --url "https://mouser.com"
tray supplier add "LCSC" --url "https://lcsc.com"

# List suppliers
tray supplier list

# Show details (including linked parts)
tray supplier show 1
```

## Linking Parts to Suppliers

A *supplier part* links one of your parts to a supplier with a SKU (order code) and pricing:

```bash
# Link NE555 to DigiKey with SKU and price
tray supplier link NE555 1 --sku "296-1411-5-ND" --price 0.58

# Link same part to Mouser
tray supplier link NE555 2 --sku "595-NE555P" --price 0.45
```

The `--price` flag sets a single price break at quantity 1. For quantity-based pricing tiers, use the API directly:

```bash
# Via the API (multipart pricing)
curl -X POST http://localhost:8080/api/supplier-parts -H 'Content-Type: application/json' \
  -d '{
    "part_id": 1,
    "supplier_id": 1,
    "sku": "296-1411-5-ND",
    "price_breaks": [
      {"min_quantity": 1, "price": 0.58},
      {"min_quantity": 10, "price": 0.45},
      {"min_quantity": 100, "price": 0.32}
    ]
  }'
```

## Finding the Best Price

```bash
# Best price for 1 unit
tray supplier buy NE555

# Best price for 100 units
tray supplier buy NE555 --qty 100
```

Output:
```
Best price for NE555 x100:
  Supplier:   DigiKey
  SKU:        296-1411-5-ND
  Unit price: USD 0.3200
  Total:      USD 32.00
```

Tray compares the applicable price break from every supplier that stocks the part. A price break is "applicable" if its `min_quantity` is less than or equal to your requested quantity. Among applicable breaks, it picks the cheapest unit price.

## Example Workflow

```bash
# Setup
tray add "NE555" --stock 5 --min-stock 20
tray supplier add "DigiKey"
tray supplier add "Mouser"
tray supplier link NE555 1 --sku "DK-555" --price 0.58
tray supplier link NE555 2 --sku "MS-555" --price 0.45

# Check what you need to buy
tray stock low
# NE555: stock 5, min_stock 20 -> need to buy

# Find best price
tray supplier buy NE555 --qty 50
# Mouser is cheaper at $0.45/unit

# After ordering and receiving:
tray stock add NE555 --qty 50 --location "Shelf 1"
```
