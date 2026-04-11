<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { search as searchApi } from "@/lib/api";
import type { SearchResult } from "@/lib/types";

const open = defineModel<boolean>("open", { required: true });

const router = useRouter();
const query = ref("");
const selectedIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const searchResults = ref<SearchResult[]>([]);
const isSearching = ref(false);

interface NavCommand {
  type: "nav";
  label: string;
  path: string;
  icon: string;
  shortcut?: string;
}

interface PartResult {
  type: "part";
  id: number;
  name: string;
  description: string | null;
  category_path: string | null;
  manufacturer: string | null;
  stock: number;
}

type PaletteItem = NavCommand | PartResult;

const commands: NavCommand[] = [
  { type: "nav", label: "Go to Dashboard", path: "/", icon: "layout-dashboard", shortcut: "G D" },
  { type: "nav", label: "Go to Parts", path: "/parts", icon: "cpu", shortcut: "G P" },
  { type: "nav", label: "Go to Categories", path: "/categories", icon: "folder-tree", shortcut: "G C" },
  { type: "nav", label: "Go to Locations", path: "/locations", icon: "map-pin", shortcut: "G L" },
  { type: "nav", label: "Go to Suppliers", path: "/suppliers", icon: "truck", shortcut: "G S" },
  { type: "nav", label: "Go to Projects", path: "/projects", icon: "circuit-board", shortcut: "G J" },
  { type: "nav", label: "Go to Purchase Orders", path: "/purchase-orders", icon: "file-text", shortcut: "G O" },
  { type: "nav", label: "Go to Audit Log", path: "/audit", icon: "scroll-text", shortcut: "G A" },
];

const iconPaths: Record<string, string> = {
  "layout-dashboard": "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  cpu: "M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3M6 6h12v12H6zM9 9h6v6H9z",
  "folder-tree": "M13 10h7a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM3 3v12M3 9h4M3 15h4M7 5h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  "map-pin": "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  truck: "M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h1M14 18h1a1 1 0 0 0 1-1v-3.28a1 1 0 0 1 .684-.948l1.923-.641a1 1 0 0 1 1.279.606L21 15v2a1 1 0 0 1-1 1h-1M14 18a2 2 0 1 1-4 0M7 18a2 2 0 1 1-4 0M21 18a2 2 0 1 1-4 0",
  "circuit-board": "M12 12h.01M18 12h.01M6 12h.01M12 6h.01M12 18h.01M2 12h4M18 12h4M12 2v4M12 18v4M7.8 7.8 4.6 4.6M19.4 19.4l-3.2-3.2M7.8 16.2l-3.2 3.2M19.4 4.6l-3.2 3.2",
  "file-text": "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4M10 13H8M16 17H8M16 9h-2",
  "scroll-text": "M15 12h-5M15 8h-5M19 17V5a2 2 0 0 0-2-2H4M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2",
};

// Debounced search
let searchTimer: ReturnType<typeof setTimeout> | undefined;

watch(query, (val) => {
  clearTimeout(searchTimer);
  const q = val.trim();
  if (q.length < 2) {
    searchResults.value = [];
    isSearching.value = false;
    return;
  }
  isSearching.value = true;
  searchTimer = setTimeout(async () => {
    try {
      searchResults.value = await searchApi.query(q, 8);
    } catch {
      searchResults.value = [];
    } finally {
      isSearching.value = false;
    }
  }, 200);
});

const filteredCommands = computed<NavCommand[]>(() => {
  const q = query.value.toLowerCase().trim();
  if (!q) return commands;
  return commands.filter((cmd) => cmd.label.toLowerCase().includes(q));
});

const partResults = computed<PartResult[]>(() =>
  searchResults.value.map((sr) => ({
    type: "part" as const,
    id: sr.part.id,
    name: sr.part.name,
    description: sr.part.description,
    category_path: sr.part.category_path,
    manufacturer: sr.part.manufacturer,
    stock: sr.part.stock,
  })),
);

const allItems = computed<PaletteItem[]>(() => {
  const items: PaletteItem[] = [];
  if (partResults.value.length > 0) {
    items.push(...partResults.value);
  }
  items.push(...filteredCommands.value);
  return items;
});

const hasPartResults = computed(() => partResults.value.length > 0);
const hasQuery = computed(() => query.value.trim().length >= 2);

// Reset state when opening
watch(open, (isOpen) => {
  if (isOpen) {
    query.value = "";
    selectedIndex.value = 0;
    searchResults.value = [];
    isSearching.value = false;
    nextTick(() => inputRef.value?.focus());
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
});

function close() {
  open.value = false;
}

function select(item: PaletteItem) {
  if (item.type === "nav") {
    router.push(item.path);
  } else {
    router.push(`/parts/${item.id}`);
  }
  close();
}

function searchOnPartsPage() {
  const q = query.value.trim();
  if (q) {
    router.push({ path: "/parts", query: { q } });
  }
  close();
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return;

  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    close();
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (allItems.value.length > 0) {
      selectedIndex.value = (selectedIndex.value + 1) % allItems.value.length;
    }
    return;
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (allItems.value.length > 0) {
      selectedIndex.value =
        (selectedIndex.value - 1 + allItems.value.length) % allItems.value.length;
    }
    return;
  }

  if (e.key === "Enter") {
    e.preventDefault();
    const item = allItems.value[selectedIndex.value];
    if (item) {
      select(item);
    } else if (hasQuery.value) {
      searchOnPartsPage();
    }
    return;
  }
}

