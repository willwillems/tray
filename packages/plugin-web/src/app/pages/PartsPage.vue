<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import {
  Plus,
  Search,
  Star,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  X,
} from "lucide-vue-next";
import { parts, categories, search as searchApi } from "@/lib/api";
import type { Part, CategoryTreeNode } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import Modal from "@/components/Modal.vue";
import EmptyState from "@/components/EmptyState.vue";
import LoadingSpinner from "@/components/LoadingSpinner.vue";
import StockIndicator from "@/components/StockIndicator.vue";
import PartThumbnail from "@/components/PartThumbnail.vue";

const router = useRouter();
const route = useRoute();
const queryClient = useQueryClient();

// --- Filters (synced with URL) ---
const searchInput = ref("");
const searchQuery = ref("");
const categoryFilter = ref("");
const lowStockFilter = ref(false);
const favoritesFilter = ref(false);
const categoryDropdownOpen = ref(false);
const limit = ref(50);

// Read initial state from URL on mount
onMounted(() => {
  const q = route.query;
  if (typeof q.q === "string") {
    searchInput.value = q.q;
    searchQuery.value = q.q;
  }
  if (typeof q.category === "string") categoryFilter.value = q.category;
  if (q.low === "1" || q.low === "true") lowStockFilter.value = true;
  if (q.favorites === "1" || q.favorites === "true") favoritesFilter.value = true;
});

// Debounce search input -> searchQuery
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchInput, (val) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    searchQuery.value = val;
  }, 300);
});

// Sync filters -> URL params (replace, don't push)
function syncUrlParams() {
  const query: Record<string, string> = {};
  if (searchQuery.value) query.q = searchQuery.value;
  if (categoryFilter.value) query.category = categoryFilter.value;
  if (lowStockFilter.value) query.low = "1";
  if (favoritesFilter.value) query.favorites = "1";
  router.replace({ path: "/parts", query });
}

watch([searchQuery, categoryFilter, lowStockFilter, favoritesFilter], () => {
  syncUrlParams();
});

// --- Sorting ---
type SortField = "name" | "category_path" | "manufacturer" | "mpn" | "stock" | "updated_at";
const sortField = ref<SortField>("name");
const sortDir = ref<"asc" | "desc">("asc");

function toggleSort(field: SortField) {
  if (sortField.value === field) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortField.value = field;
    sortDir.value = "asc";
  }
}

// --- Data fetching ---
// When there's a search query, use the /api/search endpoint
// Otherwise, use /api/parts with filters
const isSearchMode = computed(() => searchQuery.value.trim().length > 0);

const listFilters = computed(() => ({
  category: categoryFilter.value || undefined,
  low: lowStockFilter.value || undefined,
  favorites: favoritesFilter.value || undefined,
  limit: limit.value,
}));

// Regular parts list (no search query)
const {
  data: partsListData,
  isLoading: isListLoading,
  isError: isListError,
} = useQuery({
  queryKey: ["parts", listFilters],
  queryFn: () => parts.list(listFilters.value),
  enabled: computed(() => !isSearchMode.value),
});

// Search results (when search query is active)
const {
  data: searchData,
  isLoading: isSearchLoading,
  isError: isSearchError,
} = useQuery({
  queryKey: ["parts-search", searchQuery, limit],
  queryFn: () => searchApi.query(searchQuery.value.trim(), limit.value),
  enabled: isSearchMode,
});

// Merge both data sources
const rawParts = computed<Part[]>(() => {
  if (isSearchMode.value) {
    const results = searchData.value ?? [];
    let matched = results.map((r) => ({
      ...r.part,
      tags: r.tags ?? r.part.tags ?? [],
      parameters: r.part.parameters ?? [],
    }));
    // Apply client-side filters on top of search results
    if (categoryFilter.value) {
      matched = matched.filter((p) => p.category_path?.startsWith(categoryFilter.value));
    }
    if (lowStockFilter.value) {
      matched = matched.filter((p) => p.stock <= p.min_stock);
    }
    if (favoritesFilter.value) {
      matched = matched.filter((p) => p.favorite);
    }
    return matched;
  }
  return partsListData.value ?? [];
});

const isLoading = computed(() => isSearchMode.value ? isSearchLoading.value : isListLoading.value);
const isError = computed(() => isSearchMode.value ? isSearchError.value : isListError.value);

const { data: categoryTree } = useQuery({
  queryKey: ["categories", "tree"],
  queryFn: () => categories.tree(),
});

