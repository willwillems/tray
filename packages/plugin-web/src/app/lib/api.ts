/**
 * API client -- thin fetch wrapper for all tray API endpoints.
 * Every function returns the parsed JSON response.
 * Throws on non-OK responses with structured error info.
 */

import type {
  Part,
  Category,
  CategoryTreeNode,
  StorageLocation,
  LocationTreeNode,
  StockLot,
  Supplier,
  SupplierPart,
  Attachment,
  Project,
  BomLine,
  BuildOrder,
  PurchaseOrder,
  AuditLogEntry,
  SearchResult,
  Tag,
  BomAvailability,
  BestPrice,
} from "./types";

const BASE = "";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "unknown", message: res.statusText }));
    throw new ApiError(res.status, body.error ?? "unknown", body.message ?? res.statusText);
  }
  return res.json();
}

function qs(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (entries.length === 0) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

// --- Parts ---
export const parts = {
  list: (filters?: {
    category?: string;
    category_id?: number;
    tag?: string;
    manufacturer?: string;
    low?: boolean;
    favorites?: boolean;
    search?: string;
    param?: string;
    limit?: number;
    offset?: number;
  }) => request<Part[]>(`/api/parts${qs(filters ?? {})}`),

  get: (id: number | string) => request<Part>(`/api/parts/${id}`),

  create: (data: Record<string, unknown>) =>
    request<Part>("/api/parts", { method: "POST", body: JSON.stringify(data) }),

  update: (id: number, data: Record<string, unknown>) =>
    request<Part>(`/api/parts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  delete: (id: number) =>
    request<{ ok: boolean }>(`/api/parts/${id}`, { method: "DELETE" }),

  setThumbnail: (id: number, attachmentId: number) =>
    request<Part>(`/api/parts/${id}/thumbnail`, {
      method: "PUT",
      body: JSON.stringify({ attachment_id: attachmentId }),
    }),

  clearThumbnail: (id: number) =>
    request<Part>(`/api/parts/${id}/thumbnail`, { method: "DELETE" }),

  bestPrice: (id: number, quantity = 1) =>
    request<BestPrice>(`/api/parts/${id}/best-price${qs({ quantity })}`),

  suppliers: (id: number) => request<SupplierPart[]>(`/api/parts/${id}/suppliers`),
};

// --- Categories ---
export const categories = {
  list: (parentId?: number | null) =>
    request<Category[]>(`/api/categories${qs({ parent_id: parentId })}`),

  tree: () => request<CategoryTreeNode[]>("/api/categories/tree"),

  get: (id: number) => request<Category & { path: string }>(`/api/categories/${id}`),

  create: (data: { name: string; parent_id?: number; description?: string; reference_prefix?: string }) =>
    request<Category>("/api/categories", { method: "POST", body: JSON.stringify(data) }),

  resolve: (path: string) =>
    request<Category & { path: string }>("/api/categories/resolve", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  delete: (id: number) =>
    request<{ ok: boolean }>(`/api/categories/${id}`, { method: "DELETE" }),
};

// --- Search ---
export const search = {
  query: (q: string, limit = 50, offset = 0) =>
    request<SearchResult[]>(`/api/search${qs({ q, limit, offset })}`),
};

// --- Tags ---
export const tags = {
  list: () => request<Tag[]>("/api/tags"),
};

// --- Audit ---
export const audit = {
  list: (filters?: {
    entity_type?: string;
    entity_id?: number;
    action?: string;
    user?: string;
    since?: string;
    limit?: number;
    offset?: number;
  }) => request<AuditLogEntry[]>(`/api/audit${qs(filters ?? {})}`),

  get: (id: number) => request<AuditLogEntry>(`/api/audit/${id}`),
};

// --- Stock ---
export const stock = {
  lots: (partId: number) => request<StockLot[]>(`/api/stock/${partId}`),

  add: (data: {
    part_id: number;
    quantity: number;
    location?: string;
    location_id?: number;
    status?: string;
    expiry_date?: string;
    notes?: string;
  }) => request<StockLot>("/api/stock/add", { method: "POST", body: JSON.stringify(data) }),

  adjust: (data: {
    part_id: number;
    quantity: number;
    reason: string;
    lot_id?: number;
  }) => request<StockLot>("/api/stock/adjust", { method: "POST", body: JSON.stringify(data) }),

  move: (data: {
    part_id: number;
    quantity: number;
    from_lot_id?: number;
    from_location?: string;
    to_location: string;
    notes?: string;
  }) =>
    request<{ from: StockLot; to: StockLot }>("/api/stock/move", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// --- Locations ---
export const locations = {
  list: (parentId?: number | null) =>
    request<StorageLocation[]>(`/api/locations${qs({ parent_id: parentId })}`),

  tree: () => request<LocationTreeNode[]>("/api/locations/tree"),

  get: (id: number) => request<StorageLocation & { path: string }>(`/api/locations/${id}`),

  delete: (id: number) =>
    request<{ ok: boolean }>(`/api/locations/${id}`, { method: "DELETE" }),
};

// --- Suppliers ---
export const suppliers = {
  list: () => request<Supplier[]>("/api/suppliers"),

  get: (id: number) => request<Supplier>(`/api/suppliers/${id}`),

  create: (data: { name: string; url?: string; notes?: string }) =>
    request<Supplier>("/api/suppliers", { method: "POST", body: JSON.stringify(data) }),

  update: (id: number, data: { name?: string; url?: string | null; notes?: string | null }) =>
    request<Supplier>(`/api/suppliers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  delete: (id: number) =>
    request<{ ok: boolean }>(`/api/suppliers/${id}`, { method: "DELETE" }),

  parts: (id: number) => request<SupplierPart[]>(`/api/suppliers/${id}/parts`),
};

// --- Supplier Parts ---
export const supplierParts = {
  create: (data: {
    part_id: number;
    supplier_id: number;
    sku?: string;
    url?: string;
    notes?: string;
    price_breaks?: { min_quantity: number; price: number; currency?: string }[];
  }) =>
    request<SupplierPart>("/api/supplier-parts", { method: "POST", body: JSON.stringify(data) }),

  delete: (id: number) =>
    request<{ ok: boolean }>(`/api/supplier-parts/${id}`, { method: "DELETE" }),
};

// --- Attachments ---
export const attachments = {
  list: (entityType: string, entityId: number) =>
    request<Attachment[]>(`/api/attachments${qs({ entity_type: entityType, entity_id: entityId })}`),

  get: (id: number) => request<Attachment>(`/api/attachments/${id}`),

  fileUrl: (id: number) => `/api/attachments/${id}/file`,

  upload: async (file: File, entityType: string, entityId: number, type?: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("entity_type", entityType);
    form.append("entity_id", String(entityId));
    if (type) form.append("type", type);
    const res = await fetch("/api/attachments", { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "unknown", message: res.statusText }));
      throw new ApiError(res.status, body.error, body.message);
    }
    return res.json() as Promise<Attachment>;
  },

  delete: (id: number) =>
    request<{ ok: boolean }>(`/api/attachments/${id}`, { method: "DELETE" }),
};

