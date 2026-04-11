<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { purchaseOrders, parts as partsApi } from "@/lib/api";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import type { PurchaseOrder, PoLine, Part } from "@/lib/types";
import DataTable from "@/components/DataTable.vue";
import Modal from "@/components/Modal.vue";
import LoadingSpinner from "@/components/LoadingSpinner.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import {
  ArrowLeft,
  Plus,
  PackageCheck,
  Pencil,
  Send,
  XCircle,
  Search,
  Package,
  StickyNote,
  Calendar,
  Truck,
} from "lucide-vue-next";

const props = defineProps<{ id: string }>();
const router = useRouter();
const queryClient = useQueryClient();

const poId = computed(() => Number(props.id));

// --- Data fetching ---
const { data: po, isLoading } = useQuery({
  queryKey: ["purchase-orders", poId],
  queryFn: () => purchaseOrders.get(poId.value),
});

const lines = computed(() => po.value?.lines ?? []);

// --- Status transitions ---
const statusTransitions: Record<string, { label: string; next: string; icon: typeof Send; variant: string }[]> = {
  draft: [
    { label: "Submit Order", next: "ordered", icon: Send, variant: "accent" },
    { label: "Cancel", next: "cancelled", icon: XCircle, variant: "danger" },
  ],
  ordered: [
    { label: "Cancel", next: "cancelled", icon: XCircle, variant: "danger" },
  ],
  partial: [
    { label: "Cancel", next: "cancelled", icon: XCircle, variant: "danger" },
  ],
};

const availableActions = computed(() => {
  if (!po.value) return [];
  return statusTransitions[po.value.status] ?? [];
});

const updateStatusMutation = useMutation({
  mutationFn: (status: string) => purchaseOrders.update(poId.value, { status }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["purchase-orders", poId] });
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
  },
});

// --- Add line modal ---
const showAddLineModal = ref(false);
const lineForm = ref({
  part_id: null as number | null,
  quantity_ordered: 1,
  unit_price: 0,
  currency: "USD",
});
const partSearchQuery = ref("");
const showPartDropdown = ref(false);
const selectedPart = ref<Part | null>(null);

const { data: searchParts } = useQuery({
  queryKey: ["parts-search-po", partSearchQuery],
  queryFn: () => partsApi.list({ search: partSearchQuery.value, limit: 20 }),
  enabled: computed(() => partSearchQuery.value.length >= 1),
});

const partResults = computed(() => searchParts.value ?? []);

function selectPart(part: Part) {
  selectedPart.value = part;
  lineForm.value.part_id = part.id;
  partSearchQuery.value = part.name;
  showPartDropdown.value = false;
}

function openAddLine() {
  lineForm.value = { part_id: null, quantity_ordered: 1, unit_price: 0, currency: "USD" };
  partSearchQuery.value = "";
  selectedPart.value = null;
  showAddLineModal.value = true;
}

const addLineMutation = useMutation({
  mutationFn: (data: { part_id?: number; quantity_ordered: number; unit_price?: number; currency?: string }) =>
    purchaseOrders.addLine(poId.value, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["purchase-orders", poId] });
    showAddLineModal.value = false;
  },
});

function handleAddLine() {
  if (!lineForm.value.part_id) return;
  addLineMutation.mutate({
    part_id: lineForm.value.part_id,
    quantity_ordered: lineForm.value.quantity_ordered,
    unit_price: lineForm.value.unit_price || undefined,
    currency: lineForm.value.currency,
  });
}

// --- Receive line modal ---
const showReceiveModal = ref(false);
const receivingLineId = ref<number | null>(null);
const receiveForm = ref({ quantity_received: 1, location: "" });

function openReceive(line: PoLine) {
  receivingLineId.value = line.id;
  receiveForm.value = {
    quantity_received: line.quantity_ordered - line.quantity_received,
    location: "",
  };
  showReceiveModal.value = true;
}

const receiveLineMutation = useMutation({
  mutationFn: ({ lineId, data }: { lineId: number; data: { quantity_received: number; location?: string } }) =>
    purchaseOrders.receiveLine(lineId, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["purchase-orders", poId] });
    showReceiveModal.value = false;
    receivingLineId.value = null;
  },
});

