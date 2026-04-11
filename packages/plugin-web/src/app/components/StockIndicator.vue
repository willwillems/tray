<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    stock: number;
    minStock?: number;
  }>(),
  {
    minStock: 0,
  }
);

type StockLevel = "ok" | "low" | "out";

const level = computed<StockLevel>(() => {
  if (props.stock <= 0) return "out";
  if (props.minStock > 0 && props.stock <= props.minStock) return "low";
  return "ok";
});

const colorClass = computed(() => {
  switch (level.value) {
    case "ok":
      return "text-success";
    case "low":
      return "text-warning";
    case "out":
      return "text-danger";
  }
});

const dotClass = computed(() => {
  switch (level.value) {
    case "ok":
      return "bg-success";
    case "low":
      return "bg-warning";
    case "out":
      return "bg-danger";
  }
});

const label = computed(() => {
  switch (level.value) {
    case "ok":
      return `${props.stock} in stock`;
    case "low":
      return `${props.stock} low`;
    case "out":
      return "Out of stock";
  }
});
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-xs font-medium" :class="colorClass">
    <span class="inline-block h-1.5 w-1.5 rounded-full" :class="dotClass" />
    {{ label }}
  </span>
</template>