// --- Projects ---
export const projects = {
  list: (status?: string) => request<Project[]>(`/api/projects${qs({ status: status })}`),

  get: (id: number) => request<Project>(`/api/projects/${id}`),

  create: (data: { name: string; description?: string }) =>
    request<Project>("/api/projects", { method: "POST", body: JSON.stringify(data) }),

  update: (id: number, data: { name?: string; description?: string | null; status?: string }) =>
    request<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  delete: (id: number) =>
    request<{ ok: boolean }>(`/api/projects/${id}`, { method: "DELETE" }),

  bom: (id: number) => request<BomLine[]>(`/api/projects/${id}/bom`),

  addBomLine: (projectId: number, data: {
    part_id: number;
    quantity_required: number;
    reference_designators?: string;
    notes?: string;
  }) =>
    request<BomLine>(`/api/projects/${projectId}/bom`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  removeBomLine: (lineId: number) =>
    request<{ ok: boolean }>(`/api/bom-lines/${lineId}`, { method: "DELETE" }),

  checkAvailability: (id: number, quantity = 1) =>
    request<BomAvailability>(`/api/projects/${id}/check${qs({ quantity })}`),
};

// --- Build Orders ---
export const builds = {
  list: (projectId?: number) =>
    request<BuildOrder[]>(`/api/builds${qs({ project_id: projectId })}`),

  create: (data: { project_id: number; quantity: number }) =>
    request<BuildOrder>("/api/builds", { method: "POST", body: JSON.stringify(data) }),

  complete: (id: number) =>
    request<BuildOrder>(`/api/builds/${id}/complete`, { method: "POST" }),
};

// --- Purchase Orders ---
export const purchaseOrders = {
  list: (status?: string) =>
    request<PurchaseOrder[]>(`/api/purchase-orders${qs({ status: status })}`),

  get: (id: number) => request<PurchaseOrder>(`/api/purchase-orders/${id}`),

  create: (data: { supplier_id?: number; supplier?: string; notes?: string }) =>
    request<PurchaseOrder>("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: number, data: { status?: string; notes?: string }) =>
    request<PurchaseOrder>(`/api/purchase-orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  addLine: (
    poId: number,
    data: {
      supplier_part_id?: number;
      part_id?: number;
      quantity_ordered: number;
      unit_price?: number;
      currency?: string;
    },
  ) =>
    request<unknown>(`/api/purchase-orders/${poId}/lines`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  editLine: (
    lineId: number,
    data: { quantity_ordered?: number; unit_price?: number | null; currency?: string | null },
  ) =>
    request<unknown>(`/api/po-lines/${lineId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  receiveLine: (lineId: number, data: { quantity_received: number; location?: string }) =>
    request<unknown>(`/api/po-lines/${lineId}/receive`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// --- Health ---
export const health = {
  check: () => request<{ ok: boolean }>("/health"),
};
