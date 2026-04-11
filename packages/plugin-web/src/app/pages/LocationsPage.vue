<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { MapPin, Plus, Trash2 } from "lucide-vue-next";
import { locations } from "@/lib/api";
import type { LocationTreeNode } from "@/lib/types";
import type { TreeNode } from "@/components/TreeView.vue";
import LoadingSpinner from "@/components/LoadingSpinner.vue";
import EmptyState from "@/components/EmptyState.vue";
import Modal from "@/components/Modal.vue";
import TreeView from "@/components/TreeView.vue";

const queryClient = useQueryClient();

// --- State ---
const selectedLocationId = ref<number | null>(null);
const showDeleteConfirm = ref(false);

// --- Data fetching ---

const { data: locationTree, isLoading: treeLoading } = useQuery({
  queryKey: ["locations", "tree"],
  queryFn: () => locations.tree(),
});

const { data: selectedLocation, isLoading: detailLoading } = useQuery({
  queryKey: ["locations", "detail", selectedLocationId],
  queryFn: () => locations.get(selectedLocationId.value!),
  enabled: () => selectedLocationId.value !== null,
});

// Reset detail query when selection clears
watch(selectedLocationId, (id) => {
  if (id === null) {
    queryClient.removeQueries({ queryKey: ["locations", "detail", null] });
  }
});

// --- Tree transformation ---

function transformTree(nodes: LocationTreeNode[]): TreeNode[] {
  return nodes.map((node) => ({
    id: node.location.id,
    label: node.location.name,
    children: node.children.length > 0 ? transformTree(node.children) : undefined,
    count: node.children.length > 0 ? node.children.length : undefined,
  }));
}

const treeNodes = computed<TreeNode[]>(() =>
  locationTree.value ? transformTree(locationTree.value) : [],
);

// --- Find child locations for the selected node ---

function findNode(nodes: LocationTreeNode[], id: number): LocationTreeNode | null {
  for (const node of nodes) {
    if (node.location.id === id) return node;
    if (node.children.length > 0) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

const selectedTreeNode = computed(() => {
  if (!locationTree.value || selectedLocationId.value === null) return null;
  return findNode(locationTree.value, selectedLocationId.value);
});

const childLocations = computed(() => {
  if (!selectedTreeNode.value) return [];
  return selectedTreeNode.value.children.map((c) => c.location);
});

// --- Mutations ---

const deleteMutation = useMutation({
  mutationFn: () => locations.delete(selectedLocationId.value!),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["locations"] });
    selectedLocationId.value = null;
    showDeleteConfirm.value = false;
  },
});

// --- Actions ---

function onSelectLocation(id: number) {
  selectedLocationId.value = id;
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
        <h1 class="text-lg font-semibold text-zinc-100 tracking-wide">Storage Locations</h1>
        <p class="text-xs text-muted mt-1">Manage physical storage locations for your inventory</p>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="treeLoading" class="flex items-center justify-center py-24">
      <LoadingSpinner size="lg" />
    </div>

    <!-- Empty state -->
    <EmptyState
      v-else-if="!locationTree || locationTree.length === 0"
      title="No storage locations"
      description="Add storage locations to track where your parts are stored."
    >
      <template #icon>
        <MapPin :size="48" :stroke-width="1" />
      </template>
    </EmptyState>

    <!-- Two-panel layout -->
    <div v-else class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <!-- Left panel: Location tree -->
      <div class="lg:col-span-1">
        <div class="rounded-lg border border-border bg-surface-1">
          <div class="border-b border-border px-4 py-3">
            <h2 class="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
              Location Tree
            </h2>
          </div>
          <div class="p-2">
            <TreeView
              :nodes="treeNodes"
              :selected-id="selectedLocationId"
              @select="onSelectLocation"
            />
          </div>
        </div>
      </div>

      <!-- Right panel: Location detail -->
      <div class="lg:col-span-2">
        <!-- No selection -->
        <div
          v-if="selectedLocationId === null"
          class="rounded-lg border border-border bg-surface-1"
        >
          <div class="flex items-center justify-center py-24">
            <p class="text-xs text-muted">Select a location to view details</p>
          </div>
        </div>

        <!-- Selected location -->
        <div v-else class="space-y-4">
          <!-- Location info card -->
          <div class="rounded-lg border border-border bg-surface-1">
            <div v-if="detailLoading" class="flex items-center justify-center py-12">
              <LoadingSpinner />
            </div>

            <div v-else-if="selectedLocation" class="p-4 space-y-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <MapPin :size="14" class="text-accent/60" />
                  <h2 class="text-sm font-semibold text-zinc-100">
                    {{ selectedLocation.name }}
                  </h2>
                </div>
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
                  <span class="text-muted">Full Path</span>
                  <p class="text-zinc-300 mt-0.5 font-medium">{{ selectedLocation.path }}</p>
                </div>
                <div>
                  <span class="text-muted">ID</span>
                  <p class="text-zinc-300 mt-0.5 font-medium tabular-nums">
                    {{ selectedLocation.id }}
                  </p>
                </div>
                <div v-if="selectedLocation.description" class="col-span-2">
                  <span class="text-muted">Description</span>
                  <p class="text-zinc-400 mt-0.5">{{ selectedLocation.description }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Child locations -->
          <div
            v-if="childLocations.length > 0"
            class="rounded-lg border border-border bg-surface-1"
          >
            <div class="border-b border-border px-4 py-3">
              <h3 class="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                Sub-Locations
                <span class="ml-1.5 text-muted tabular-nums">
                  ({{ childLocations.length }})
                </span>
              </h3>
            </div>

            <ul class="divide-y divide-border">
              <li v-for="child in childLocations" :key="child.id">
                <button
                  class="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2/50"
                  @click="onSelectLocation(child.id)"
                >
                  <MapPin :size="13" class="flex-shrink-0 text-muted" />
                  <div class="flex-1 min-w-0">
                    <div class="text-xs font-medium text-zinc-200 truncate">
                      {{ child.name }}
                    </div>
                    <div
                      v-if="child.description"
                      class="text-[11px] text-muted mt-0.5 truncate"
                    >
                      {{ child.description }}
                    </div>
                  </div>
                </button>
              </li>
            </ul>
          </div>

          <!-- Empty child state -->
          <div
            v-else-if="selectedTreeNode && !detailLoading"
            class="rounded-lg border border-border bg-surface-1 py-8"
          >
            <EmptyState
              title="No sub-locations"
              description="This location has no child locations."
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <Modal :open="showDeleteConfirm" title="Delete Location" @close="cancelDelete">
      <div class="space-y-3">
        <p class="text-xs text-zinc-300">
          Are you sure you want to delete
          <strong class="text-zinc-100">{{ selectedLocation?.name }}</strong>?
        </p>
        <p class="text-[11px] text-muted">
          This action cannot be undone. Any sub-locations will also be affected.
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
          Delete Location
        </button>
      </template>
    </Modal>
  </div>
</template>
