<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { RouterLink } from "vue-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { FolderPlus, Trash2, FolderTree } from "lucide-vue-next";
import { parts, categories } from "@/lib/api";
import type { CategoryTreeNode, Part } from "@/lib/types";
import type { TreeNode } from "@/components/TreeView.vue";
import LoadingSpinner from "@/components/LoadingSpinner.vue";
import EmptyState from "@/components/EmptyState.vue";
import Modal from "@/components/Modal.vue";
import TreeView from "@/components/TreeView.vue";
import PartThumbnail from "@/components/PartThumbnail.vue";
import StockIndicator from "@/components/StockIndicator.vue";

const queryClient = useQueryClient();

// --- State ---
const selectedCategoryId = ref<number | null>(null);
const showAddModal = ref(false);
const showDeleteConfirm = ref(false);

// --- Form state ---
const formName = ref("");
const formParentPath = ref("");
const formDescription = ref("");
const formReferencePrefix = ref("");
const formError = ref<string | null>(null);
const formSubmitting = ref(false);

// --- Data fetching ---

const { data: categoryTree, isLoading: treeLoading } = useQuery({
  queryKey: ["categories", "tree"],
  queryFn: () => categories.tree(),
});

const { data: selectedCategory, isLoading: detailLoading } = useQuery({
  queryKey: ["categories", "detail", selectedCategoryId],
  queryFn: () => categories.get(selectedCategoryId.value!),
  enabled: () => selectedCategoryId.value !== null,
});

const { data: categoryParts, isLoading: partsLoading } = useQuery({
  queryKey: ["parts", "by-category", selectedCategoryId],
  queryFn: () => parts.list({ category_id: selectedCategoryId.value! }),
  enabled: () => selectedCategoryId.value !== null,
});

// Reset detail queries when selection clears
watch(selectedCategoryId, (id) => {
  if (id === null) {
    queryClient.removeQueries({ queryKey: ["categories", "detail", null] });
    queryClient.removeQueries({ queryKey: ["parts", "by-category", null] });
  }
});

// --- Tree transformation ---

function countParts(node: CategoryTreeNode): number {
  // We don't have a direct part count per category from the tree,
  // so we show children count as a proxy. This could be enhanced
  // if the API provides part_count.
  return node.children.length;
}

function transformTree(nodes: CategoryTreeNode[]): TreeNode[] {
  return nodes.map((node) => ({
    id: node.category.id,
    label: node.category.name,
    children: node.children.length > 0 ? transformTree(node.children) : undefined,
    count: node.children.length > 0 ? node.children.length : undefined,
  }));
}

const treeNodes = computed<TreeNode[]>(() =>
  categoryTree.value ? transformTree(categoryTree.value) : [],
);

// --- Find the selected node in the tree for path display ---