function handleReceive() {
  if (receivingLineId.value === null) return;
  receiveLineMutation.mutate({
    lineId: receivingLineId.value,
    data: {
      quantity_received: receiveForm.value.quantity_received,
      location: receiveForm.value.location.trim() || undefined,
    },
  });
}

// --- Edit line modal ---
const showEditLineModal = ref(false);
const editingLineId = ref<number | null>(null);
const editLineForm = ref({
  quantity_ordered: 1,
  unit_price: 0,
  currency: "USD",
});

function openEditLine(line: PoLine) {
  editingLineId.value = line.id;
  editLineForm.value = {
    quantity_ordered: line.quantity_ordered,
    unit_price: line.unit_price ?? 0,
    currency: line.currency ?? "USD",
  };
  showEditLineModal.value = true;
}

const editLineMutation = useMutation({
  mutationFn: ({ lineId, data }: { lineId: number; data: { quantity_ordered?: number; unit_price?: number | null; currency?: string | null } }) =>
    purchaseOrders.editLine(lineId, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["purchase-orders", poId] });
    showEditLineModal.value = false;
    editingLineId.value = null;
  },
});

function handleEditLine() {
  if (editingLineId.value === null) return;
  editLineMutation.mutate({
    lineId: editingLineId.value,
    data: {
      quantity_ordered: editLineForm.value.quantity_ordered,
      unit_price: editLineForm.value.unit_price,
      currency: editLineForm.value.currency,
    },
  });
}

// --- Lines table ---
const lineColumns = [
  { key: "part_name", label: "Part" },
  { key: "sku", label: "SKU" },
  { key: "quantity_ordered", label: "Ordered", class: "text-right" },
  { key: "quantity_received", label: "Received", class: "text-right" },
  { key: "unit_price", label: "Unit Price", class: "text-right" },
  { key: "currency", label: "Currency" },
  { key: "total", label: "Total", class: "text-right" },
  { key: "actions", label: "", class: "w-28 text-right" },
];

function lineTotal(line: PoLine): number | null {
  if (line.unit_price == null) return null;
  return line.unit_price * line.quantity_ordered;
}

const grandTotal = computed(() => {
  return lines.value.reduce((sum, line) => {
    const t = lineTotal(line);
    return sum + (t ?? 0);
  }, 0);
});

