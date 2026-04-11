<script setup lang="ts">
import LoadingSpinner from "./LoadingSpinner.vue";
import EmptyState from "./EmptyState.vue";

export interface Column {
  key: string;
  label: string;
  class?: string;
}

defineProps<{
  columns: Column[];
  rows: any[];
  loading?: boolean;
}>();

const emit = defineEmits<{
  "row-click": [row: any];
}>();

function getCellValue(row: any, key: string): any {
  // Support nested keys via dot notation e.g. "supplier.name"
  return key.split(".").reduce((obj, k) => obj?.[k], row);
}
</script>

<template>
  <div class="w-full overflow-x-auto rounded-lg border border-border">
    <!-- Loading overlay -->
    <div v-if="loading" class="flex items-center justify-center py-16">
      <LoadingSpinner size="md" />
    </div>

    <!-- Empty state -->
    <EmptyState
      v-else-if="rows.length === 0"
      title="No data"
      description="There are no items to display."
    />

    <!-- Table -->
    <table v-else class="w-full text-left text-xs">
      <thead class="sticky top-0 z-10 bg-surface-1 border-b border-border">
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            class="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted"
            :class="col.class"
          >
            {{ col.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, i) in rows"
          :key="i"
          class="border-b border-border/50 text-zinc-300 transition-colors cursor-pointer hover:bg-surface-2/60 even:bg-surface-0/40"
          @click="emit('row-click', row)"
        >
          <td
            v-for="col in columns"
            :key="col.key"
            class="whitespace-nowrap px-4 py-2.5"
            :class="col.class"
          >
            <slot :name="`cell-${col.key}`" :row="row" :value="getCellValue(row, col.key)">
              {{ getCellValue(row, col.key) ?? "—" }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
