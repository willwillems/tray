<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    size?: "sm" | "md" | "lg";
  }>(),
  {
    size: "md",
  }
);

const sizeClass = computed(() => {
  switch (props.size) {
    case "sm":
      return "h-4 w-4 border-[1.5px]";
    case "md":
      return "h-6 w-6 border-2";
    case "lg":
      return "h-8 w-8 border-2";
  }
});
</script>

<template>
  <span
    role="status"
    aria-label="Loading"
    class="inline-block animate-spin rounded-full border-accent/30 border-t-accent"
    :class="sizeClass"
  />
</template>
