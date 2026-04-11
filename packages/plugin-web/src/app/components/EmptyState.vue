<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center py-16 px-4 text-center">
    <div class="mb-4 text-muted/60">
      <slot name="icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M20 13V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7" />
          <path d="M2 17h20" />
          <path d="M12 13v4" />
          <path d="m2 17 2 4h16l2-4" />
        </svg>
      </slot>
    </div>
    <h3 class="text-sm font-medium text-zinc-300 mb-1">{{ title }}</h3>
    <p v-if="description" class="text-xs text-muted max-w-sm leading-relaxed">
      {{ description }}
    </p>
    <div v-if="$slots.action" class="mt-4">
      <slot name="action" />
    </div>
  </div>
</template>