// Flatten category tree for dropdown
function flattenTree(
  nodes: CategoryTreeNode[],
  depth = 0,
): { path: string; label: string; depth: number }[] {
  const result: { path: string; label: string; depth: number }[] = [];
  for (const node of nodes) {
    result.push({ path: node.path, label: node.category.name, depth });
    result.push(...flattenTree(node.children, depth + 1));
  }
  return result;
}

const flatCategories = computed(() => flattenTree(categoryTree.value ?? []));

// --- Sorted parts ---
const sortedParts = computed(() => {
  const list = [...rawParts.value];
  list.sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;
    switch (sortField.value) {
      case "name":
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
        break;
      case "category_path":
        aVal = (a.category_path ?? "").toLowerCase();
        bVal = (b.category_path ?? "").toLowerCase();
        break;
      case "manufacturer":
        aVal = (a.manufacturer ?? "").toLowerCase();
        bVal = (b.manufacturer ?? "").toLowerCase();
        break;
      case "mpn":
        aVal = (a.mpn ?? "").toLowerCase();
        bVal = (b.mpn ?? "").toLowerCase();
        break;
      case "stock":
        aVal = a.stock;
        bVal = b.stock;
        break;
      case "updated_at":
        aVal = a.updated_at;
        bVal = b.updated_at;
        break;
      default:
        return 0;
    }
    if (aVal < bVal) return sortDir.value === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDir.value === "asc" ? 1 : -1;
    return 0;
  });
  return list;
});

const hasMore = computed(() => rawParts.value.length >= limit.value);

const hasActiveFilters = computed(() =>
  searchQuery.value || categoryFilter.value || lowStockFilter.value || favoritesFilter.value,
);

function loadMore() {
  limit.value += 50;
}

function clearFilters() {
  searchInput.value = "";
  searchQuery.value = "";
  categoryFilter.value = "";
  lowStockFilter.value = false;
  favoritesFilter.value = false;
}

function navigateToPart(part: Part) {
  router.push(`/parts/${part.id}`);
}

// --- Add Part Modal ---
const showAddModal = ref(false);
const addForm = ref({
  name: "",
  description: "",
  category: "",
  manufacturer: "",
  mpn: "",
  ipn: "",
  footprint: "",
  tags: "",
  stock: 0,
  location: "",
  min_stock: 0,
});

function resetAddForm() {
  addForm.value = {
    name: "",
    description: "",
    category: "",
    manufacturer: "",
    mpn: "",
    ipn: "",
    footprint: "",
    tags: "",
    stock: 0,
    location: "",
    min_stock: 0,
  };
}

const createMutation = useMutation({
  mutationFn: (data: Record<string, unknown>) => parts.create(data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["parts"] });
    queryClient.invalidateQueries({ queryKey: ["parts-search"] });
    showAddModal.value = false;
    resetAddForm();
  },
});

