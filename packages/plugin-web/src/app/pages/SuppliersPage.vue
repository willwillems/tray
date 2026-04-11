<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { suppliers } from "@/lib/api";
import type { Supplier } from "@/lib/types";
import DataTable from "@/components/DataTable.vue";
import Modal from "@/components/Modal.vue";
import LoadingSpinner from "@/components/LoadingSpinner.vue";
import { Truck, Plus, Pencil, Trash2, ExternalLink } from "lucide-vue-next";

function hostname(url: string): string {
  try { return new globalThis.URL(url).hostname; } catch { return url; }
}

const router = useRouter();
const queryClient = useQueryClient();

// --- Data fetching ---
const { data: supplierList, isLoading } = useQuery({
  queryKey: ["suppliers"],
  queryFn: () => suppliers.list(),
});

const rows = computed(() => supplierList.value ?? []);

// --- Modal state ---
const showModal = ref(false);
const editingSupplier = ref<Supplier | null>(null);
const form = ref({ name: "", url: "", notes: "" });

function openCreate() {
  editingSupplier.value = null;
  form.value = { name: "", url: "", notes: "" };
  showModal.value = true;
}

function openEdit(supplier: Supplier) {
  editingSupplier.value = supplier;
  form.value = {
    name: supplier.name,
    url: supplier.url ?? "",
    notes: supplier.notes ?? "",
  };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
  editingSupplier.value = null;
}

// --- Mutations ---
const createMutation = useMutation({
  mutationFn: (data: { name: string; url?: string; notes?: string }) =>
    suppliers.create(data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    closeModal();
  },
});

const updateMutation = useMutation({
  mutationFn: ({ id, data }: { id: number; data: { name?: string; url?: string | null; notes?: string | null } }) =>
    suppliers.update(id, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    closeModal();
  },
});

const deleteMutation = useMutation({
  mutationFn: (id: number) => suppliers.delete(id),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
  },
});

function handleSubmit() {
  const data = {
    name: form.value.name.trim(),
    url: form.value.url.trim() || undefined,
    notes: form.value.notes.trim() || undefined,
  };
  if (editingSupplier.value) {
    updateMutation.mutate({
      id: editingSupplier.value.id,
      data: {
        name: data.name,
        url: data.url ?? null,
        notes: data.notes ?? null,
      },
    });
  } else {
    createMutation.mutate(data);
  }
}

// --- Delete confirmation ---
const confirmDeleteId = ref<number | null>(null);

function confirmDelete(id: number) {
  confirmDeleteId.value = id;
}

function executeDelete() {
  if (confirmDeleteId.value !== null) {
    deleteMutation.mutate(confirmDeleteId.value);
    confirmDeleteId.value = null;
  }
}

// --- Table ---
const columns = [
  { key: "name", label: "Name" },
  { key: "url", label: "URL" },
  { key: "part_count", label: "Parts", class: "text-right" },
  { key: "notes", label: "Notes" },
  { key: "actions", label: "", class: "w-24 text-right" },
];

function onRowClick(row: Supplier) {
  router.push(`/suppliers/${row.id}`);
}

const isSaving = computed(() => createMutation.isPending.value || updateMutation.isPending.value);
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <Truck class="h-5 w-5 text-accent" />
        <h1 class="text-lg font-semibold text-zinc-100">Suppliers</h1>
        <span v-if="rows.length" class="text-xs text-muted">({{ rows.length }})</span>
      </div>
      <button
        class="flex items-center gap-2 rounded-md bg-accent/10 border border-accent/20 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
        @click="openCreate"
      >
        <Plus class="h-3.5 w-3.5" />
        Add Supplier
      </button>
    </div>

    <!-- Table -->
    <DataTable :columns="columns" :rows="rows" :loading="isLoading" @row-click="onRowClick">
      <template #cell-name="{ row }">
        <span class="font-medium text-zinc-200">{{ row.name }}</span>
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
          {{ hostname(row.url) }}
          <ExternalLink class="h-3 w-3" />
        </a>
        <span v-else class="text-muted">—</span>
      </template>

      <template #cell-part_count="{ row }">
        <span class="tabular-nums">{{ row.part_count ?? 0 }}</span>
      </template>

      <template #cell-notes="{ row }">
        <span class="text-muted truncate max-w-[200px] inline-block">
          {{ row.notes ?? "—" }}
        </span>
      </template>

      <template #cell-actions="{ row }">
        <div class="flex items-center justify-end gap-1" @click.stop>
          <button
            class="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
            title="Edit"
            @click="openEdit(row)"
          >
            <Pencil class="h-3.5 w-3.5" />
          </button>
          <button
            class="rounded p-1.5 text-muted hover:bg-danger/10 hover:text-danger transition-colors"
            title="Delete"
            @click="confirmDelete(row.id)"
          >
            <Trash2 class="h-3.5 w-3.5" />
          </button>
        </div>
      </template>
    </DataTable>

    <!-- Create / Edit Modal -->
    <Modal :open="showModal" :title="editingSupplier ? 'Edit Supplier' : 'Add Supplier'" @close="closeModal">
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
            Name <span class="text-danger">*</span>
          </label>
          <input
            v-model="form.name"
            type="text"
            required
            placeholder="e.g. DigiKey"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">URL</label>
          <input
            v-model="form.url"
            type="url"
            placeholder="https://digikey.com"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">Notes</label>
          <textarea
            v-model="form.notes"
            rows="3"
            placeholder="Optional notes about this supplier..."
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none resize-none"
          />
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
          @click="closeModal"
        >
          Cancel
        </button>
        <button
          class="flex items-center gap-2 rounded-md bg-accent/15 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
          :disabled="!form.name.trim() || isSaving"
          @click="handleSubmit"
        >
          <LoadingSpinner v-if="isSaving" size="sm" />
          {{ editingSupplier ? "Update" : "Create" }}
        </button>
      </template>
    </Modal>

    <!-- Delete Confirmation Modal -->
    <Modal :open="confirmDeleteId !== null" title="Delete Supplier" @close="confirmDeleteId = null">
      <p class="text-xs text-zinc-300 leading-relaxed">
        Are you sure you want to delete this supplier? This action cannot be undone.
        All associated supplier parts will also be removed.
      </p>

      <template #footer>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
          @click="confirmDeleteId = null"
        >
          Cancel
        </button>
        <button
          class="flex items-center gap-2 rounded-md bg-danger/15 border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/25 transition-colors disabled:opacity-50"
          :disabled="deleteMutation.isPending.value"
          @click="executeDelete"
        >
          <LoadingSpinner v-if="deleteMutation.isPending.value" size="sm" />
          Delete
        </button>
      </template>
    </Modal>
  </div>
</template>