// Clamp selectedIndex when items change
watch(allItems, (items) => {
  if (selectedIndex.value >= items.length) {
    selectedIndex.value = Math.max(0, items.length - 1);
  }
});

onMounted(() => {
  document.addEventListener("keydown", onKeydown, true);
});

onUnmounted(() => {
  document.removeEventListener("keydown", onKeydown, true);
  document.body.style.overflow = "";
  clearTimeout(searchTimer);
});
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @mousedown="close" />

        <!-- Palette -->
        <div
          class="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface-1 shadow-2xl"
          @mousedown.stop
        >
          <!-- Search input -->
          <div class="flex items-center gap-3 border-b border-border px-4 py-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="flex-shrink-0 text-muted"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              placeholder="Search parts or type a command..."
              class="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-muted outline-none"
              @keydown.escape.prevent.stop="close"
            />
            <kbd class="hidden sm:inline-block">esc</kbd>
          </div>

          <!-- Results -->
          <div class="max-h-[360px] overflow-y-auto py-1">
            <!-- Searching indicator -->
            <div v-if="isSearching && hasQuery" class="px-4 py-2 text-[10px] uppercase tracking-wider text-muted">
              Searching...
            </div>

            <!-- Part search results section -->
            <template v-if="hasPartResults">
              <div class="px-4 py-1.5 text-[10px] uppercase tracking-wider text-muted">
                Parts
              </div>
              <button
                v-for="(item, i) in partResults"
                :key="`part-${item.id}`"
                type="button"
                class="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors"
                :class="
                  i === selectedIndex
                    ? 'bg-accent/10 text-accent'
                    : 'text-zinc-400 hover:bg-surface-2 hover:text-zinc-200'
                "
                @click="select(item)"
                @mouseenter="selectedIndex = i"
              >
                <!-- Part icon -->
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0">
                  <path :d="iconPaths['cpu']" />
                </svg>

                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="truncate font-medium">{{ item.name }}</span>
                    <span
                      class="flex-shrink-0 text-[10px] tabular-nums"
                      :class="item.stock <= 0 ? 'text-danger' : 'text-success'"
                    >{{ item.stock }} in stock</span>
                  </div>
                  <div class="flex gap-2 text-[11px] text-muted truncate">
                    <span v-if="item.category_path">{{ item.category_path }}</span>
                    <span v-if="item.manufacturer">{{ item.manufacturer }}</span>
                  </div>
                </div>
              </button>

              <!-- Search on parts page link -->
              <button
                v-if="hasQuery"
                type="button"
                class="flex w-full items-center gap-3 px-4 py-2 text-left text-xs text-muted transition-colors hover:bg-surface-2 hover:text-zinc-300"
                @click="searchOnPartsPage"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <span>Search "{{ query.trim() }}" on Parts page</span>
                <kbd class="ml-auto">&crarr;</kbd>
              </button>
            </template>

            <!-- No search results -->
            <div v-else-if="hasQuery && !isSearching && searchResults.length === 0" class="px-4 py-2 text-xs text-muted">
              No parts found for "{{ query.trim() }}"
            </div>

            <!-- Navigation commands section -->
            <template v-if="filteredCommands.length > 0">
              <div v-if="hasPartResults || hasQuery" class="mx-3 my-1 border-t border-border" />
              <div class="px-4 py-1.5 text-[10px] uppercase tracking-wider text-muted">
                Navigation
              </div>
              <button
                v-for="(cmd, ci) in filteredCommands"
                :key="cmd.path"
                type="button"
                class="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors"
                :class="
                  (partResults.length + ci) === selectedIndex
                    ? 'bg-accent/10 text-accent'
                    : 'text-zinc-400 hover:bg-surface-2 hover:text-zinc-200'
                "
                @click="select(cmd)"
                @mouseenter="selectedIndex = partResults.length + ci"
              >
                <!-- Icon -->
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  class="flex-shrink-0"
                >
                  <path :d="iconPaths[cmd.icon]" />
                </svg>

                <span class="flex-1 truncate">{{ cmd.label }}</span>

                <kbd v-if="cmd.shortcut" class="ml-auto">{{ cmd.shortcut }}</kbd>
              </button>
            </template>

            <!-- Empty state -->
            <div
              v-if="allItems.length === 0 && !isSearching"
              class="px-4 py-6 text-center text-xs text-muted"
            >
              No results found
            </div>
          </div>

          <!-- Footer -->
          <div
            class="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted"
          >
            <span>
              <kbd>&uarr;</kbd> <kbd>&darr;</kbd> navigate
            </span>
            <span>
              <kbd>&crarr;</kbd> open
              <kbd class="ml-2">esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
