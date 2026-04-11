<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { audit } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { AuditLogEntry } from "@/lib/types";
import DataTable from "@/components/DataTable.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import { ScrollText, ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-vue-next";

const router = useRouter();

// --- Filters ---
const entityTypes = [
  { label: "All", value: "" },
  { label: "Part", value: "part" },
  { label: "Category", value: "category" },
  { label: "Stock Lot", value: "stock_lot" },
  { label: "Supplier", value: "supplier" },
  { label: "Supplier Part", value: "supplier_part" },
  { label: "Project", value: "project" },
  { label: "BOM Line", value: "bom_line" },
  { label: "Build Order", value: "build_order" },
  { label: "Purchase Order", value: "purchase_order" },
  { label: "PO Line", value: "po_line" },
  { label: "Attachment", value: "attachment" },
  { label: "Location", value: "storage_location" },
];

const actionTypes = [
  { label: "All", value: "" },
  { label: "Create", value: "create" },
  { label: "Update", value: "update" },
  { label: "Delete", value: "delete" },
];

const filterEntityType = ref("");
const filterAction = ref("");
const filterSince = ref("");

// --- Pagination ---
const limit = 50;
const offset = ref(0);

// Reset offset when filters change
watch([filterEntityType, filterAction, filterSince], () => {
  offset.value = 0;
});

const filters = computed(() => ({
  entity_type: filterEntityType.value || undefined,
  action: filterAction.value || undefined,
  since: filterSince.value || undefined,
  limit,
  offset: offset.value,
}));

// --- Data fetching ---
const { data: entries, isLoading } = useQuery({
  queryKey: ["audit", filters],
  queryFn: () => audit.list(filters.value),
});

const rows = computed(() => entries.value ?? []);
const hasMore = computed(() => rows.value.length === limit);
const currentPage = computed(() => Math.floor(offset.value / limit) + 1);

function prevPage() {
  if (offset.value >= limit) {
    offset.value -= limit;
  }
}

function nextPage() {
  if (hasMore.value) {
    offset.value += limit;
  }
}

// --- Expanded rows ---
const expandedRows = ref<Set<number>>(new Set());

function toggleExpand(id: number) {
  if (expandedRows.value.has(id)) {
    expandedRows.value.delete(id);
  } else {
    expandedRows.value.add(id);
  }
}

// --- Table ---
const columns = [
  { key: "timestamp", label: "Timestamp" },
  { key: "action", label: "Action" },
  { key: "entity_type", label: "Entity Type" },
  { key: "entity_id", label: "Entity ID", class: "text-right" },
  { key: "user", label: "User" },
  { key: "changes", label: "Changes" },
];

// --- Action badge colors ---
function actionColor(action: string): string {
  switch (action) {
    case "create":
      return "text-success bg-success/10 border-success/20";
    case "update":
      return "text-accent bg-accent/10 border-accent/20";
    case "delete":
      return "text-danger bg-danger/10 border-danger/20";
    default:
      return "text-muted bg-muted/10 border-muted/20";
  }
}

// --- Entity navigation ---
function entityRoute(entry: AuditLogEntry): string | null {
  switch (entry.entity_type) {
    case "part":
      return `/parts/${entry.entity_id}`;
    case "category":
      return `/categories`;
    case "storage_location":
      return `/locations`;
    case "supplier":
      return `/suppliers/${entry.entity_id}`;
    case "project":
      return `/projects/${entry.entity_id}`;
    case "purchase_order":
      return `/purchase-orders/${entry.entity_id}`;
    default:
      return null;
  }
}

function navigateToEntity(entry: AuditLogEntry) {
  const route = entityRoute(entry);
  if (route) router.push(route);
}

