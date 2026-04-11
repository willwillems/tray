<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { suppliers } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import type { Supplier, SupplierPart } from "@/lib/types";
import DataTable from "@/components/DataTable.vue";
import Modal from "@/components/Modal.vue";
import LoadingSpinner from "@/components/LoadingSpinner.vue";
import EmptyState from "@/components/EmptyState.vue";
import {
  ArrowLeft,
  ExternalLink,
  Pencil,
  Trash2,
  Package,
  StickyNote,
  Globe,
} from "lucide-vue-next";

function hostname(url: string): string {
  try { return new globalThis.URL(url).hostname; } catch { return url; }
}

const props = defineProps<{ id: string }>();
const router = useRouter();
const queryClient = useQueryClient();

const supplierId = computed(() => Number(props.id));

// --- Data fetching ---
const { data: supplier, isLoading: loadingSupplier } = useQuery({
  queryKey: ["suppliers", supplierId],
  queryFn: () => suppliers.get(supplierId.value),
});

const { data: supplierParts, isLoading: loadingParts } = useQuery({
  queryKey: ["suppliers", supplierId, "parts"],
  queryFn: () => suppliers.parts(supplierId.value),
});

const parts = computed(() => supplierParts.value ?? []);

// --- Edit modal ---
const showEditModal = ref(false);
const editForm = ref({ name: "", url: "", notes: "" });

function openEdit() {
  if (!supplier.value) return;
  editForm.value = {
    name: supplier.value.name,
    url: supplier.value.url ?? "",
    notes: supplier.value.notes ?? "",
  };
  showEditModal.value = true;
}

const updateMutation = useMutation({
  mutationFn: (data: { name?: string; url?: string | null; notes?: string | null }) =>
    suppliers.update(supplierId.value, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["suppliers", supplierId] });
    showEditModal.value = false;
  },
});

function handleUpdate() {
  updateMutation.mutate({
    name: editForm.value.name.trim(),
    url: editForm.value.url.trim() || null,
    notes: editForm.value.notes.trim() || null,
  });
}

// --- Delete ---
const showDeleteConfirm = ref(false);

const deleteMutation = useMutation({
  mutationFn: () => suppliers.delete(supplierId.value),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    router.push("/suppliers");
  },
});

// --- Parts table ---
const partColumns = [
  { key: "part_name", label: "Part Name" },
  { key: "sku", label: "SKU" },
  { key: "url", label: "URL" },
  { key: "price_breaks", label: "Price Breaks" },
];

function formatPriceBreaks(breaks: SupplierPart["price_breaks"]): string {
  if (!breaks || breaks.length === 0) return "—";
  return breaks
    .map((pb) => `${pb.min_quantity}+ @ ${formatCurrency(pb.price, pb.currency)}`)
    .join(", ");
}
</script>

