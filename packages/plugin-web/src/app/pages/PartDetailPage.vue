<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import {
  ArrowLeft,
  Star,
  Pencil,
  Trash2,
  Plus,
  Download,
  X,
  Upload,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  ImagePlus,
  Package,
  History,
  Settings2,
  ShoppingCart,
  Paperclip,
} from "lucide-vue-next";
import { parts, stock, attachments, audit } from "@/lib/api";
import type {
  Part,
  StockLot,
  SupplierPart,
  Attachment,
  AuditLogEntry,
  BestPrice,
  PartParameter,
} from "@/lib/types";
import { timeAgo, formatDate, formatDateTime, formatBytes, formatCurrency } from "@/lib/format";
import Modal from "@/components/Modal.vue";
import EmptyState from "@/components/EmptyState.vue";
import LoadingSpinner from "@/components/LoadingSpinner.vue";
import StockIndicator from "@/components/StockIndicator.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import PartThumbnail from "@/components/PartThumbnail.vue";

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();

const partId = computed(() => Number(route.params.id));

// --- Core data ---
const {
  data: part,
  isLoading,
  isError,
} = useQuery({
  queryKey: ["parts", partId],
  queryFn: () => parts.get(partId.value),
  enabled: computed(() => !isNaN(partId.value)),
});

// --- Tabs ---
type Tab = "parameters" | "stock" | "suppliers" | "attachments" | "history";
const activeTab = ref<Tab>("parameters");
const tabs: { key: Tab; label: string; icon: typeof Settings2 }[] = [
  { key: "parameters", label: "Parameters", icon: Settings2 },
  { key: "stock", label: "Stock Lots", icon: Package },
  { key: "suppliers", label: "Suppliers", icon: ShoppingCart },
  { key: "attachments", label: "Attachments", icon: Paperclip },
  { key: "history", label: "History", icon: History },
];

// --- Stock lots ---
const { data: stockLots } = useQuery({
  queryKey: ["stock", "lots", partId],
  queryFn: () => stock.lots(partId.value),
  enabled: computed(() => !isNaN(partId.value)),
});

// --- Suppliers ---
const { data: supplierParts } = useQuery({
  queryKey: ["parts", partId, "suppliers"],
  queryFn: () => parts.suppliers(partId.value),
  enabled: computed(() => !isNaN(partId.value)),
});

// --- Best price ---
const { data: bestPrice } = useQuery({
  queryKey: ["parts", partId, "best-price"],
  queryFn: () => parts.bestPrice(partId.value),
  enabled: computed(() => !isNaN(partId.value)),
  retry: false,
});

// --- Attachments ---
const { data: attachmentList } = useQuery({
  queryKey: ["attachments", "part", partId],
  queryFn: () => attachments.list("part", partId.value),
  enabled: computed(() => !isNaN(partId.value)),
});

// --- Audit log ---
const { data: auditLog } = useQuery({
  queryKey: ["audit", "part", partId],
  queryFn: () => audit.list({ entity_type: "part", entity_id: partId.value }),
  enabled: computed(() => !isNaN(partId.value)),
});

// --- Favorite toggle ---
const favoriteMutation = useMutation({
  mutationFn: (fav: boolean) => parts.update(partId.value, { favorite: fav ? 1 : 0 }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["parts", partId] });
    queryClient.invalidateQueries({ queryKey: ["parts"] });
  },
});

function toggleFavorite() {
  if (!part.value) return;
  favoriteMutation.mutate(!part.value.favorite);
}

// --- Delete ---
const showDeleteConfirm = ref(false);
const deleteMutation = useMutation({
  mutationFn: () => parts.delete(partId.value),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["parts"] });
    router.push("/parts");
  },
});

function confirmDelete() {
  deleteMutation.mutate();
}

// --- Edit Part Modal ---
const showEditModal = ref(false);
const editForm = ref({
  name: "",
  description: "",
  category: "",
  manufacturer: "",
  mpn: "",
  ipn: "",
  footprint: "",
  keywords: "",
  min_stock: 0,
  datasheet_url: "",
  manufacturing_status: "",
});

function openEditModal() {
  if (!part.value) return;
  editForm.value = {
    name: part.value.name,
    description: part.value.description ?? "",
    category: part.value.category_path ?? "",
    manufacturer: part.value.manufacturer ?? "",
    mpn: part.value.mpn ?? "",
    ipn: part.value.ipn ?? "",
    footprint: part.value.footprint ?? "",
    keywords: part.value.keywords ?? "",
    min_stock: part.value.min_stock,
    datasheet_url: part.value.datasheet_url ?? "",
    manufacturing_status: part.value.manufacturing_status,
  };
  showEditModal.value = true;
}

