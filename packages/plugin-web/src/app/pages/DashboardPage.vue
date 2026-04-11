<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import {
  Cpu,
  AlertTriangle,
  FolderTree,
  Kanban,
  Plus,
  PackagePlus,
  ArrowUpRight,
} from "lucide-vue-next";
import { parts, categories, projects, audit } from "@/lib/api";
import type { CategoryTreeNode, AuditLogEntry } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import LoadingSpinner from "@/components/LoadingSpinner.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import StockIndicator from "@/components/StockIndicator.vue";
import EmptyState from "@/components/EmptyState.vue";

// --- Data fetching ---

const { data: allParts, isLoading: partsLoading } = useQuery({
  queryKey: ["parts", "all"],
  queryFn: () => parts.list({ limit: 1000 }),
});

const { data: lowStockParts, isLoading: lowStockLoading } = useQuery({
  queryKey: ["parts", "low-stock"],
  queryFn: () => parts.list({ low: true }),
});

const { data: categoryTree, isLoading: categoriesLoading } = useQuery({
  queryKey: ["categories", "tree"],
  queryFn: () => categories.tree(),
});

const { data: activeProjects, isLoading: projectsLoading } = useQuery({
  queryKey: ["projects", "active"],
  queryFn: () => projects.list("active"),
});

const { data: recentAudit, isLoading: auditLoading } = useQuery({
  queryKey: ["audit", "recent"],
  queryFn: () => audit.list({ limit: 10 }),
});

// --- Computed stats ---

const totalParts = computed(() => allParts.value?.length ?? 0);
const lowStockCount = computed(() => lowStockParts.value?.length ?? 0);
const activeProjectCount = computed(() => activeProjects.value?.length ?? 0);

function countCategories(nodes: CategoryTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (node.children.length > 0) {
      count += countCategories(node.children);
    }
  }
  return count;
}

const totalCategories = computed(() =>
  categoryTree.value ? countCategories(categoryTree.value) : 0,
);

const isLoading = computed(
  () => partsLoading.value || lowStockLoading.value || categoriesLoading.value || projectsLoading.value,
);

// --- Audit helpers ---

