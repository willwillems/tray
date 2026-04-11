<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { purchaseOrders, suppliers } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import type { PurchaseOrder, Supplier } from "@/lib/types";
import DataTable from "@/components/DataTable.vue";
import Modal from "@/components/Modal.vue";
import LoadingSpinner from "@/components/LoadingSpinner.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import { ShoppingCart, Plus } from "lucide-vue-next";

const router = useRouter();
const queryClient = useQueryClient();

// --- Filter tabs ---
const statusTabs = [
  { label: "All", value: undefined },
  { label: "Draft", value: "draft" },
  { label: "Ordered", value: "ordered" },
  { label: "Partial", value: "partial" },
  { label: "Received", value: "received" },
  { label: "Cancelled", value: "cancelled" },
] as const;

const activeStatus = ref<string | undefined>(undefined);

// --- Data fetching ---
const { data: poList, isLoading } = useQuery({
  queryKey: ["purchase-orders", activeStatus],
  queryFn: () => purchaseOrders.list(activeStatus.value),
});

const rows = computed(() => poList.value ?? []);

const { data: supplierList } = useQuery({
  queryKey: ["suppliers"],
  queryFn: () => suppliers.list(),
});

const supplierOptions = computed(() => supplierList.value ?? []);

// --- Create PO modal ---
const showCreateModal = ref(false);
const createForm = ref({ supplier_id: null as number | null, notes: "" });

function openCreate() {
  createForm.value = { supplier_id: null, notes: "" };
  showCreateModal.value = true;
}

const createMutation = useMutation({
  mutationFn: (data: { supplier_id?: number; notes?: string }) => purchaseOrders.create(data),
  onSuccess: (po) => {
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    showCreateModal.value = false;
    router.push(`/purchase-orders/${po.id}`);
  },
});

function handleCreate() {
  createMutation.mutate({
    supplier_id: createForm.value.supplier_id ?? undefined,
    notes: createForm.value.notes.trim() || undefined,
  });
}

// --- Table ---
const columns = [
  { key: "id", label: "PO #" },
  { key: "supplier_name", label: "Supplier" },
  { key: "status", label: "Status" },
  { key: "lines_count", label: "Lines", class: "text-right" },
  { key: "total_cost", label: "Total", class: "text-right" },
  { key: "created_at", label: "Created" },
];

function onRowClick(row: PurchaseOrder) {
  router.push(`/purchase-orders/${row.id}`);
}

function lineCount(po: PurchaseOrder): number {
  return po.lines?.length ?? 0;
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <ShoppingCart class="h-5 w-5 text-accent" />
        <h1 class="text-lg font-semibold text-zinc-100">Purchase Orders</h1>
        <span v-if="rows.length" class="text-xs text-muted">({{ rows.length }})</span>
      </div>
      <button
        class="flex items-center gap-2 rounded-md bg-accent/10 border border-accent/20 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
        @click="openCreate"
      >
        <Plus class="h-3.5 w-3.5" />
        Create PO
      </button>
    </div>

    <!-- Filter tabs -->
    <div class="flex items-center gap-1 border-b border-border">
      <button
        v-for="tab in statusTabs"
        :key="tab.label"
        class="px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px"
        :class="
          activeStatus === tab.value
            ? 'text-accent border-accent'
            : 'text-muted border-transparent hover:text-zinc-300 hover:border-surface-3'
        "
        @click="activeStatus = tab.value"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Table -->
    <DataTable :columns="columns" :rows="rows" :loading="isLoading" @row-click="onRowClick">
      <template #cell-id="{ row }">
        <span class="tabular-nums text-accent font-medium">PO-{{ row.id }}</span>
      </template>

      <template #cell-supplier_name="{ row }">
        <span class="text-zinc-200">{{ row.supplier_name ?? "—" }}</span>
      </template>

      <template #cell-status="{ row }">
        <StatusBadge :status="row.status" />
      </template>

      <template #cell-lines_count="{ row }">
        <span class="tabular-nums">{{ lineCount(row) }}</span>
      </template>

      <template #cell-total_cost="{ row }">
        <span v-if="row.total_cost != null" class="tabular-nums text-zinc-200">
          {{ formatCurrency(row.total_cost) }}
        </span>
        <span v-else class="text-muted">—</span>
      </template>

      <template #cell-created_at="{ row }">
        <span class="text-muted">{{ formatDate(row.created_at) }}</span>
      </template>
    </DataTable>

    <!-- Create PO Modal -->
    <Modal :open="showCreateModal" title="Create Purchase Order" @close="showCreateModal = false">
      <form class="space-y-4" @submit.prevent="handleCreate">
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
            Supplier
          </label>
          <select
            v-model="createForm.supplier_id"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 focus:border-accent focus:outline-none"
          >
            <option :value="null" disabled>Select a supplier...</option>
            <option
              v-for="s in supplierOptions"
              :key="s.id"
              :value="s.id"
            >
              {{ s.name }}
            </option>
          </select>
        </div>
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">Notes</label>
          <textarea
            v-model="createForm.notes"
            rows="3"
            placeholder="Optional notes for this order..."
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none resize-none"
          />
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
          @click="showCreateModal = false"
        >
          Cancel
        </button>
        <button
          class="flex items-center gap-2 rounded-md bg-accent/15 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
          :disabled="createMutation.isPending.value"
          @click="handleCreate"
        >
          <LoadingSpinner v-if="createMutation.isPending.value" size="sm" />
          Create PO
        </button>
      </template>
    </Modal>
  </div>
</template>
