<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { projects } from "@/lib/api";
import type { Project } from "@/lib/types";
import Modal from "@/components/Modal.vue";
import LoadingSpinner from "@/components/LoadingSpinner.vue";
import EmptyState from "@/components/EmptyState.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import { FolderKanban, Plus, ChevronRight } from "lucide-vue-next";

const router = useRouter();
const queryClient = useQueryClient();

// --- Data fetching ---
const { data: projectList, isLoading } = useQuery({
  queryKey: ["projects"],
  queryFn: () => projects.list(),
});

const projectItems = computed(() => projectList.value ?? []);

// --- Create modal ---
const showCreateModal = ref(false);
const form = ref({ name: "", description: "" });

function openCreate() {
  form.value = { name: "", description: "" };
  showCreateModal.value = true;
}

const createMutation = useMutation({
  mutationFn: (data: { name: string; description?: string }) => projects.create(data),
  onSuccess: (project) => {
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    showCreateModal.value = false;
    router.push(`/projects/${project.id}`);
  },
});

function handleCreate() {
  createMutation.mutate({
    name: form.value.name.trim(),
    description: form.value.description.trim() || undefined,
  });
}

function bomLineCount(project: Project): number {
  return project.bom_lines?.length ?? 0;
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <FolderKanban class="h-5 w-5 text-accent" />
        <h1 class="text-lg font-semibold text-zinc-100">Projects</h1>
        <span v-if="projectItems.length" class="text-xs text-muted">({{ projectItems.length }})</span>
      </div>
      <button
        class="flex items-center gap-2 rounded-md bg-accent/10 border border-accent/20 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
        @click="openCreate"
      >
        <Plus class="h-3.5 w-3.5" />
        New Project
      </button>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <LoadingSpinner size="lg" />
    </div>

    <!-- Empty state -->
    <EmptyState
      v-else-if="projectItems.length === 0"
      title="No projects yet"
      description="Create a project to manage BOMs and build orders."
    >
      <template #action>
        <button
          class="flex items-center gap-2 rounded-md bg-accent/10 border border-accent/20 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
          @click="openCreate"
        >
          <Plus class="h-3.5 w-3.5" />
          New Project
        </button>
      </template>
    </EmptyState>

    <!-- Project cards grid -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <button
        v-for="project in projectItems"
        :key="project.id"
        class="group text-left rounded-lg border border-border bg-surface-1 p-4 transition-all hover:border-accent/30 hover:bg-surface-2/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        @click="router.push(`/projects/${project.id}`)"
      >
        <div class="flex items-start justify-between mb-3">
          <h3 class="text-sm font-semibold text-zinc-200 group-hover:text-accent transition-colors truncate pr-2">
            {{ project.name }}
          </h3>
          <StatusBadge :status="project.status" />
        </div>

        <p
          v-if="project.description"
          class="text-xs text-muted leading-relaxed mb-4 line-clamp-2"
        >
          {{ project.description }}
        </p>
        <p v-else class="text-xs text-muted/40 italic mb-4">No description</p>

        <div class="flex items-center justify-between">
          <span class="text-[11px] text-muted">
            {{ bomLineCount(project) }} BOM line{{ bomLineCount(project) !== 1 ? "s" : "" }}
          </span>
          <ChevronRight class="h-3.5 w-3.5 text-muted/40 group-hover:text-accent/60 transition-colors" />
        </div>
      </button>
    </div>

    <!-- Create Modal -->
    <Modal :open="showCreateModal" title="New Project" @close="showCreateModal = false">
      <form class="space-y-4" @submit.prevent="handleCreate">
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
            Name <span class="text-danger">*</span>
          </label>
          <input
            v-model="form.name"
            type="text"
            required
            placeholder="e.g. Synth Module v2"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">Description</label>
          <textarea
            v-model="form.description"
            rows="3"
            placeholder="What is this project about?"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none resize-none"
          />
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
          @click="showCreateModal = false"
        >
          Cancel
        </button>
        <button
          class="flex items-center gap-2 rounded-md bg-accent/15 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
          :disabled="!form.name.trim() || createMutation.isPending.value"
          @click="handleCreate"
        >
          <LoadingSpinner v-if="createMutation.isPending.value" size="sm" />
          Create Project
        </button>
      </template>
    </Modal>
  </div>
</template>
