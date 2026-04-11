<script setup lang="ts">
import { ref } from "vue";

export interface TreeNode {
  id: number;
  label: string;
  children?: TreeNode[];
  count?: number;
}

const props = withDefaults(
  defineProps<{
    nodes: TreeNode[];
    level?: number;
    selectedId?: number | null;
  }>(),
  {
    level: 0,
    selectedId: null,
  }
);

const emit = defineEmits<{
  select: [id: number];
}>();

const expanded = ref<Set<number>>(new Set());

function toggle(id: number) {
  if (expanded.value.has(id)) {
    expanded.value.delete(id);
  } else {
    expanded.value.add(id);
  }
}

function hasChildren(node: TreeNode): boolean {
  return !!node.children && node.children.length > 0;
}
</script>

<template>
  <ul class="w-full" role="tree">
    <li
      v-for="node in nodes"
      :key="node.id"
      role="treeitem"
      :aria-expanded="hasChildren(node) ? expanded.has(node.id) : undefined"
    >
      <button
        type="button"
        class="group flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-surface-2"
        :class="[
          selectedId === node.id
            ? 'border-l-2 border-accent bg-accent/5 text-zinc-100'
            : 'border-l-2 border-transparent text-zinc-400',
        ]"
        :style="{ paddingLeft: `${level * 16 + 8}px` }"
        @click="emit('select', node.id)"
      >
        <!-- Chevron -->
        <span
          v-if="hasChildren(node)"
          class="flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted transition-transform"
          :class="{ 'rotate-90': expanded.has(node.id) }"
          @click.stop="toggle(node.id)"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
        <span v-else class="w-4 flex-shrink-0" />

        <!-- Label -->
        <span class="truncate flex-1">{{ node.label }}</span>

        <!-- Count -->
        <span
          v-if="node.count !== undefined"
          class="ml-auto flex-shrink-0 text-[10px] tabular-nums text-muted"
        >
          {{ node.count }}
        </span>
      </button>

      <!-- Children (recursive) -->
      <Transition
        enter-active-class="transition-all duration-150 ease-out overflow-hidden"
        enter-from-class="max-h-0 opacity-0"
        enter-to-class="max-h-[2000px] opacity-100"
        leave-active-class="transition-all duration-100 ease-in overflow-hidden"
        leave-from-class="max-h-[2000px] opacity-100"
        leave-to-class="max-h-0 opacity-0"
      >
        <TreeView
          v-if="hasChildren(node) && expanded.has(node.id)"
          :nodes="node.children!"
          :level="level + 1"
          :selected-id="selectedId"
          @select="emit('select', $event)"
        />
      </Transition>
    </li>
  </ul>
</template>