// --- JSON formatting ---
function formatJson(raw: string | null): string {
  if (!raw) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function parseChanges(entry: AuditLogEntry): { old: string; new: string } {
  return {
    old: formatJson(entry.old_values),
    new: formatJson(entry.new_values),
  };
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center gap-3">
      <ScrollText class="h-5 w-5 text-accent" />
      <h1 class="text-lg font-semibold text-zinc-100">Audit Log</h1>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap items-end gap-3">
      <div>
        <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
          Entity Type
        </label>
        <select
          v-model="filterEntityType"
          class="rounded-md border border-border bg-surface-1 px-3 py-1.5 text-xs text-zinc-200 focus:border-accent focus:outline-none min-w-[140px]"
        >
          <option v-for="et in entityTypes" :key="et.value" :value="et.value">
            {{ et.label }}
          </option>
        </select>
      </div>
      <div>
        <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
          Action
        </label>
        <select
          v-model="filterAction"
          class="rounded-md border border-border bg-surface-1 px-3 py-1.5 text-xs text-zinc-200 focus:border-accent focus:outline-none min-w-[120px]"
        >
          <option v-for="at in actionTypes" :key="at.value" :value="at.value">
            {{ at.label }}
          </option>
        </select>
      </div>
      <div>
        <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
          Since
        </label>
        <input
          v-model="filterSince"
          type="date"
          class="rounded-md border border-border bg-surface-1 px-3 py-1.5 text-xs text-zinc-200 focus:border-accent focus:outline-none"
        />
      </div>
      <button
        v-if="filterEntityType || filterAction || filterSince"
        class="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
        @click="filterEntityType = ''; filterAction = ''; filterSince = ''"
      >
        Clear Filters
      </button>
    </div>

    <!-- Table -->
    <DataTable :columns="columns" :rows="rows" :loading="isLoading">
      <template #cell-timestamp="{ row }">
        <span class="text-muted tabular-nums whitespace-nowrap">{{ formatDateTime(row.timestamp) }}</span>
      </template>

      <template #cell-action="{ row }">
        <span
          :class="actionColor(row.action)"
          class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none tracking-wide uppercase whitespace-nowrap"
        >
          {{ row.action }}
        </span>
      </template>

      <template #cell-entity_type="{ row }">
        <span class="text-zinc-300">{{ row.entity_type.replace(/_/g, " ") }}</span>
      </template>

      <template #cell-entity_id="{ row }">
        <button
          v-if="entityRoute(row)"
          class="text-accent hover:underline tabular-nums"
          @click.stop="navigateToEntity(row)"
        >
          #{{ row.entity_id }}
        </button>
        <span v-else class="text-muted tabular-nums">#{{ row.entity_id }}</span>
      </template>

      <template #cell-user="{ row }">
        <span class="text-muted">{{ row.user ?? "system" }}</span>
      </template>

      <template #cell-changes="{ row }">
        <button
          v-if="row.old_values || row.new_values"
          class="flex items-center gap-1 text-[11px] text-accent hover:underline"
          @click.stop="toggleExpand(row.id)"
        >
          <component
            :is="expandedRows.has(row.id) ? ChevronUp : ChevronDown"
            class="h-3 w-3"
          />
          {{ expandedRows.has(row.id) ? "Hide" : "View" }}
        </button>
        <span v-else class="text-muted">—</span>

        <!-- Expanded JSON -->
        <div
          v-if="expandedRows.has(row.id)"
          class="mt-2 space-y-2"
          @click.stop
        >
          <div v-if="row.old_values" class="space-y-1">
            <span class="text-[10px] uppercase tracking-wider text-danger/80 font-medium">Old Values</span>
            <pre class="rounded bg-surface-0 border border-border p-2 text-[11px] text-zinc-400 overflow-x-auto max-h-40 whitespace-pre-wrap">{{ parseChanges(row).old }}</pre>
          </div>
          <div v-if="row.new_values" class="space-y-1">
            <span class="text-[10px] uppercase tracking-wider text-success/80 font-medium">New Values</span>
            <pre class="rounded bg-surface-0 border border-border p-2 text-[11px] text-zinc-400 overflow-x-auto max-h-40 whitespace-pre-wrap">{{ parseChanges(row).new }}</pre>
          </div>
        </div>
      </template>
    </DataTable>

    <!-- Pagination -->
    <div class="flex items-center justify-between">
      <span class="text-xs text-muted">
        Showing {{ rows.length }} entries
        <span v-if="offset > 0">(page {{ currentPage }})</span>
      </span>
      <div class="flex items-center gap-2">
        <button
          class="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted transition-colors disabled:opacity-30 hover:bg-surface-2 hover:text-zinc-300"
          :disabled="offset === 0"
          @click="prevPage"
        >
          <ChevronLeft class="h-3.5 w-3.5" />
          Previous
        </button>
        <button
          class="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted transition-colors disabled:opacity-30 hover:bg-surface-2 hover:text-zinc-300"
          :disabled="!hasMore"
          @click="nextPage"
        >
          Next
          <ChevronRight class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