const editMutation = useMutation({
  mutationFn: (data: Record<string, unknown>) => parts.update(partId.value, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["parts", partId] });
    queryClient.invalidateQueries({ queryKey: ["parts"] });
    showEditModal.value = false;
  },
});

function submitEdit() {
  const f = editForm.value;
  if (!f.name.trim()) return;
  const data: Record<string, unknown> = {
    name: f.name.trim(),
  };
  data.description = f.description.trim() || null;
  if (f.category.trim()) data.category = f.category.trim();
  data.manufacturer = f.manufacturer.trim() || null;
  data.mpn = f.mpn.trim() || null;
  data.ipn = f.ipn.trim() || null;
  data.footprint = f.footprint.trim() || null;
  data.keywords = f.keywords.trim() || null;
  data.min_stock = f.min_stock;
  data.datasheet_url = f.datasheet_url.trim() || null;
  data.manufacturing_status = f.manufacturing_status || "unknown";
  editMutation.mutate(data);
}

// --- Add Parameter ---
const newParam = ref({ key: "", value: "", unit: "" });
const addParamMutation = useMutation({
  mutationFn: () => {
    const p = newParam.value;
    if (!part.value) throw new Error("No part");
    const currentParams = part.value.parameters ?? [];
    const updatedParams = [...currentParams, { key: p.key, value: p.value, unit: p.unit || null }];
    return parts.update(partId.value, { parameters: updatedParams });
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["parts", partId] });
    newParam.value = { key: "", value: "", unit: "" };
  },
});

function addParameter() {
  if (!newParam.value.key.trim() || !newParam.value.value.trim()) return;
  addParamMutation.mutate();
}

// --- Add Stock Modal ---
const showAddStockModal = ref(false);
const stockForm = ref({
  quantity: 1,
  location: "",
  status: "ok",
  notes: "",
});

function resetStockForm() {
  stockForm.value = { quantity: 1, location: "", status: "ok", notes: "" };
}

const addStockMutation = useMutation({
  mutationFn: () => {
    const f = stockForm.value;
    return stock.add({
      part_id: partId.value,
      quantity: f.quantity,
      location: f.location.trim() || undefined,
      status: f.status || undefined,
      notes: f.notes.trim() || undefined,
    });
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["stock", "lots", partId] });
    queryClient.invalidateQueries({ queryKey: ["parts", partId] });
    queryClient.invalidateQueries({ queryKey: ["parts"] });
    showAddStockModal.value = false;
    resetStockForm();
  },
});

function submitAddStock() {
  if (stockForm.value.quantity <= 0) return;
  addStockMutation.mutate();
}

// --- Adjust Stock Modal ---
const showAdjustStockModal = ref(false);
const adjustForm = ref({
  quantity: 0,
  reason: "",
});

function resetAdjustForm() {
  adjustForm.value = { quantity: 0, reason: "" };
}

const adjustStockMutation = useMutation({
  mutationFn: () => {
    const f = adjustForm.value;
    return stock.adjust({
      part_id: partId.value,
      quantity: f.quantity,
      reason: f.reason.trim(),
    });
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["stock", "lots", partId] });
    queryClient.invalidateQueries({ queryKey: ["parts", partId] });
    queryClient.invalidateQueries({ queryKey: ["parts"] });
    showAdjustStockModal.value = false;
    resetAdjustForm();
  },
});

function submitAdjustStock() {
  if (!adjustForm.value.reason.trim()) return;
  adjustStockMutation.mutate();
}

// --- Attachments ---
const fileInput = ref<HTMLInputElement | null>(null);
const isDragging = ref(false);

const uploadMutation = useMutation({
  mutationFn: (file: File) => attachments.upload(file, "part", partId.value),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["attachments", "part", partId] });
    queryClient.invalidateQueries({ queryKey: ["parts", partId] });
  },
});

function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files) {
    for (const file of input.files) {
      uploadMutation.mutate(file);
    }
    input.value = "";
  }
}

function onDrop(e: DragEvent) {
  isDragging.value = false;
  if (e.dataTransfer?.files) {
    for (const file of e.dataTransfer.files) {
      uploadMutation.mutate(file);
    }
  }
}

const deleteAttachmentMutation = useMutation({
  mutationFn: (id: number) => attachments.delete(id),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["attachments", "part", partId] });
  },
});

const setThumbnailMutation = useMutation({
  mutationFn: (attachmentId: number) => parts.setThumbnail(partId.value, attachmentId),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["parts", partId] });
    queryClient.invalidateQueries({ queryKey: ["parts"] });
  },
});

const clearThumbnailMutation = useMutation({
  mutationFn: () => parts.clearThumbnail(partId.value),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["parts", partId] });
    queryClient.invalidateQueries({ queryKey: ["parts"] });
  },
});

