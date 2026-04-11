<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  status: string;
}>();

type StatusVariant = "green" | "muted" | "red" | "amber" | "accent";

const statusMap: Record<string, StatusVariant> = {
  ok: "green",
  active: "green",
  received: "green",
  complete: "green",
  completed: "green",
  in_stock: "green",
  draft: "muted",
  unknown: "muted",
  archived: "muted",
  inactive: "muted",
  damaged: "red",
  cancelled: "red",
  rejected: "red",
  out_of_stock: "red",
  quarantined: "amber",
  returned: "amber",
  low: "amber",
  partial: "amber",
  pending: "amber",
  low_stock: "amber",
  ordered: "accent",
  allocated: "accent",
  processing: "accent",
  shipped: "accent",
};

const variant = computed<StatusVariant>(() => {
  const normalized = props.status.toLowerCase().replace(/[\s-]+/g, "_");
  return statusMap[normalized] ?? "muted";
});

const variantClasses = computed(() => {
  switch (variant.value) {
    case "green":
      return "text-success bg-success/10 border-success/20";
    case "red":
      return "text-danger bg-danger/10 border-danger/20";
    case "amber":
      return "text-warning bg-warning/10 border-warning/20";
    case "accent":
      return "text-accent bg-accent/10 border-accent/20";
    case "muted":
    default:
      return "text-muted bg-muted/10 border-muted/20";
  }
});

const label = computed(() => {
  return props.status.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
});
</script>

<template>
  <span
    :class="variantClasses"
    class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none tracking-wide uppercase whitespace-nowrap"
  >
    {{ label }}
  </span>
</template>