function submitAdd() {
  const f = addForm.value;
  if (!f.name.trim()) return;

  const data: Record<string, unknown> = {
    name: f.name.trim(),
  };
  if (f.description.trim()) data.description = f.description.trim();
  if (f.category.trim()) data.category = f.category.trim();
  if (f.manufacturer.trim()) data.manufacturer = f.manufacturer.trim();
  if (f.mpn.trim()) data.mpn = f.mpn.trim();
  if (f.ipn.trim()) data.ipn = f.ipn.trim();
  if (f.footprint.trim()) data.footprint = f.footprint.trim();
  if (f.tags.trim()) {
    data.tags = f.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  if (f.stock > 0) {
    data.stock = f.stock;
    if (f.location.trim()) data.location = f.location.trim();
  }
  if (f.min_stock > 0) data.min_stock = f.min_stock;

  createMutation.mutate(data);
}

// --- Sort icon helper ---
function sortIcon(field: SortField) {
  if (sortField.value !== field) return ChevronsUpDown;
  return sortDir.value === "asc" ? ChevronUp : ChevronDown;
}

// Close category dropdown on outside click
function closeCategoryDropdown() {
  categoryDropdownOpen.value = false;
}
</script>

<template>
  <div @click="closeCategoryDropdown">
    <!-- Header -->
    <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <h1 class="text-lg font-semibold text-zinc-100 tracking-wide">Parts</h1>

      <div class="flex flex-wrap items-center gap-2">
        <!-- Search -->
        <div class="relative">
          <Search
            :size="14"
            :stroke-width="1.8"
            class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            v-model="searchInput"
            type="text"
            placeholder="Search parts..."
            class="h-8 w-56 rounded-md border border-border bg-surface-1 pl-8 pr-8 text-xs text-zinc-200 placeholder-muted/60 outline-none transition-colors focus:border-accent/50"
          />
          <button
            v-if="searchInput"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-zinc-300"
            @click="searchInput = ''; searchQuery = ''"
          >
            <X :size="12" />
          </button>
        </div>

        <!-- Category filter -->
        <div class="relative" @click.stop>
          <button
            class="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-1 px-3 text-xs transition-colors hover:border-border-hover"
            :class="categoryFilter ? 'text-accent' : 'text-muted'"
            @click="categoryDropdownOpen = !categoryDropdownOpen"
          >
            <span>{{ categoryFilter || "Category" }}</span>
            <ChevronDown :size="12" />
          </button>
          <Transition
            enter-active-class="transition duration-100 ease-out"
            enter-from-class="opacity-0 scale-95"
            enter-to-class="opacity-100 scale-100"
            leave-active-class="transition duration-75 ease-in"
            leave-from-class="opacity-100 scale-100"
            leave-to-class="opacity-0 scale-95"
          >
            <div
              v-if="categoryDropdownOpen"
              class="absolute right-0 top-full z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-md border border-border bg-surface-1 py-1 shadow-xl"
            >
              <button
                class="flex w-full items-center px-3 py-1.5 text-left text-xs text-muted transition-colors hover:bg-surface-2 hover:text-zinc-200"
                @click="
                  categoryFilter = '';
                  categoryDropdownOpen = false;
                "
              >
                All Categories
              </button>
              <button
                v-for="cat in flatCategories"
                :key="cat.path"
                class="flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-2"
                :class="
                  categoryFilter === cat.path ? 'text-accent' : 'text-zinc-300'
                "
                :style="{ paddingLeft: `${12 + cat.depth * 12}px` }"
                @click="
                  categoryFilter = cat.path;
                  categoryDropdownOpen = false;
                "
              >
                {{ cat.label }}
              </button>
            </div>
          </Transition>
        </div>

        <!-- Low Stock toggle -->
        <button
          class="flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors"
          :class="
            lowStockFilter
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-border bg-surface-1 text-muted hover:border-border-hover hover:text-zinc-300'
          "
          @click="lowStockFilter = !lowStockFilter"
        >
          <AlertTriangle :size="13" :stroke-width="1.8" />
          Low Stock
        </button>

        <!-- Favorites toggle -->
        <button
          class="flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs transition-colors"
          :class="
            favoritesFilter
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-border bg-surface-1 text-muted hover:border-border-hover hover:text-zinc-300'
          "
          @click="favoritesFilter = !favoritesFilter"
        >
          <Star :size="13" :stroke-width="1.8" />
          Favorites
        </button>

        <!-- Clear filters -->
        <button
          v-if="hasActiveFilters"
          class="flex h-8 items-center gap-1 rounded-md border border-border bg-surface-1 px-2.5 text-xs text-muted transition-colors hover:border-border-hover hover:text-zinc-300"
          @click="clearFilters"
        >
          <X :size="12" />
          Clear
        </button>

        <!-- Add Part -->
        <button
          class="flex h-8 items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-3 text-xs text-accent transition-colors hover:bg-accent/20"
          @click="showAddModal = true"
        >
          <Plus :size="14" :stroke-width="2" />
          Add Part
        </button>
      </div>
    </div>

    <!-- Active search indicator -->
    <div
      v-if="isSearchMode"
      class="mb-4 flex items-center gap-2 rounded-md border border-accent/20 bg-accent/5 px-3 py-2 text-xs"
    >
      <Search :size="12" class="text-accent" />
      <span class="text-zinc-300">
        Search results for "<span class="text-accent">{{ searchQuery }}</span>"
      </span>
      <span class="text-muted">&middot; {{ rawParts.length }} result{{ rawParts.length !== 1 ? 's' : '' }}</span>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex items-center justify-center py-24">
      <LoadingSpinner size="lg" />
    </div>

    <!-- Error -->
    <div
      v-else-if="isError"
      class="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-xs text-danger"
    >
      Failed to load parts. Check server connection.
    </div>

    <!-- Empty (no parts exist at all) -->
    <EmptyState
      v-else-if="sortedParts.length === 0 && !hasActiveFilters"
      title="No parts yet"
      description="Add your first electronic component to start building your inventory."
    >
      <template #action>
        <button
          class="rounded-md border border-accent/30 bg-accent/10 px-4 py-2 text-xs text-accent transition-colors hover:bg-accent/20"
          @click="showAddModal = true"
        >
          Add your first part
        </button>
      </template>
    </EmptyState>

    <!-- No results for filters -->
    <EmptyState
      v-else-if="sortedParts.length === 0"
      title="No matching parts"
      description="Try adjusting your search or filters."
    >
      <template #action>
        <button
          class="rounded-md border border-border bg-surface-1 px-4 py-2 text-xs text-zinc-300 transition-colors hover:bg-surface-2"
          @click="clearFilters"
        >
          Clear all filters
        </button>
      </template>
    </EmptyState>

    <!-- Parts Table -->
    <div v-else>
      <div class="overflow-x-auto rounded-lg border border-border">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-border bg-surface-1 text-left">
              <th class="w-12 px-3 py-2.5" />
              <th
                class="cursor-pointer select-none px-3 py-2.5 text-muted transition-colors hover:text-zinc-300"
                @click="toggleSort('name')"
              >
                <span class="inline-flex items-center gap-1">
                  Name
                  <component :is="sortIcon('name')" :size="12" />
                </span>
              </th>
              <th
                class="cursor-pointer select-none px-3 py-2.5 text-muted transition-colors hover:text-zinc-300"
                @click="toggleSort('category_path')"
              >
                <span class="inline-flex items-center gap-1">
                  Category
                  <component :is="sortIcon('category_path')" :size="12" />
                </span>
              </th>
              <th
                class="cursor-pointer select-none px-3 py-2.5 text-muted transition-colors hover:text-zinc-300"
                @click="toggleSort('manufacturer')"
              >
                <span class="inline-flex items-center gap-1">
                  Manufacturer
                  <component :is="sortIcon('manufacturer')" :size="12" />
                </span>
              </th>
              <th
                class="cursor-pointer select-none px-3 py-2.5 text-muted transition-colors hover:text-zinc-300"
                @click="toggleSort('mpn')"
              >
                <span class="inline-flex items-center gap-1">
                  MPN
                  <component :is="sortIcon('mpn')" :size="12" />
                </span>
              </th>
              <th
                class="cursor-pointer select-none px-3 py-2.5 text-muted transition-colors hover:text-zinc-300"
                @click="toggleSort('stock')"
              >
                <span class="inline-flex items-center gap-1">
                  Stock
                  <component :is="sortIcon('stock')" :size="12" />
                </span>
              </th>
              <th class="px-3 py-2.5 text-muted">Tags</th>
              <th
                class="cursor-pointer select-none px-3 py-2.5 text-muted transition-colors hover:text-zinc-300"
                @click="toggleSort('updated_at')"
              >
                <span class="inline-flex items-center gap-1">
                  Updated
                  <component :is="sortIcon('updated_at')" :size="12" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(part, idx) in sortedParts"
              :key="part.id"
              class="cursor-pointer border-b border-border/50 transition-colors hover:bg-surface-2/60"
              :class="idx % 2 === 1 ? 'bg-surface-1/30' : ''"
              @click="navigateToPart(part)"
            >
              <!-- Thumbnail -->
              <td class="px-3 py-2">
                <PartThumbnail :thumbnail="part.thumbnail" :name="part.name" />
              </td>

              <!-- Name + favorite -->
              <td class="px-3 py-2">
                <div class="flex items-center gap-1.5">
                  <Star
                    v-if="part.favorite"
                    :size="12"
                    :stroke-width="2"
                    class="flex-shrink-0 fill-warning text-warning"
                  />
                  <span class="font-medium text-zinc-200">{{ part.name }}</span>
                </div>
                <p
                  v-if="part.description"
                  class="mt-0.5 max-w-xs truncate text-[11px] text-muted"
                >
                  {{ part.description }}
                </p>
              </td>

              <!-- Category -->
              <td class="px-3 py-2 text-muted">
                {{ part.category_path ?? "\u2014" }}
              </td>

              <!-- Manufacturer -->
              <td class="px-3 py-2 text-zinc-300">
                {{ part.manufacturer ?? "\u2014" }}
              </td>

              <!-- MPN -->
              <td class="px-3 py-2">
                <span v-if="part.mpn" class="font-mono text-zinc-300">{{ part.mpn }}</span>
                <span v-else class="text-muted">&mdash;</span>
              </td>

              <!-- Stock -->
              <td class="px-3 py-2">
                <StockIndicator :stock="part.stock" :min-stock="part.min_stock" />
              </td>

              <!-- Tags -->
              <td class="px-3 py-2">
                <div class="flex flex-wrap gap-1">
                  <span
                    v-for="tag in part.tags.slice(0, 3)"
                    :key="tag"
                    class="inline-block rounded-full border border-accent/20 bg-accent/5 px-1.5 py-0.5 text-[10px] text-accent"
                  >
                    {{ tag }}
                  </span>
                  <span
                    v-if="part.tags.length > 3"
                    class="inline-block rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted"
                  >
                    +{{ part.tags.length - 3 }}
                  </span>
                </div>
              </td>

              <!-- Updated -->
              <td class="px-3 py-2 text-muted whitespace-nowrap">
                {{ timeAgo(part.updated_at) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Footer -->
      <div class="mt-4 flex items-center justify-between text-xs text-muted">
        <span>Showing {{ sortedParts.length }} part{{ sortedParts.length !== 1 ? "s" : "" }}</span>
        <button
          v-if="hasMore"
          class="rounded-md border border-border bg-surface-1 px-4 py-1.5 text-xs text-zinc-300 transition-colors hover:border-border-hover hover:bg-surface-2"
          @click="loadMore"
        >
          Load More
        </button>
      </div>
    </div>

    <!-- Add Part Modal -->
    <Modal :open="showAddModal" title="Add Part" @close="showAddModal = false">
      <form class="flex flex-col gap-4" @submit.prevent="submitAdd">
        <!-- Name -->
        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Name <span class="text-danger">*</span>
          </label>
          <input
            v-model="addForm.name"
            type="text"
            required
            placeholder="e.g. NE555"
            class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 placeholder-muted/50 outline-none transition-colors focus:border-accent/50"
          />
        </div>

        <!-- Description -->
        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Description
          </label>
          <textarea
            v-model="addForm.description"
            rows="2"
            placeholder="Optional description"
            class="w-full resize-none rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder-muted/50 outline-none transition-colors focus:border-accent/50"
          />
        </div>

        <!-- Category -->
        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Category
          </label>
          <input
            v-model="addForm.category"
            type="text"
            placeholder="e.g. ICs/Timers"
            class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 placeholder-muted/50 outline-none transition-colors focus:border-accent/50"
          />
        </div>

        <!-- Manufacturer + MPN row -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
              Manufacturer
            </label>
            <input
              v-model="addForm.manufacturer"
              type="text"
              placeholder="e.g. Texas Instruments"
              class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 placeholder-muted/50 outline-none transition-colors focus:border-accent/50"
            />
          </div>
          <div>
            <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
              MPN
            </label>
            <input
              v-model="addForm.mpn"
              type="text"
              placeholder="Manufacturer part number"
              class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 placeholder-muted/50 outline-none transition-colors focus:border-accent/50"
            />
          </div>
        </div>

        <!-- IPN + Footprint row -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
              IPN
            </label>
            <input
              v-model="addForm.ipn"
              type="text"
              placeholder="Internal part number"
              class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 placeholder-muted/50 outline-none transition-colors focus:border-accent/50"
            />
          </div>
          <div>
            <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
              Footprint
            </label>
            <input
              v-model="addForm.footprint"
              type="text"
              placeholder="e.g. DIP-8"
              class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 placeholder-muted/50 outline-none transition-colors focus:border-accent/50"
            />
          </div>
        </div>

        <!-- Tags -->
        <div>
          <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
            Tags
          </label>
          <input
            v-model="addForm.tags"
            type="text"
            placeholder="Comma-separated, e.g. timer, oscillator"
            class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 placeholder-muted/50 outline-none transition-colors focus:border-accent/50"
          />
        </div>

        <!-- Stock + Location + Min Stock row -->
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
              Initial Stock
            </label>
            <input
              v-model.number="addForm.stock"
              type="number"
              min="0"
              class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 outline-none transition-colors focus:border-accent/50"
            />
          </div>
          <div>
            <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
              Location
            </label>
            <input
              v-model="addForm.location"
              type="text"
              placeholder="e.g. Shelf A1"
              class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 placeholder-muted/50 outline-none transition-colors focus:border-accent/50"
            />
          </div>
          <div>
            <label class="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">
              Min Stock
            </label>
            <input
              v-model.number="addForm.min_stock"
              type="number"
              min="0"
              class="h-8 w-full rounded-md border border-border bg-surface-0 px-3 text-xs text-zinc-200 outline-none transition-colors focus:border-accent/50"
            />
          </div>
        </div>

        <!-- Error -->
        <div
          v-if="createMutation.isError.value"
          class="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger"
        >
          {{ (createMutation.error.value as Error)?.message ?? "Failed to create part" }}
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border bg-surface-2 px-4 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-surface-3"
          @click="showAddModal = false"
        >
          Cancel
        </button>
        <button
          class="rounded-md border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
          :disabled="!addForm.name.trim() || createMutation.isPending.value"
          @click="submitAdd"
        >
          <span v-if="createMutation.isPending.value">Creating...</span>
          <span v-else>Create Part</span>
        </button>
      </template>
    </Modal>
  </div>
</template>
