<script setup lang="ts">
import { ref, computed } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import {
  LayoutDashboard,
  Cpu,
  FolderTree,
  MapPin,
  Building2,
  Kanban,
  ShoppingCart,
  ScrollText,
  Search,
} from "lucide-vue-next";
import CommandPalette from "@/components/CommandPalette.vue";
import { useKeyboard } from "@/composables/useKeyboard";

const route = useRoute();
const commandPaletteOpen = ref(false);

useKeyboard({
  "mod+k": () => {
    commandPaletteOpen.value = !commandPaletteOpen.value;
  },
});

const navItems = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/", name: "dashboard" },
  { label: "Parts", icon: Cpu, to: "/parts", name: "parts" },
  { label: "Categories", icon: FolderTree, to: "/categories", name: "categories" },
  { label: "Locations", icon: MapPin, to: "/locations", name: "locations" },
  { label: "Suppliers", icon: Building2, to: "/suppliers", name: "suppliers" },
  { label: "Projects", icon: Kanban, to: "/projects", name: "projects" },
  { label: "Purchase Orders", icon: ShoppingCart, to: "/purchase-orders", name: "purchase-orders" },
  { label: "Audit Log", icon: ScrollText, to: "/audit", name: "audit" },
] as const;

function isActive(item: (typeof navItems)[number]): boolean {
  if (item.to === "/") return route.path === "/";
  return route.path.startsWith(item.to);
}

const breadcrumb = computed(() => {
  const match = navItems.find((item) => isActive(item));
  return match?.label ?? "Dashboard";
});

const isMac = navigator.platform.toUpperCase().includes("MAC");
</script>

<template>
  <!-- Sidebar -->
  <aside
    class="fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-border bg-surface-1"
  >
    <!-- Logo -->
    <div class="flex h-12 items-center gap-2 px-4">
      <span class="text-sm font-semibold tracking-widest text-zinc-200">tray</span>
      <span class="text-[10px] text-muted">v0.1.4</span>
    </div>

    <div class="mx-3 border-t border-border" />

    <!-- Navigation -->
    <nav class="flex-1 overflow-y-auto px-2 py-3">
      <ul class="flex flex-col gap-0.5">
        <li v-for="item in navItems" :key="item.name">
          <RouterLink
            :to="item.to"
            class="group relative flex items-center gap-3 rounded-md px-3 py-2 text-xs transition-colors duration-150"
            :class="
              isActive(item)
                ? 'text-zinc-100 bg-surface-2/60'
                : 'text-muted hover:text-zinc-300 hover:bg-surface-2/40'
            "
          >
            <!-- Active indicator -->
            <span
              v-if="isActive(item)"
              class="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent"
            />
            <component :is="item.icon" :size="15" :stroke-width="1.8" />
            <span>{{ item.label }}</span>
          </RouterLink>
        </li>
      </ul>
    </nav>
  </aside>

  <!-- Main wrapper -->
  <div class="pl-56">
    <!-- Header -->
    <header
      class="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-border bg-surface-0/80 px-6 backdrop-blur-sm"
    >
      <!-- Breadcrumb -->
      <span class="text-xs text-zinc-400">{{ breadcrumb }}</span>

      <!-- Search trigger -->
      <button
        class="flex items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-1.5 text-xs text-muted transition-colors duration-150 hover:border-border-hover hover:text-zinc-300"
        @click="commandPaletteOpen = true"
      >
        <Search :size="13" :stroke-width="1.8" />
        <span>Search...</span>
        <kbd class="ml-2">{{ isMac ? "\u2318" : "Ctrl+" }}K</kbd>
      </button>
    </header>

    <!-- Content -->
    <main class="p-6">
      <RouterView />
    </main>
  </div>

  <!-- Command Palette -->
  <CommandPalette v-model:open="commandPaletteOpen" />
</template>