<template>
  <div class="space-y-6">
    <!-- Loading -->
    <div v-if="loadingSupplier" class="flex items-center justify-center py-20">
      <LoadingSpinner size="lg" />
    </div>

    <template v-else-if="supplier">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <button
            class="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
            @click="router.push('/suppliers')"
          >
            <ArrowLeft class="h-4 w-4" />
          </button>
          <h1 class="text-lg font-semibold text-zinc-100">{{ supplier.name }}</h1>
          <a
            v-if="supplier.url"
            :href="supplier.url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            {{ hostname(supplier.url) }}
            <ExternalLink class="h-3 w-3" />
          </a>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
            @click="openEdit"
          >
            <Pencil class="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            class="flex items-center gap-1.5 rounded-md border border-danger/20 px-3 py-1.5 text-xs text-danger/80 hover:bg-danger/10 hover:text-danger transition-colors"
            @click="showDeleteConfirm = true"
          >
            <Trash2 class="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>

      <!-- Info Card -->
      <div class="rounded-lg border border-border bg-surface-1 p-5">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="space-y-1">
            <div class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted font-medium">
              <Package class="h-3 w-3" />
              Name
            </div>
            <p class="text-sm text-zinc-200">{{ supplier.name }}</p>
          </div>
          <div class="space-y-1">
            <div class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted font-medium">
              <Globe class="h-3 w-3" />
              URL
            </div>
            <a
              v-if="supplier.url"
              :href="supplier.url"
              target="_blank"
              rel="noopener noreferrer"
              class="text-sm text-accent hover:underline inline-flex items-center gap-1"
            >
              {{ supplier.url }}
              <ExternalLink class="h-3 w-3" />
            </a>
            <p v-else class="text-sm text-muted">—</p>
          </div>
          <div class="space-y-1">
            <div class="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted font-medium">
              <StickyNote class="h-3 w-3" />
              Notes
            </div>
            <p class="text-sm text-zinc-300 whitespace-pre-wrap">{{ supplier.notes ?? "—" }}</p>
          </div>
        </div>
      </div>

      <!-- Supplier Parts -->
      <div class="space-y-3">
        <h2 class="text-sm font-semibold text-zinc-200">
          Supplier Parts
          <span v-if="parts.length" class="text-muted font-normal">({{ parts.length }})</span>
        </h2>

        <DataTable
          :columns="partColumns"
          :rows="parts"
          :loading="loadingParts"
          @row-click="(row: SupplierPart) => router.push(`/parts/${row.part_id}`)"
        >
          <template #cell-part_name="{ row }">
            <span class="font-medium text-zinc-200">{{ row.part_name }}</span>
          </template>

          <template #cell-sku="{ row }">
            <code v-if="row.sku" class="text-accent/80 bg-accent/5 px-1.5 py-0.5 rounded text-[11px]">
              {{ row.sku }}
            </code>
            <span v-else class="text-muted">—</span>
          </template>

          <template #cell-url="{ row }">
            <a
              v-if="row.url"
              :href="row.url"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 text-accent hover:underline"
              @click.stop
            >
              Link
              <ExternalLink class="h-3 w-3" />
            </a>
            <span v-else class="text-muted">—</span>
          </template>

          <template #cell-price_breaks="{ row }">
            <div v-if="row.price_breaks && row.price_breaks.length" class="flex flex-wrap gap-2">
              <span
                v-for="pb in row.price_breaks"
                :key="pb.id"
                class="inline-flex items-center gap-1 rounded bg-surface-2 px-2 py-0.5 text-[11px] text-zinc-300"
              >
                <span class="text-muted">{{ pb.min_quantity }}+</span>
                <span class="text-success">{{ formatCurrency(pb.price, pb.currency) }}</span>
              </span>
            </div>
            <span v-else class="text-muted">—</span>
          </template>
        </DataTable>
      </div>
    </template>

    <!-- Edit Modal -->
    <Modal :open="showEditModal" title="Edit Supplier" @close="showEditModal = false">
      <form class="space-y-4" @submit.prevent="handleUpdate">
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
            Name <span class="text-danger">*</span>
          </label>
          <input
            v-model="editForm.name"
            type="text"
            required
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">URL</label>
          <input
            v-model="editForm.url"
            type="url"
            placeholder="https://..."
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">Notes</label>
          <textarea
            v-model="editForm.notes"
            rows="3"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none resize-none"
          />
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
          @click="showEditModal = false"
        >
          Cancel
        </button>
        <button
          class="flex items-center gap-2 rounded-md bg-accent/15 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
          :disabled="!editForm.name.trim() || updateMutation.isPending.value"
          @click="handleUpdate"
        >
          <LoadingSpinner v-if="updateMutation.isPending.value" size="sm" />
          Update
        </button>
      </template>
    </Modal>

    <!-- Delete Confirmation -->
    <Modal :open="showDeleteConfirm" title="Delete Supplier" @close="showDeleteConfirm = false">
      <p class="text-xs text-zinc-300 leading-relaxed">
        Are you sure you want to delete <strong>{{ supplier?.name }}</strong>?
        This will also remove all associated supplier parts and price breaks. This action cannot be undone.
      </p>

      <template #footer>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
          @click="showDeleteConfirm = false"
        >
          Cancel
        </button>
        <button
          class="flex items-center gap-2 rounded-md bg-danger/15 border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/25 transition-colors disabled:opacity-50"
          :disabled="deleteMutation.isPending.value"
          @click="deleteMutation.mutate()"
        >
          <LoadingSpinner v-if="deleteMutation.isPending.value" size="sm" />
          Delete
        </button>
      </template>
    </Modal>
  </div>
</template>
