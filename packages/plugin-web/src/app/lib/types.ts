/** Frontend type definitions matching the API response shapes. */

export interface Part {
  id: number;
  name: string;
  description: string | null;
  category_id: number | null;
  template_id: number | null;
  is_template: number;
  keywords: string | null;
  footprint: string | null;
  manufacturer: string | null;
  mpn: string | null;
  ipn: string | null;
  manufacturing_status: string;
  stock: number;
  min_stock: number;
  favorite: number;
  datasheet_url: string | null;
  kicad_symbol_id: string | null;
  kicad_footprint: string | null;
  thumbnail: string | null;
  created_at: string;
  updated_at: string;
  tags: string[];
  category_path: string | null;
  parameters: PartParameter[];
}

export interface PartParameter {
  key: string;
  value: string;
  unit: string | null;
}

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  description: string | null;
  reference_prefix: string | null;
}

export interface CategoryTreeNode {
  category: Category;
  children: CategoryTreeNode[];
  path: string;
}

export interface StorageLocation {
  id: number;
  name: string;
  parent_id: number | null;
  description: string | null;
}

export interface LocationTreeNode {
  location: StorageLocation;
  children: LocationTreeNode[];
  path: string;
}

export interface StockLot {
  id: number;
  part_id: number;
  location_id: number | null;
  quantity: number;
  status: string;
  expiry_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  location_name: string | null;
  location_path: string | null;
}

export interface Supplier {
  id: number;
  name: string;
  url: string | null;
  notes: string | null;
  part_count?: number;
}

export interface SupplierPart {
  id: number;
  part_id: number;
  supplier_id: number;
  sku: string | null;
  url: string | null;
  notes: string | null;
  supplier_name: string;
  part_name: string;
  price_breaks: PriceBreak[];
}

export interface PriceBreak {
  id: number;
  supplier_part_id: number;
  min_quantity: number;
  price: number;
  currency: string;
}

export interface Attachment {
  id: number;
  entity_type: string;
  entity_id: number;
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  hash: string;
  type: string | null;
  source_url: string | null;
  created_at: string;
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  status: string;
  bom_lines?: BomLine[];
}

export interface BomLine {
  id: number;
  project_id: number;
  part_id: number;
  quantity_required: number;
  reference_designators: string | null;
  notes: string | null;
  part_name?: string;
  part_stock?: number;
  part_thumbnail?: string | null;
}

export interface BuildOrder {
  id: number;
  project_id: number;
  quantity: number;
  status: string;
  created_at: string;
  completed_at: string | null;
  project_name?: string;
}

export interface PurchaseOrder {
  id: number;
  supplier_id: number;
  status: string;
  notes: string | null;
  created_at: string;
  supplier_name?: string;
  lines?: PoLine[];
  total_cost?: number;
}

export interface PoLine {
  id: number;
  purchase_order_id: number;
  supplier_part_id: number;
  quantity_ordered: number;
  quantity_received: number;
  unit_price: number | null;
  currency: string;
  part_name?: string;
  sku?: string;
}

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  user: string | null;
  entity_type: string;
  entity_id: number;
  action: string;
  old_values: string | null;
  new_values: string | null;
}

export interface SearchResult {
  part: Part;
  rank: number;
  tags: string[];
}

export interface Tag {
  tag: string;
  count: number;
}

export interface BomAvailability {
  can_build: boolean;
  shortages: {
    part_id: number;
    part_name: string;
    required: number;
    available: number;
    short: number;
  }[];
}

export interface BestPrice {
  supplier_part: SupplierPart;
  price_break: PriceBreak;
  unit_price: number;
  total_price: number;
}