function isImageMime(mime: string) {
  return mime.startsWith("image/");
}

// --- Stock level color ---
function stockColorClass(stk: number, minStk: number): string {
  if (stk <= 0) return "text-danger";
  if (minStk > 0 && stk <= minStk) return "text-warning";
  return "text-success";
}

// --- Audit helpers ---
function parseJson(val: string | null): Record<string, unknown> | null {
  if (!val) return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function actionLabel(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- Info field helper ---
interface InfoField {
  label: string;
  value: string | null | undefined;
  link?: boolean;
  badge?: boolean;
}

const infoFields = computed<InfoField[]>(() => {
  if (!part.value) return [];
  return [
    { label: "Category", value: part.value.category_path },
    { label: "Manufacturer", value: part.value.manufacturer },
    { label: "MPN", value: part.value.mpn },
    { label: "IPN", value: part.value.ipn },
    { label: "Footprint", value: part.value.footprint },
    { label: "Manufacturing Status", value: part.value.manufacturing_status, badge: true },
    { label: "Datasheet", value: part.value.datasheet_url, link: true },
    { label: "Keywords", value: part.value.keywords },
  ];
});
</script>

<template>
  <!-- Loading -->
  <div v-if="isLoading" class="flex items-center justify-center py-24">
    <LoadingSpinner size="lg" />
  </div>

  <!-- Error -->
  <div
    v-else-if="isError || !part"
    class="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-xs text-danger"
  >
    Part not found or failed to load.
    <button class="ml-2 underline" @click="router.push('/parts')">Back to parts</button>
  </div>

  <div v-else>
    <!-- Header -->
    <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-3">
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted transition-colors hover:border-border-hover hover:text-zinc-300"
          @click="router.push('/parts')"
        >
          <ArrowLeft :size="14" />
        </button>
        <h1 class="text-lg font-semibold text-zinc-100 tracking-wide">{{ part.name }}</h1>
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
          :class="part.favorite ? 'text-warning' : 'text-muted hover:text-warning'"
          :title="part.favorite ? 'Remove from favorites' : 'Add to favorites'"
          @click="toggleFavorite"
        >
          <Star
            :size="16"
            :stroke-width="1.8"
            :class="part.favorite ? 'fill-warning' : ''"
          />
        </button>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-1 px-3 text-xs text-zinc-300 transition-colors hover:border-border-hover hover:bg-surface-2"
          @click="openEditModal"
        >
          <Pencil :size="13" :stroke-width="1.8" />
          Edit
        </button>
        <button
          class="flex h-8 items-center gap-1.5 rounded-md border border-danger/30 bg-danger/5 px-3 text-xs text-danger transition-colors hover:bg-danger/10"
          @click="showDeleteConfirm = true"
        >
          <Trash2 :size="13" :stroke-width="1.8" />
          Delete
        </button>
      </div>
    </div>

    <!-- Info Grid -->
    <div class="mb-6 grid gap-4 lg:grid-cols-3">
      <!-- Left: Properties -->
      <div class="lg:col-span-2 rounded-lg border border-border bg-surface-1 p-4">
        <h2 class="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted">
          Properties
        </h2>
        <dl class="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          <div v-for="field in infoFields" :key="field.label" class="flex flex-col">
            <dt class="text-[11px] text-muted">{{ field.label }}</dt>
            <dd class="mt-0.5 text-xs">
              <!-- Badge -->
              <StatusBadge
                v-if="field.badge && field.value"
                :status="field.value"
              />
              <!-- Link -->
              <a
                v-else-if="field.link && field.value"
                :href="field.value"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-accent hover:underline"
              >
                <span class="truncate max-w-xs">{{ field.value }}</span>
                <ExternalLink :size="11" />
              </a>
              <!-- Text -->
              <span v-else-if="field.value" class="text-zinc-200">{{ field.value }}</span>
              <span v-else class="text-muted/50">&mdash;</span>
            </dd>
          </div>
        </dl>

        <!-- Tags -->
        <div v-if="part.tags.length > 0" class="mt-4 border-t border-border pt-3">
          <span class="text-[11px] text-muted">Tags</span>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <span
              v-for="tag in part.tags"
              :key="tag"
              class="inline-block rounded-full border border-accent/20 bg-accent/5 px-2 py-0.5 text-[11px] text-accent"
            >
              {{ tag }}
            </span>
          </div>
        </div>

        <!-- Description -->
        <div v-if="part.description" class="mt-4 border-t border-border pt-3">
          <span class="text-[11px] text-muted">Description</span>
          <p class="mt-1 text-xs text-zinc-300 leading-relaxed">{{ part.description }}</p>
        </div>
      </div>

      <!-- Right: Thumbnail + Stock -->
      <div class="flex flex-col gap-4">
        <!-- Thumbnail -->
        <div class="group relative flex items-center justify-center rounded-lg border border-border bg-surface-1 p-4">
          <div v-if="part.thumbnail" class="h-32 w-32 overflow-hidden rounded-md">
            <img
              :src="`data:image/jpeg;base64,${part.thumbnail}`"
              :alt="part.name"
              class="h-full w-full object-cover"
            />
          </div>
          <div
            v-else
            class="flex h-32 w-32 items-center justify-center rounded-md bg-surface-2 text-muted"
          >
            <Package :size="40" :stroke-width="1" />
          </div>
          <!-- Clear thumbnail button -->
          <button
            v-if="part.thumbnail"
            class="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded bg-surface-0/80 text-muted opacity-0 group-hover:opacity-100 transition-opacity hover:bg-danger/10 hover:text-danger"
            title="Clear thumbnail"
            :disabled="clearThumbnailMutation.isPending.value"
            @click="clearThumbnailMutation.mutate()"
          >
            <X :size="13" />
          </button>
        </div>

        <!-- Stock overview -->
        <div class="rounded-lg border border-border bg-surface-1 p-4">
          <h2 class="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted">
            Stock Overview
          </h2>
          <div class="text-center">
            <div
              class="text-3xl font-bold tabular-nums"
              :class="stockColorClass(part.stock, part.min_stock)"
            >
              {{ part.stock }}
            </div>
            <div class="mt-1 text-[11px] text-muted">total in stock</div>
            <div v-if="part.min_stock > 0" class="mt-2 text-[11px] text-muted">
              Min threshold:
              <span class="text-zinc-300">{{ part.min_stock }}</span>
            </div>
            <div class="mt-2">
              <StockIndicator :stock="part.stock" :min-stock="part.min_stock" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="mb-4 flex items-center gap-0 border-b border-border">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="relative flex items-center gap-1.5 px-4 py-2.5 text-xs transition-colors"
        :class="
          activeTab === tab.key
            ? 'text-accent'
            : 'text-muted hover:text-zinc-300'
        "
        @click="activeTab = tab.key"
      >
        <component :is="tab.icon" :size="13" :stroke-width="1.8" />
        {{ tab.label }}
        <span
          v-if="activeTab === tab.key"
          class="absolute bottom-0 left-0 right-0 h-[2px] bg-accent"
        />
      </button>
    </div>

    <!-- Tab Content -->

    <!-- Parameters -->
    <div v-if="activeTab === 'parameters'">
      <div
        v-if="(part.parameters?.length ?? 0) === 0 && !newParam.key"
        class="rounded-lg border border-border bg-surface-1 p-6"
      >
        <EmptyState
          title="No parameters"
          description="Add key-value parameters like resistance, capacitance, voltage rating, etc."
        />
      </div>

      <div v-else class="overflow-x-auto rounded-lg border border-border">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-border bg-surface-1 text-left">
              <th class="px-4 py-2.5 text-muted">Parameter</th>
              <th class="px-4 py-2.5 text-muted">Value</th>
              <th class="px-4 py-2.5 text-muted">Unit</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(param, idx) in part.parameters"
              :key="param.key"
              class="border-b border-border/50"
              :class="idx % 2 === 1 ? 'bg-surface-1/30' : ''"
            >
              <td class="px-4 py-2 font-medium text-zinc-300">{{ param.key }}</td>
              <td class="px-4 py-2 text-zinc-200">{{ param.value }}</td>
              <td class="px-4 py-2 text-muted">{{ param.unit ?? "\u2014" }}</td>
            </tr>

            <!-- Add row -->
            <tr class="border-t border-border bg-surface-1/50">
              <td class="px-4 py-2">
                <input
                  v-model="newParam.key"
                  type="text"
                  placeholder="Parameter name"
                  class="h-7 w-full rounded border border-border bg-surface-0 px-2 text-xs text-zinc-200 placeholder-muted/50 outline-none focus:border-accent/50"
                />
              </td>
              <td class="px-4 py-2">
                <input
                  v-model="newParam.value"
                  type="text"
                  placeholder="Value"
                  class="h-7 w-full rounded border border-border bg-surface-0 px-2 text-xs text-zinc-200 placeholder-muted/50 outline-none focus:border-accent/50"
                />
              </td>
              <td class="px-4 py-2">
                <div class="flex items-center gap-2">
                  <input
                    v-model="newParam.unit"
                    type="text"
                    placeholder="Unit"
                    class="h-7 w-full rounded border border-border bg-surface-0 px-2 text-xs text-zinc-200 placeholder-muted/50 outline-none focus:border-accent/50"
                    @keydown.enter="addParameter"
                  />
                  <button
                    class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border border-accent/30 bg-accent/10 text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
                    :disabled="!newParam.key.trim() || !newParam.value.trim() || addParamMutation.isPending.value"
                    @click="addParameter"
                  >
                    <Plus :size="14" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Stock Lots -->
    <div v-if="activeTab === 'stock'">
      <div class="mb-3 flex items-center gap-2">
        <button
          class="flex h-8 items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-3 text-xs text-accent transition-colors hover:bg-accent/20"
          @click="showAddStockModal = true"
        >
          <Plus :size="14" />
          Add Stock
        </button>
        <button
          class="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-1 px-3 text-xs text-zinc-300 transition-colors hover:border-border-hover hover:bg-surface-2"
          @click="showAdjustStockModal = true"
        >
          Adjust Stock
        </button>
      </div>

      <div v-if="!stockLots?.length" class="rounded-lg border border-border bg-surface-1 p-6">
        <EmptyState title="No stock lots" description="Add stock to track inventory by location." />
      </div>

      <div v-else class="overflow-x-auto rounded-lg border border-border">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-border bg-surface-1 text-left">
              <th class="px-4 py-2.5 text-muted">Location</th>
              <th class="px-4 py-2.5 text-muted">Quantity</th>
              <th class="px-4 py-2.5 text-muted">Status</th>
              <th class="px-4 py-2.5 text-muted">Expiry</th>
              <th class="px-4 py-2.5 text-muted">Notes</th>
              <th class="px-4 py-2.5 text-muted">Updated</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(lot, idx) in stockLots"
              :key="lot.id"
              class="border-b border-border/50"
              :class="idx % 2 === 1 ? 'bg-surface-1/30' : ''"
            >
              <td class="px-4 py-2 text-zinc-200">
                {{ lot.location_path ?? lot.location_name ?? "\u2014" }}
              </td>
              <td class="px-4 py-2">
                <span
                  class="font-medium tabular-nums"
                  :class="lot.quantity > 0 ? 'text-success' : 'text-danger'"
                >
                  {{ lot.quantity }}
                </span>
              </td>
              <td class="px-4 py-2">
                <StatusBadge :status="lot.status" />
              </td>
              <td class="px-4 py-2 text-muted">
                {{ lot.expiry_date ? formatDate(lot.expiry_date) : "\u2014" }}
              </td>
              <td class="px-4 py-2 text-muted max-w-xs truncate">
                {{ lot.notes ?? "\u2014" }}
              </td>
              <td class="px-4 py-2 text-muted whitespace-nowrap">
                {{ timeAgo(lot.updated_at) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Suppliers -->
    <div v-if="activeTab === 'suppliers'">
      <div v-if="!supplierParts?.length" class="rounded-lg border border-border bg-surface-1 p-6">
        <EmptyState
          title="No linked suppliers"
          description="Link supplier parts to track pricing and availability."
        />
      </div>

      <div v-else class="overflow-x-auto rounded-lg border border-border">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-border bg-surface-1 text-left">
              <th class="px-4 py-2.5 text-muted">Supplier</th>
              <th class="px-4 py-2.5 text-muted">SKU</th>
              <th class="px-4 py-2.5 text-muted">URL</th>
              <th class="px-4 py-2.5 text-muted">Price Breaks</th>
              <th class="px-4 py-2.5 text-muted">Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(sp, idx) in supplierParts"
              :key="sp.id"
              class="border-b border-border/50"
              :class="[
                idx % 2 === 1 ? 'bg-surface-1/30' : '',
                bestPrice && bestPrice.supplier_part.id === sp.id ? 'ring-1 ring-inset ring-success/30' : '',
              ]"
            >
              <td class="px-4 py-2">
                <div class="flex items-center gap-1.5">
                  <span class="font-medium text-zinc-200">{{ sp.supplier_name }}</span>
                  <span
                    v-if="bestPrice && bestPrice.supplier_part.id === sp.id"
                    class="rounded-full bg-success/10 border border-success/20 px-1.5 py-0.5 text-[10px] text-success"
                  >
                    BEST
                  </span>
                </div>
              </td>
              <td class="px-4 py-2 font-mono text-zinc-300">
                {{ sp.sku ?? "\u2014" }}
              </td>
              <td class="px-4 py-2">
                <a
                  v-if="sp.url"
                  :href="sp.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  <ExternalLink :size="11" />
                  Link
                </a>
                <span v-else class="text-muted">&mdash;</span>
              </td>
              <td class="px-4 py-2">
                <div v-if="sp.price_breaks.length > 0" class="flex flex-col gap-0.5">
                  <span
                    v-for="pb in sp.price_breaks"
                    :key="pb.id"
                    class="text-zinc-300"
                  >
                    <span class="text-muted">{{ pb.min_quantity }}+:</span>
                    {{ formatCurrency(pb.price, pb.currency) }}
                  </span>
                </div>
                <span v-else class="text-muted">&mdash;</span>
              </td>
              <td class="px-4 py-2 text-muted max-w-xs truncate">
                {{ sp.notes ?? "\u2014" }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Best price summary -->
      <div
        v-if="bestPrice"
        class="mt-3 flex items-center gap-3 rounded-lg border border-success/20 bg-success/5 px-4 py-2.5 text-xs"
      >
        <span class="text-muted">Best unit price:</span>
        <span class="font-medium text-success">
          {{ formatCurrency(bestPrice.unit_price, bestPrice.price_break.currency) }}
        </span>
        <span class="text-muted">
          from {{ bestPrice.supplier_part.supplier_name }}
          ({{ bestPrice.price_break.min_quantity }}+ qty)
        </span>
      </div>
    </div>

    <!-- Attachments -->
    <div v-if="activeTab === 'attachments'">
      <!-- Upload zone -->
      <div
        class="mb-4 flex items-center justify-center rounded-lg border-2 border-dashed transition-colors"
        :class="
          isDragging
            ? 'border-accent bg-accent/5'
            : 'border-border bg-surface-1/50 hover:border-border-hover'
        "
        @dragover.prevent="isDragging = true"
        @dragleave="isDragging = false"
        @drop.prevent="onDrop"
      >
        <div class="flex flex-col items-center gap-2 py-8">
          <Upload :size="24" :stroke-width="1.2" class="text-muted" />
          <p class="text-xs text-muted">
            Drop files here or
            <button
              class="text-accent hover:underline"
              @click="fileInput?.click()"
            >
              browse
            </button>
          </p>
          <input
            ref="fileInput"
            type="file"
            multiple
            class="hidden"
            @change="onFileSelect"
          />
        </div>
      </div>

      <div
        v-if="uploadMutation.isPending.value"
        class="mb-3 flex items-center gap-2 text-xs text-muted"
      >
        <LoadingSpinner size="sm" />
        Uploading...
      </div>

      <div v-if="!attachmentList?.length && !uploadMutation.isPending.value" class="rounded-lg border border-border bg-surface-1 p-6">
        <EmptyState
          title="No attachments"
          description="Upload datasheets, images, or CAD files."
        />
      </div>

      <!-- Attachment grid -->
      <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="att in attachmentList"
          :key="att.id"
          class="group relative rounded-lg border border-border bg-surface-1 p-3 transition-colors hover:border-border-hover"
        >
          <!-- Image preview -->
          <div
            v-if="isImageMime(att.mime_type)"
            class="mb-2 flex h-32 items-center justify-center overflow-hidden rounded-md bg-surface-0"
          >
            <img
              :src="attachments.fileUrl(att.id)"
              :alt="att.filename"
              class="h-full w-full object-contain"
              loading="lazy"
            />
          </div>
          <div
            v-else
            class="mb-2 flex h-32 items-center justify-center rounded-md bg-surface-0"
          >
            <FileText :size="32" :stroke-width="1" class="text-muted/50" />
          </div>

          <!-- Info -->
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="truncate text-xs font-medium text-zinc-200" :title="att.filename">
                {{ att.filename }}
              </p>
              <p class="mt-0.5 text-[11px] text-muted">
                {{ att.mime_type }} &middot; {{ formatBytes(att.size_bytes) }}
              </p>
            </div>
            <div class="flex items-center gap-1">
              <button
                v-if="isImageMime(att.mime_type)"
                class="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-accent/10 hover:text-accent"
                title="Use as thumbnail"
                :disabled="setThumbnailMutation.isPending.value"
                @click="setThumbnailMutation.mutate(att.id)"
              >
                <ImagePlus :size="13" />
              </button>
              <a
                :href="attachments.fileUrl(att.id)"
                download
                class="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface-2 hover:text-zinc-300"
                title="Download"
              >
                <Download :size="13" />
              </a>
              <button
                class="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                title="Delete"
                @click="deleteAttachmentMutation.mutate(att.id)"
              >
                <X :size="13" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- History -->
    <div v-if="activeTab === 'history'">
      <div v-if="!auditLog?.length" class="rounded-lg border border-border bg-surface-1 p-6">
        <EmptyState title="No history" description="Changes to this part will appear here." />
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="entry in auditLog"
          :key="entry.id"
          class="rounded-lg border border-border bg-surface-1 p-3"
        >
          <div class="flex items-center justify-between gap-4">
            <div class="flex items-center gap-2">
              <span
                class="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                :class="{
                  'bg-success/10 text-success border border-success/20': entry.action === 'create',
                  'bg-accent/10 text-accent border border-accent/20': entry.action === 'update',
                  'bg-danger/10 text-danger border border-danger/20': entry.action === 'delete',
                  'bg-muted/10 text-muted border border-muted/20':
                    !['create', 'update', 'delete'].includes(entry.action),
                }"
              >
                {{ actionLabel(entry.action) }}
              </span>
              <span v-if="entry.user" class="text-xs text-zinc-300">{{ entry.user }}</span>
            </div>
            <span class="text-[11px] text-muted whitespace-nowrap" :title="formatDateTime(entry.timestamp)">
              {{ timeAgo(entry.timestamp) }}
            </span>
          </div>

          <!-- Changes diff -->
          <div
            v-if="entry.old_values || entry.new_values"
            class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            <div v-if="entry.old_values" class="rounded border border-border bg-surface-0 p-2">
              <span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-danger">Old</span>
              <pre class="overflow-x-auto text-[11px] text-zinc-400 leading-relaxed">{{ JSON.stringify(parseJson(entry.old_values), null, 2) }}</pre>
            </div>
            <div v-if="entry.new_values" class="rounded border border-border bg-surface-0 p-2">
              <span class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-success">New</span>
              <pre class="overflow-x-auto text-[11px] text-zinc-400 leading-relaxed">{{ JSON.stringify(parseJson(entry.new_values), null, 2) }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Part Modal -->
    <Modal :open="showEditModal" title="Edit Part" @close="showEditModal = false">
      <form class="flex flex-col gap-4" @submit.prevent="submitEdit">
        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Name <span class="text-danger">*</span>
          </label>
          <input
            v-model="editForm.name"
            type="text"
            required
            class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 outline-none focus:border-accent/50"
          />
        </div>

        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Description
          </label>
          <textarea
            v-model="editForm.description"
            rows="2"
            class="w-full resize-none rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-accent/50"
          />
        </div>

        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Category
          </label>
          <input
            v-model="editForm.category"
            type="text"
            placeholder="e.g. ICs/Timers"
            class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 placeholder-muted/50 outline-none focus:border-accent/50"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
              Manufacturer
            </label>
            <input
              v-model="editForm.manufacturer"
              type="text"
              class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 outline-none focus:border-accent/50"
            />
          </div>
          <div>
            <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
              MPN
            </label>
            <input
              v-model="editForm.mpn"
              type="text"
              class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 outline-none focus:border-accent/50"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
              IPN
            </label>
            <input
              v-model="editForm.ipn"
              type="text"
              class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 outline-none focus:border-accent/50"
            />
          </div>
          <div>
            <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
              Footprint
            </label>
            <input
              v-model="editForm.footprint"
              type="text"
              class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 outline-none focus:border-accent/50"
            />
          </div>
        </div>

        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Keywords
          </label>
          <input
            v-model="editForm.keywords"
            type="text"
            placeholder="Space-separated keywords"
            class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 placeholder-muted/50 outline-none focus:border-accent/50"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
              Datasheet URL
            </label>
            <input
              v-model="editForm.datasheet_url"
              type="url"
              placeholder="https://..."
              class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 placeholder-muted/50 outline-none focus:border-accent/50"
            />
          </div>
          <div>
            <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
              Manufacturing Status
            </label>
            <select
              v-model="editForm.manufacturing_status"
              class="h-8 w-full rounded-md border border-border bg-surface-0 px-2 text-xs text-zinc-200 outline-none focus:border-accent/50"
            >
              <option value="unknown">Unknown</option>
              <option value="active">Active</option>
              <option value="nrnd">NRND</option>
              <option value="obsolete">Obsolete</option>
              <option value="eol">End of Life</option>
            </select>
          </div>
        </div>

        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Min Stock
          </label>
          <input
            v-model.number="editForm.min_stock"
            type="number"
            min="0"
            class="h-8 w-32 rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 outline-none focus:border-accent/50"
          />
        </div>

        <div
          v-if="editMutation.isError.value"
          class="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger"
        >
          {{ (editMutation.error.value as Error)?.message ?? "Failed to update part" }}
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border bg-surface-2 px-4 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-surface-3"
          @click="showEditModal = false"
        >
          Cancel
        </button>
        <button
          class="rounded-md border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
          :disabled="!editForm.name.trim() || editMutation.isPending.value"
          @click="submitEdit"
        >
          <span v-if="editMutation.isPending.value">Saving...</span>
          <span v-else>Save Changes</span>
        </button>
      </template>
    </Modal>

    <!-- Add Stock Modal -->
    <Modal :open="showAddStockModal" title="Add Stock" @close="showAddStockModal = false">
      <form class="flex flex-col gap-4" @submit.prevent="submitAddStock">
        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Quantity <span class="text-danger">*</span>
          </label>
          <input
            v-model.number="stockForm.quantity"
            type="number"
            min="1"
            required
            class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 outline-none focus:border-accent/50"
          />
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Location
          </label>
          <input
            v-model="stockForm.location"
            type="text"
            placeholder="e.g. Shelf A1 / Drawer 3"
            class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 placeholder-muted/50 outline-none focus:border-accent/50"
          />
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Status
          </label>
          <select
            v-model="stockForm.status"
            class="h-8 w-full rounded-md border border-border bg-surface-0 px-2 text-xs text-zinc-200 outline-none focus:border-accent/50"
          >
            <option value="ok">OK</option>
            <option value="damaged">Damaged</option>
            <option value="quarantined">Quarantined</option>
            <option value="returned">Returned</option>
          </select>
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Notes
          </label>
          <textarea
            v-model="stockForm.notes"
            rows="2"
            placeholder="Optional notes"
            class="w-full resize-none rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder-muted/50 outline-none focus:border-accent/50"
          />
        </div>

        <div
          v-if="addStockMutation.isError.value"
          class="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger"
        >
          {{ (addStockMutation.error.value as Error)?.message ?? "Failed to add stock" }}
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border bg-surface-2 px-4 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-surface-3"
          @click="showAddStockModal = false"
        >
          Cancel
        </button>
        <button
          class="rounded-md border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
          :disabled="stockForm.quantity <= 0 || addStockMutation.isPending.value"
          @click="submitAddStock"
        >
          <span v-if="addStockMutation.isPending.value">Adding...</span>
          <span v-else>Add Stock</span>
        </button>
      </template>
    </Modal>

    <!-- Adjust Stock Modal -->
    <Modal :open="showAdjustStockModal" title="Adjust Stock" @close="showAdjustStockModal = false">
      <form class="flex flex-col gap-4" @submit.prevent="submitAdjustStock">
        <p class="text-xs text-muted">
          Enter a positive number to add stock or a negative number to remove stock.
        </p>
        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Quantity Adjustment <span class="text-danger">*</span>
          </label>
          <input
            v-model.number="adjustForm.quantity"
            type="number"
            required
            class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 outline-none focus:border-accent/50"
          />
        </div>
        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Reason <span class="text-danger">*</span>
          </label>
          <input
            v-model="adjustForm.reason"
            type="text"
            required
            placeholder="e.g. Inventory correction, shrinkage, found extra units"
            class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 placeholder-muted/50 outline-none focus:border-accent/50"
          />
        </div>

        <div
          v-if="adjustStockMutation.isError.value"
          class="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger"
        >
          {{ (adjustStockMutation.error.value as Error)?.message ?? "Failed to adjust stock" }}
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border bg-surface-2 px-4 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-surface-3"
          @click="showAdjustStockModal = false"
        >
          Cancel
        </button>
        <button
          class="rounded-md border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
          :disabled="!adjustForm.reason.trim() || adjustStockMutation.isPending.value"
          @click="submitAdjustStock"
        >
          <span v-if="adjustStockMutation.isPending.value">Adjusting...</span>
          <span v-else>Adjust</span>
        </button>
      </template>
    </Modal>

    <!-- Delete Confirmation Modal -->
    <Modal :open="showDeleteConfirm" title="Delete Part" @close="showDeleteConfirm = false">
      <div class="flex flex-col items-center gap-3 py-2">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
          <Trash2 :size="24" :stroke-width="1.5" class="text-danger" />
        </div>
        <p class="text-center text-xs text-zinc-300">
          Are you sure you want to delete
          <span class="font-semibold text-zinc-100">{{ part.name }}</span>?
        </p>
        <p class="text-center text-[11px] text-muted">
          This will permanently remove the part, all stock lots, and associated data. This action cannot be undone.
        </p>
      </div>

      <div
        v-if="deleteMutation.isError.value"
        class="mt-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger"
      >
        {{ (deleteMutation.error.value as Error)?.message ?? "Failed to delete part" }}
      </div>

      <template #footer>
        <button
          class="rounded-md border border-border bg-surface-2 px-4 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-surface-3"
          @click="showDeleteConfirm = false"
        >
          Cancel
        </button>
        <button
          class="rounded-md border border-danger/30 bg-danger/10 px-4 py-1.5 text-xs text-danger transition-colors hover:bg-danger/20 disabled:opacity-40"
          :disabled="deleteMutation.isPending.value"
          @click="confirmDelete"
        >
          <span v-if="deleteMutation.isPending.value">Deleting...</span>
          <span v-else>Delete Part</span>
        </button>
      </template>
    </Modal>
  </div>
</template>