function actionVariant(action: string): string {
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

function auditDescription(entry: AuditLogEntry): string {
  const entity = entry.entity_type.replace(/_/g, " ");
  switch (entry.action) {
    case "create":
      return `Created ${entity} #${entry.entity_id}`;
    case "update":
      return `Updated ${entity} #${entry.entity_id}`;
    case "delete":
      return `Deleted ${entity} #${entry.entity_id}`;
    default:
      return `${entry.action} ${entity} #${entry.entity_id}`;
  }
}

function auditRoute(entry: AuditLogEntry): string | null {
  switch (entry.entity_type) {
    case "part":
      return `/parts/${entry.entity_id}`;
    case "category":
      return "/categories";
    case "location":
      return "/locations";
    case "project":
      return `/projects/${entry.entity_id}`;
    case "supplier":
      return `/suppliers/${entry.entity_id}`;
    case "purchase_order":
      return `/purchase-orders/${entry.entity_id}`;
    default:
      return null;
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Page header -->
    <div>
      <h1 class="text-lg font-semibold text-zinc-100 tracking-wide">Dashboard</h1>
      <p class="text-xs text-muted mt-1">Inventory overview and recent activity</p>
    </div>

    <!-- Stats row -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <!-- Total Parts -->
      <div class="rounded-lg border border-border bg-surface-1 p-4">
        <div class="flex items-center justify-between">
          <span class="text-[11px] uppercase tracking-wider text-muted">Total Parts</span>
          <Cpu :size="14" class="text-accent/40" />
        </div>
        <div class="mt-2">
          <span v-if="partsLoading" class="text-2xl font-bold text-zinc-300">
            <LoadingSpinner size="sm" />
          </span>
          <span v-else class="text-2xl font-bold tabular-nums text-zinc-100">
            {{ totalParts }}
          </span>
        </div>
      </div>

      <!-- Low Stock -->
      <div class="rounded-lg border border-border bg-surface-1 p-4">
        <div class="flex items-center justify-between">
          <span class="text-[11px] uppercase tracking-wider text-muted">Low Stock</span>
          <AlertTriangle :size="14" class="text-warning/40" />
        </div>
        <div class="mt-2">
          <span v-if="lowStockLoading" class="text-2xl font-bold text-zinc-300">
            <LoadingSpinner size="sm" />
          </span>
          <span
            v-else
            class="text-2xl font-bold tabular-nums"
            :class="lowStockCount > 0 ? 'text-warning' : 'text-zinc-100'"
          >
            {{ lowStockCount }}
          </span>
        </div>
      </div>

      <!-- Total Categories -->
      <div class="rounded-lg border border-border bg-surface-1 p-4">
        <div class="flex items-center justify-between">
          <span class="text-[11px] uppercase tracking-wider text-muted">Categories</span>
          <FolderTree :size="14" class="text-accent/40" />
        </div>
        <div class="mt-2">
          <span v-if="categoriesLoading" class="text-2xl font-bold text-zinc-300">
            <LoadingSpinner size="sm" />
          </span>
          <span v-else class="text-2xl font-bold tabular-nums text-zinc-100">
            {{ totalCategories }}
          </span>
        </div>
      </div>

      <!-- Active Projects -->
      <div class="rounded-lg border border-border bg-surface-1 p-4">
        <div class="flex items-center justify-between">
          <span class="text-[11px] uppercase tracking-wider text-muted">Active Projects</span>
          <Kanban :size="14" class="text-accent/40" />
        </div>
        <div class="mt-2">
          <span v-if="projectsLoading" class="text-2xl font-bold text-zinc-300">
            <LoadingSpinner size="sm" />
          </span>
          <span v-else class="text-2xl font-bold tabular-nums text-zinc-100">
            {{ activeProjectCount }}
          </span>
        </div>
      </div>
    </div>

    <!-- Two-column layout: Activity + Low Stock Alerts -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <!-- Recent Activity -->
      <div class="rounded-lg border border-border bg-surface-1">
        <div class="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 class="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
            Recent Activity
          </h2>
          <RouterLink
            to="/audit"
            class="text-[11px] text-muted hover:text-accent transition-colors"
          >
            View all
          </RouterLink>
        </div>

        <div v-if="auditLoading" class="flex items-center justify-center py-12">
          <LoadingSpinner />
        </div>

        <div
          v-else-if="!recentAudit || recentAudit.length === 0"
          class="py-12"
        >
          <EmptyState title="No activity yet" description="Actions will appear here as you use the system." />
        </div>

        <ul v-else class="divide-y divide-border">
          <li
            v-for="entry in recentAudit"
            :key="entry.id"
            class="group"
          >
            <component
              :is="auditRoute(entry) ? 'RouterLink' : 'div'"
              :to="auditRoute(entry) ?? undefined"
              class="flex items-center gap-3 px-4 py-2.5 transition-colors"
              :class="auditRoute(entry) ? 'hover:bg-surface-2/50 cursor-pointer' : ''"
            >
              <!-- Action badge -->
              <span
                class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide whitespace-nowrap"
                :class="actionVariant(entry.action)"
              >
                {{ entry.action }}
              </span>

              <!-- Description -->
              <span class="flex-1 truncate text-xs text-zinc-300">
                {{ auditDescription(entry) }}
              </span>

              <!-- Timestamp -->
              <span class="flex-shrink-0 text-[11px] tabular-nums text-muted">
                {{ timeAgo(entry.timestamp) }}
              </span>

              <!-- Arrow on hover for linked entries -->
              <ArrowUpRight
                v-if="auditRoute(entry)"
                :size="12"
                class="flex-shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100"
              />
            </component>
          </li>
        </ul>
      </div>

      <!-- Low Stock Alerts -->
      <div class="rounded-lg border border-border bg-surface-1">
        <div class="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 class="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
            Low Stock Alerts
          </h2>
          <span
            v-if="lowStockParts && lowStockParts.length > 0"
            class="text-[11px] tabular-nums text-warning"
          >
            {{ lowStockParts.length }} item{{ lowStockParts.length === 1 ? "" : "s" }}
          </span>
        </div>

        <div v-if="lowStockLoading" class="flex items-center justify-center py-12">
          <LoadingSpinner />
        </div>

        <div
          v-else-if="!lowStockParts || lowStockParts.length === 0"
          class="py-12"
        >
          <EmptyState title="Stock levels healthy" description="No parts are below their minimum stock threshold." />
        </div>

        <ul v-else class="divide-y divide-border">
          <li v-for="part in lowStockParts" :key="part.id">
            <RouterLink
              :to="`/parts/${part.id}`"
              class="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/50"
            >
              <!-- Part info -->
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium text-zinc-200 truncate">
                  {{ part.name }}
                </div>
                <div class="text-[11px] text-muted mt-0.5">
                  min: {{ part.min_stock }}
                </div>
              </div>

              <!-- Stock indicator -->
              <StockIndicator :stock="part.stock" :min-stock="part.min_stock" />
            </RouterLink>
          </li>
        </ul>
      </div>
    </div>

    <!-- Quick actions bar -->
    <div class="rounded-lg border border-border bg-surface-1 px-4 py-3">
      <div class="flex items-center gap-3">
        <span class="text-[11px] uppercase tracking-wider text-muted mr-2">Quick Actions</span>

        <RouterLink
          to="/parts"
          class="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-accent/40 hover:text-accent"
        >
          <Plus :size="12" />
          Add Part
        </RouterLink>

        <RouterLink
          to="/parts"
          class="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-accent/40 hover:text-accent"
        >
          <PackagePlus :size="12" />
          Add Stock
        </RouterLink>

        <RouterLink
          to="/projects"
          class="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-accent/40 hover:text-accent"
        >
          <Kanban :size="12" />
          New Project
        </RouterLink>
      </div>
    </div>
  </div>
</template>