function findNodePath(nodes: CategoryTreeNode[], id: number): string | null {
  for (const node of nodes) {
    if (node.category.id === id) return node.path;
    if (node.children.length > 0) {
      const found = findNodePath(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

// --- Mutations ---

const createMutation = useMutation({
  mutationFn: async () => {
    if (formParentPath.value.trim()) {
      // Use resolve for path-based creation: resolve parent, then create under it
      const parent = await categories.resolve(formParentPath.value.trim());
      return categories.create({
        name: formName.value.trim(),
        parent_id: parent.id,
        description: formDescription.value.trim() || undefined,
        reference_prefix: formReferencePrefix.value.trim() || undefined,
      });
    }
    return categories.create({
      name: formName.value.trim(),
      description: formDescription.value.trim() || undefined,
      reference_prefix: formReferencePrefix.value.trim() || undefined,
    });
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    closeAddModal();
  },
  onError: (err: Error) => {
    formError.value = err.message;
  },
});

const deleteMutation = useMutation({
  mutationFn: () => categories.delete(selectedCategoryId.value!),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    selectedCategoryId.value = null;
    showDeleteConfirm.value = false;
  },
});

// --- Actions ---

function onSelectCategory(id: number) {
  selectedCategoryId.value = id;
}

function openAddModal() {
  formName.value = "";
  formParentPath.value = "";
  formDescription.value = "";
  formReferencePrefix.value = "";
  formError.value = null;
  showAddModal.value = true;
}

function closeAddModal() {
  showAddModal.value = false;
  formError.value = null;
}

async function submitAddCategory() {
  if (!formName.value.trim()) {
    formError.value = "Name is required";
    return;
  }
  formError.value = null;
  formSubmitting.value = true;
  try {
    await createMutation.mutateAsync();
  } finally {
    formSubmitting.value = false;
  }
}

function confirmDelete() {
  showDeleteConfirm.value = true;
}

function cancelDelete() {
  showDeleteConfirm.value = false;
}

async function executeDelete() {
  await deleteMutation.mutateAsync();
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold text-zinc-100 tracking-wide">Categories</h1>
        <p class="text-xs text-muted mt-1">Organize parts into hierarchical categories</p>
      </div>
      <button
        class="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 hover:border-accent/50"
        @click="openAddModal"
      >
        <FolderPlus :size="13" />
        Add Category
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="treeLoading" class="flex items-center justify-center py-24">
      <LoadingSpinner size="lg" />
    </div>

    <!-- Empty state -->
    <EmptyState
      v-else-if="!categoryTree || categoryTree.length === 0"
      title="No categories"
      description="Create your first category to start organizing parts."
    >
      <template #icon>
        <FolderTree :size="48" :stroke-width="1" />
      </template>
      <template #action>
        <button
          class="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
          @click="openAddModal"
        >
          <FolderPlus :size="13" />
          Add Category
        </button>
      </template>
    </EmptyState>

    <!-- Two-panel layout -->
    <div v-else class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <!-- Left panel: Category tree -->
      <div class="lg:col-span-1">
        <div class="rounded-lg border border-border bg-surface-1">
          <div class="border-b border-border px-4 py-3">
            <h2 class="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
              Category Tree
            </h2>
          </div>
          <div class="p-2">
            <TreeView
              :nodes="treeNodes"
              :selected-id="selectedCategoryId"
              @select="onSelectCategory"
            />
          </div>
        </div>
      </div>

      <!-- Right panel: Category detail -->
      <div class="lg:col-span-2">
        <!-- No selection -->
        <div
          v-if="selectedCategoryId === null"
          class="rounded-lg border border-border bg-surface-1"
        >
          <div class="flex items-center justify-center py-24">
            <p class="text-xs text-muted">Select a category to view details</p>
          </div>
        </div>

        <!-- Selected category -->
        <div v-else class="space-y-4">
          <!-- Category info card -->
          <div class="rounded-lg border border-border bg-surface-1">
            <div v-if="detailLoading" class="flex items-center justify-center py-12">
              <LoadingSpinner />
            </div>

            <div v-else-if="selectedCategory" class="p-4 space-y-3">
              <div class="flex items-center justify-between">
                <h2 class="text-sm font-semibold text-zinc-100">
                  {{ selectedCategory.name }}
                </h2>
                <button
                  class="inline-flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1 text-[11px] text-danger transition-colors hover:bg-danger/20 hover:border-danger/50"
                  @click="confirmDelete"
                >
                  <Trash2 :size="11" />
                  Delete
                </button>
              </div>

              <!-- Metadata -->
              <div class="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span class="text-muted">Path</span>
                  <p class="text-zinc-300 mt-0.5 font-medium">{{ selectedCategory.path }}</p>
                </div>
                <div v-if="selectedCategory.reference_prefix">
                  <span class="text-muted">Reference Prefix</span>
                  <p class="text-zinc-300 mt-0.5 font-medium">
                    {{ selectedCategory.reference_prefix }}
                  </p>
                </div>
                <div v-if="selectedCategory.description" class="col-span-2">
                  <span class="text-muted">Description</span>
                  <p class="text-zinc-400 mt-0.5">{{ selectedCategory.description }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Parts in this category -->
          <div class="rounded-lg border border-border bg-surface-1">
            <div class="border-b border-border px-4 py-3">
              <h3 class="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                Parts in Category
              </h3>
            </div>

            <div v-if="partsLoading" class="flex items-center justify-center py-12">
              <LoadingSpinner />
            </div>

            <div
              v-else-if="!categoryParts || categoryParts.length === 0"
              class="py-12"
            >
              <EmptyState
                title="No parts"
                description="No parts have been assigned to this category yet."
              />
            </div>

            <ul v-else class="divide-y divide-border">
              <li v-for="part in categoryParts" :key="part.id">
                <RouterLink
                  :to="`/parts/${part.id}`"
                  class="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/50"
                >
                  <PartThumbnail :thumbnail="part.thumbnail" :name="part.name" />

                  <div class="flex-1 min-w-0">
                    <div class="text-xs font-medium text-zinc-200 truncate">
                      {{ part.name }}
                    </div>
                    <div v-if="part.manufacturer" class="text-[11px] text-muted mt-0.5 truncate">
                      {{ part.manufacturer }}
                    </div>
                  </div>

                  <StockIndicator :stock="part.stock" :min-stock="part.min_stock" />
                </RouterLink>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Category Modal -->
    <Modal :open="showAddModal" title="Add Category" @close="closeAddModal">
      <form class="space-y-4" @submit.prevent="submitAddCategory">
        <!-- Error -->
        <div
          v-if="formError"
          class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {{ formError }}
        </div>

        <!-- Name -->
        <div>
          <label class="block text-[11px] uppercase tracking-wider text-muted mb-1.5">
            Name <span class="text-danger">*</span>
          </label>
          <input
            v-model="formName"
            type="text"
            required
            placeholder="e.g. Capacitors"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none"
          />
        </div>

        <!-- Parent path -->
        <div>
          <label class="block text-[11px] uppercase tracking-wider text-muted mb-1.5">
            Parent Path
          </label>
          <input
            v-model="formParentPath"
            type="text"
            placeholder="e.g. Passive Components/Capacitors"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none"
          />
          <p class="text-[10px] text-muted mt-1">
            Leave empty for root category, or enter a slash-separated path
          </p>
        </div>

        <!-- Description -->
        <div>
          <label class="block text-[11px] uppercase tracking-wider text-muted mb-1.5">
            Description
          </label>
          <textarea
            v-model="formDescription"
            rows="2"
            placeholder="Optional description"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none resize-none"
          />
        </div>

        <!-- Reference prefix -->
        <div>
          <label class="block text-[11px] uppercase tracking-wider text-muted mb-1.5">
            Reference Prefix
          </label>
          <input
            v-model="formReferencePrefix"
            type="text"
            placeholder="e.g. C, R, U"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none"
          />
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-surface-3"
          @click="closeAddModal"
        >
          Cancel
        </button>
        <button
          class="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="formSubmitting || !formName.trim()"
          @click="submitAddCategory"
        >
          <LoadingSpinner v-if="formSubmitting" size="sm" />
          Create Category
        </button>
      </template>
    </Modal>

    <!-- Delete Confirmation Modal -->
    <Modal :open="showDeleteConfirm" title="Delete Category" @close="cancelDelete">
      <div class="space-y-3">
        <p class="text-xs text-zinc-300">
          Are you sure you want to delete
          <strong class="text-zinc-100">{{ selectedCategory?.name }}</strong>?
        </p>
        <p class="text-[11px] text-muted">
          This action cannot be undone. Parts in this category will become uncategorized.
        </p>
      </div>

      <template #footer>
        <button
          class="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-surface-3"
          @click="cancelDelete"
        >
          Cancel
        </button>
        <button
          class="inline-flex items-center gap-1.5 rounded-md border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/20 disabled:opacity-50"
          :disabled="deleteMutation.isPending.value"
          @click="executeDelete"
        >
          <LoadingSpinner v-if="deleteMutation.isPending.value" size="sm" />
          <Trash2 v-else :size="11" />
          Delete Category
        </button>
      </template>
    </Modal>
  </div>
</template>
