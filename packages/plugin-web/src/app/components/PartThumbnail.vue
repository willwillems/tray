<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  thumbnail?: string | null;
  name: string;
}>();

const initials = computed(() => {
  return props.name
    .replace(/[^a-zA-Z0-9]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
});

// Deterministic color from name string for placeholder background
const placeholderColor = computed(() => {
  const colors = [
    "bg-accent/20 text-accent",
    "bg-success/20 text-success",
    "bg-warning/20 text-warning",
    "bg-danger/20 text-danger",
    "bg-purple-500/20 text-purple-400",
    "bg-pink-500/20 text-pink-400",
    "bg-blue-500/20 text-blue-400",
    "bg-orange-500/20 text-orange-400",
  ];
  let hash = 0;
  for (let i = 0; i < props.name.length; i++) {
    hash = (hash * 31 + props.name.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
});
</script>

<template>
  <div class="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md">
    <img
      v-if="thumbnail"
      :src="`data:image/jpeg;base64,${thumbnail}`"
      :alt="name"
      class="h-full w-full object-cover"
      loading="lazy"
    />
    <div
      v-else
      class="flex h-full w-full items-center justify-center text-[11px] font-bold tracking-wide"
      :class="placeholderColor"
    >
      {{ initials }}
    </div>
  </div>
</template>