function actionVariantClasses(variant: string): string {
  switch (variant) {
    case "accent":
      return "bg-accent/10 border-accent/20 text-accent hover:bg-accent/20";
    case "danger":
      return "bg-danger/10 border-danger/20 text-danger hover:bg-danger/20";
    case "success":
      return "bg-success/10 border-success/20 text-success hover:bg-success/20";
    default:
      return "bg-surface-2 border-border text-zinc-300 hover:bg-surface-3";
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Loading -->
    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <LoadingSpinner size="lg" />
    </div>

    <template v-else-if="po">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <button
            class="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
            @click="router.push('/purchase-orders')"
          >
            <ArrowLeft class="h-4 w-4" />
          </button>
          <h1 class="text-lg font-semibold text-zinc-100 tabular-nums">PO-{{ po.id }}</h1>
          <span v-if="po.supplier_name" class="text-xs text-muted">{{ po.supplier_name }}</span>
          <StatusBadge :status="po.status" />
        </div>
        <div class="flex items-center gap-2">
          <button
            v-for="action in availableActions"
            :key="action.next"
            class="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
            :class="actionVariantClasses(action.variant)"
            :disabled="updateStatusMutation.isPending.value"
            @click="updateStatusMutation.mutate(action.next)"
          >
            <component :is="action.icon" class="h-3.5 w-3.5" />
            {{ action.label }}
          </button>
        </div>
      </div>

      <!-- Info card -->
      <div class="rounded-lg border border-border bg-surface-1 p-5">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div class="space-y-1">
            <div class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted font-medium">
              <Truck class="h-3 w-3" />
              Supplier
            </div>
            <p class="text-sm text-zinc-200">{{ po.supplier_name ?? "—" }}</p>
          </div>
          <div class="space-y-1">
            <div class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted font-medium">
              <StickyNote class="h-3 w-3" />
              Notes
            </div>
            <p class="text-sm text-zinc-300 whitespace-pre-wrap">{{ po.notes ?? "—" }}</p>
          </div>
          <div class="space-y-1">
            <div class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted font-medium">
              <Calendar class="h-3 w-3" />
              Created
            </div>
            <p class="text-sm text-zinc-300">{{ formatDateTime(po.created_at) }}</p>
          </div>
          <div class="space-y-1">
            <div class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted font-medium">
              Status
            </div>
            <StatusBadge :status="po.status" />
          </div>
        </div>
      </div>

      <!-- Lines table -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-zinc-200">
            Order Lines
            <span v-if="lines.length" class="text-muted font-normal">({{ lines.length }})</span>
          </h2>
          <button
            v-if="po.status === 'draft'"
            class="flex items-center gap-1.5 rounded-md bg-accent/10 border border-accent/20 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
            @click="openAddLine"
          >
            <Plus class="h-3.5 w-3.5" />
            Add Line
          </button>
        </div>

        <DataTable :columns="lineColumns" :rows="lines" :loading="false">
          <template #cell-part_name="{ row }">
            <span class="font-medium text-zinc-200">{{ row.part_name ?? "—" }}</span>
          </template>

          <template #cell-sku="{ row }">
            <code v-if="row.sku" class="text-accent/80 bg-accent/5 px-1.5 py-0.5 rounded text-[11px]">
              {{ row.sku }}
            </code>
            <span v-else class="text-muted">—</span>
          </template>

          <template #cell-quantity_ordered="{ row }">
            <span class="tabular-nums">{{ row.quantity_ordered }}</span>
          </template>

          <template #cell-quantity_received="{ row }">
            <span
              class="tabular-nums"
              :class="row.quantity_received >= row.quantity_ordered ? 'text-success' : row.quantity_received > 0 ? 'text-warning' : 'text-muted'"
            >
              {{ row.quantity_received }}
            </span>
          </template>

          <template #cell-unit_price="{ row }">
            <span v-if="row.unit_price != null" class="tabular-nums">
              {{ formatCurrency(row.unit_price, row.currency) }}
            </span>
            <span v-else class="text-muted">—</span>
          </template>

          <template #cell-currency="{ row }">
            <span class="text-muted uppercase text-[11px]">{{ row.currency }}</span>
          </template>

          <template #cell-total="{ row }">
            <span v-if="lineTotal(row) != null" class="tabular-nums font-medium text-zinc-200">
              {{ formatCurrency(lineTotal(row)!, row.currency) }}
            </span>
            <span v-else class="text-muted">—</span>
          </template>

          <template #cell-actions="{ row }">
            <div class="flex justify-end gap-1.5" @click.stop>
              <button
                v-if="po?.status === 'draft' || po?.status === 'ordered'"
                class="flex items-center gap-1 rounded-md bg-surface-2 border border-border px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-surface-3 transition-colors"
                @click="openEditLine(row)"
              >
                <Pencil class="h-3 w-3" />
                Edit
              </button>
              <button
                v-if="row.quantity_received < row.quantity_ordered && (po?.status === 'ordered' || po?.status === 'partial')"
                class="flex items-center gap-1 rounded-md bg-success/10 border border-success/20 px-2.5 py-1 text-[11px] font-medium text-success hover:bg-success/20 transition-colors"
                @click="openReceive(row)"
              >
                <PackageCheck class="h-3 w-3" />
                Receive
              </button>
            </div>
          </template>
        </DataTable>

        <!-- Totals summary -->
        <div v-if="lines.length > 0" class="flex justify-end">
          <div class="rounded-lg border border-border bg-surface-1 px-5 py-3 text-right">
            <span class="text-[11px] uppercase tracking-wider text-muted mr-4">Grand Total</span>
            <span class="text-sm font-semibold text-zinc-100 tabular-nums">
              {{ formatCurrency(grandTotal) }}
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- ===== Modals ===== -->

    <!-- Add Line Modal -->
    <Modal :open="showAddLineModal" title="Add Order Line" @close="showAddLineModal = false">
      <form class="space-y-4" @submit.prevent="handleAddLine">
        <div class="relative">
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
            Part <span class="text-danger">*</span>
          </label>
          <div class="relative">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
            <input
              v-model="partSearchQuery"
              type="text"
              placeholder="Search parts..."
              class="w-full rounded-md border border-border bg-surface-0 pl-8 pr-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none"
              @focus="showPartDropdown = true"
              @input="showPartDropdown = true"
            />
          </div>
          <div
            v-if="showPartDropdown && partResults.length > 0"
            class="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-border bg-surface-1 shadow-lg"
          >
            <button
              v-for="part in partResults"
              :key="part.id"
              type="button"
              class="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-zinc-300 hover:bg-surface-2 transition-colors"
              @click="selectPart(part)"
            >
              <Package class="h-3 w-3 text-muted flex-shrink-0" />
              <span class="truncate">{{ part.name }}</span>
            </button>
          </div>
          <p v-if="selectedPart" class="mt-1 text-[11px] text-accent">
            Selected: {{ selectedPart.name }}
          </p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
              Quantity <span class="text-danger">*</span>
            </label>
            <input
              v-model.number="lineForm.quantity_ordered"
              type="number"
              min="1"
              required
              class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 tabular-nums focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
              Unit Price
            </label>
            <input
              v-model.number="lineForm.unit_price"
              type="number"
              min="0"
              step="0.01"
              class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 tabular-nums focus:border-accent focus:outline-none"
            />
          </div>
        </div>
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">Currency</label>
          <select
            v-model="lineForm.currency"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 focus:border-accent focus:outline-none"
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
            <option value="JPY">JPY</option>
            <option value="CNY">CNY</option>
          </select>
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
          @click="showAddLineModal = false"
        >
          Cancel
        </button>
        <button
          class="flex items-center gap-2 rounded-md bg-accent/15 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
          :disabled="!lineForm.part_id || lineForm.quantity_ordered < 1 || addLineMutation.isPending.value"
          @click="handleAddLine"
        >
          <LoadingSpinner v-if="addLineMutation.isPending.value" size="sm" />
          Add Line
        </button>
      </template>
    </Modal>

    <!-- Edit Line Modal -->
    <Modal :open="showEditLineModal" title="Edit Order Line" @close="showEditLineModal = false; editingLineId = null">
      <form class="space-y-4" @submit.prevent="handleEditLine">
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
            Quantity <span class="text-danger">*</span>
          </label>
          <input
            v-model.number="editLineForm.quantity_ordered"
            type="number"
            min="1"
            required
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 tabular-nums focus:border-accent focus:outline-none"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
              Unit Price
            </label>
            <input
              v-model.number="editLineForm.unit_price"
              type="number"
              min="0"
              step="0.0001"
              class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 tabular-nums focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">Currency</label>
            <select
              v-model="editLineForm.currency"
              class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 focus:border-accent focus:outline-none"
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="JPY">JPY</option>
              <option value="CNY">CNY</option>
            </select>
          </div>
        </div>

        <div
          v-if="editLineMutation.isError.value"
          class="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger"
        >
          {{ (editLineMutation.error.value as Error)?.message ?? "Failed to update line" }}
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
          @click="showEditLineModal = false; editingLineId = null"
        >
          Cancel
        </button>
        <button
          class="flex items-center gap-2 rounded-md bg-accent/15 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
          :disabled="editLineForm.quantity_ordered < 1 || editLineMutation.isPending.value"
          @click="handleEditLine"
        >
          <LoadingSpinner v-if="editLineMutation.isPending.value" size="sm" />
          Save Changes
        </button>
      </template>
    </Modal>

    <!-- Receive Line Modal -->
    <Modal :open="showReceiveModal" title="Receive Items" @close="showReceiveModal = false; receivingLineId = null">
      <form class="space-y-4" @submit.prevent="handleReceive">
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
            Quantity Received <span class="text-danger">*</span>
          </label>
          <input
            v-model.number="receiveForm.quantity_received"
            type="number"
            min="1"
            required
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 tabular-nums focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
            Storage Location
          </label>
          <input
            v-model="receiveForm.location"
            type="text"
            placeholder="e.g. Shelf A / Bin 3"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none"
          />
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
          @click="showReceiveModal = false; receivingLineId = null"
        >
          Cancel
        </button>
        <button
          class="flex items-center gap-2 rounded-md bg-success/15 border border-success/30 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/25 transition-colors disabled:opacity-50"
          :disabled="receiveForm.quantity_received < 1 || receiveLineMutation.isPending.value"
          @click="handleReceive"
        >
          <LoadingSpinner v-if="receiveLineMutation.isPending.value" size="sm" />
          Receive
        </button>
      </template>
    </Modal>
  </div>
</template>
