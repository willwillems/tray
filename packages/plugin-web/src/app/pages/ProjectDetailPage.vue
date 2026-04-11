<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { projects, builds, parts as partsApi } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Project, BomLine, BuildOrder, BomAvailability, Part } from "@/lib/types";
import DataTable from "@/components/DataTable.vue";
import Modal from "@/components/Modal.vue";
import LoadingSpinner from "@/components/LoadingSpinner.vue";
import StatusBadge from "@/components/StatusBadge.vue";
import EmptyState from "@/components/EmptyState.vue";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Archive,
  Plus,
  X,
  Hammer,
  CheckCircle,
  AlertTriangle,
  Search,
  Package,
} from "lucide-vue-next";

const props = defineProps<{ id: string }>();
const router = useRouter();
const queryClient = useQueryClient();

const projectId = computed(() => Number(props.id));

// --- Data fetching ---
const { data: project, isLoading: loadingProject } = useQuery({
  queryKey: ["projects", projectId],
  queryFn: () => projects.get(projectId.value),
});

const { data: bomLines, isLoading: loadingBom } = useQuery({
  queryKey: ["projects", projectId, "bom"],
  queryFn: () => projects.bom(projectId.value),
});

const bom = computed(() => bomLines.value ?? []);

const { data: buildOrders, isLoading: loadingBuilds } = useQuery({
  queryKey: ["builds", projectId],
  queryFn: () => builds.list(projectId.value),
});

const buildList = computed(() => buildOrders.value ?? []);

// --- Build readiness ---
const buildQty = ref(1);
const checkEnabled = ref(false);

const { data: availability, isLoading: loadingAvailability, refetch: recheckAvailability } = useQuery({
  queryKey: ["projects", projectId, "availability", buildQty],
  queryFn: () => projects.checkAvailability(projectId.value, buildQty.value),
  enabled: checkEnabled,
});

function checkReadiness() {
  checkEnabled.value = true;
  recheckAvailability();
}

// --- Edit modal ---
const showEditModal = ref(false);
const editForm = ref({ name: "", description: "", status: "active" });

function openEdit() {
  if (!project.value) return;
  editForm.value = {
    name: project.value.name,
    description: project.value.description ?? "",
    status: project.value.status,
  };
  showEditModal.value = true;
}

const updateMutation = useMutation({
  mutationFn: (data: { name?: string; description?: string | null; status?: string }) =>
    projects.update(projectId.value, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
    showEditModal.value = false;
  },
});

function handleUpdate() {
  updateMutation.mutate({
    name: editForm.value.name.trim(),
    description: editForm.value.description.trim() || null,
    status: editForm.value.status,
  });
}

// --- Archive ---
const archiveMutation = useMutation({
  mutationFn: () => projects.update(projectId.value, { status: "archived" }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
  },
});

// --- Delete ---
const showDeleteConfirm = ref(false);

const deleteMutation = useMutation({
  mutationFn: () => projects.delete(projectId.value),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    router.push("/projects");
  },
});

// --- Add BOM line modal ---
const showBomModal = ref(false);
const bomForm = ref({ part_id: null as number | null, quantity: 1, reference_designators: "", notes: "" });
const partSearchQuery = ref("");
const showPartDropdown = ref(false);

const { data: searchParts } = useQuery({
  queryKey: ["parts-search", partSearchQuery],
  queryFn: () => partsApi.list({ search: partSearchQuery.value, limit: 20 }),
  enabled: computed(() => partSearchQuery.value.length >= 1),
});

const partResults = computed(() => searchParts.value ?? []);
const selectedPart = ref<Part | null>(null);

function selectPart(part: Part) {
  selectedPart.value = part;
  bomForm.value.part_id = part.id;
  partSearchQuery.value = part.name;
  showPartDropdown.value = false;
}

function openBomModal() {
  bomForm.value = { part_id: null, quantity: 1, reference_designators: "", notes: "" };
  partSearchQuery.value = "";
  selectedPart.value = null;
  showBomModal.value = true;
}

const addBomMutation = useMutation({
  mutationFn: (data: { part_id: number; quantity_required: number; reference_designators?: string; notes?: string }) =>
    projects.addBomLine(projectId.value, data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["projects", projectId, "bom"] });
    showBomModal.value = false;
  },
});

function handleAddBomLine() {
  if (!bomForm.value.part_id) return;
  addBomMutation.mutate({
    part_id: bomForm.value.part_id,
    quantity_required: bomForm.value.quantity,
    reference_designators: bomForm.value.reference_designators.trim() || undefined,
    notes: bomForm.value.notes.trim() || undefined,
  });
}

// --- Remove BOM line ---
const removeBomMutation = useMutation({
  mutationFn: (lineId: number) => projects.removeBomLine(lineId),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["projects", projectId, "bom"] });
  },
});

// --- Create build ---
const showBuildModal = ref(false);
const buildQuantity = ref(1);

const createBuildMutation = useMutation({
  mutationFn: (quantity: number) => builds.create({ project_id: projectId.value, quantity }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["builds", projectId] });
    showBuildModal.value = false;
  },
});

function handleCreateBuild() {
  createBuildMutation.mutate(buildQuantity.value);
}

// --- Complete build ---
const completeBuildMutation = useMutation({
  mutationFn: (buildId: number) => builds.complete(buildId),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["builds", projectId] });
    queryClient.invalidateQueries({ queryKey: ["projects", projectId, "bom"] });
  },
});

// --- BOM table columns ---
const bomColumns = [
  { key: "part_name", label: "Part" },
  { key: "quantity_required", label: "Qty Required", class: "text-right" },
  { key: "reference_designators", label: "Ref Des" },
  { key: "part_stock", label: "Stock", class: "text-right" },
  { key: "status", label: "Status" },
  { key: "actions", label: "", class: "w-12 text-right" },
];

const buildColumns = [
  { key: "id", label: "ID" },
  { key: "quantity", label: "Quantity", class: "text-right" },
  { key: "status", label: "Status" },
  { key: "created_at", label: "Created" },
  { key: "completed_at", label: "Completed" },
  { key: "actions", label: "", class: "w-32 text-right" },
];

function bomLineStatus(line: BomLine): "sufficient" | "short" {
  const stock = line.part_stock ?? 0;
  return stock >= line.quantity_required ? "sufficient" : "short";
}
</script>

<template>
  <div class="space-y-6">
    <!-- Loading -->
    <div v-if="loadingProject" class="flex items-center justify-center py-20">
      <LoadingSpinner size="lg" />
    </div>

    <template v-else-if="project">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <button
            class="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
            @click="router.push('/projects')"
          >
            <ArrowLeft class="h-4 w-4" />
          </button>
          <h1 class="text-lg font-semibold text-zinc-100">{{ project.name }}</h1>
          <StatusBadge :status="project.status" />
        </div>
        <div class="flex items-center gap-2">
          <button
            class="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
            @click="openEdit"
          >
            <Pencil class="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            v-if="project.status !== 'archived'"
            class="flex items-center gap-1.5 rounded-md border border-warning/20 px-3 py-1.5 text-xs text-warning/80 hover:bg-warning/10 hover:text-warning transition-colors"
            :disabled="archiveMutation.isPending.value"
            @click="archiveMutation.mutate()"
          >
            <Archive class="h-3.5 w-3.5" />
            Archive
          </button>
          <button
            class="flex items-center gap-1.5 rounded-md border border-danger/20 px-3 py-1.5 text-xs text-danger/80 hover:bg-danger/10 hover:text-danger transition-colors"
            @click="showDeleteConfirm = true"
          >
            <Trash2 class="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>

      <!-- Description -->
      <p v-if="project.description" class="text-xs text-muted leading-relaxed max-w-2xl">
        {{ project.description }}
      </p>

      <!-- ===== BOM Table ===== -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-zinc-200">
            Bill of Materials
            <span v-if="bom.length" class="text-muted font-normal">({{ bom.length }})</span>
          </h2>
          <button
            class="flex items-center gap-1.5 rounded-md bg-accent/10 border border-accent/20 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
            @click="openBomModal"
          >
            <Plus class="h-3.5 w-3.5" />
            Add BOM Line
          </button>
        </div>

        <DataTable
          :columns="bomColumns"
          :rows="bom"
          :loading="loadingBom"
          @row-click="(row: BomLine) => router.push(`/parts/${row.part_id}`)"
        >
          <template #cell-part_name="{ row }">
            <span class="font-medium text-zinc-200">{{ row.part_name ?? `Part #${row.part_id}` }}</span>
          </template>

          <template #cell-quantity_required="{ row }">
            <span class="tabular-nums">{{ row.quantity_required }}</span>
          </template>

          <template #cell-reference_designators="{ row }">
            <code v-if="row.reference_designators" class="text-[11px] text-accent/70 bg-accent/5 px-1.5 py-0.5 rounded">
              {{ row.reference_designators }}
            </code>
            <span v-else class="text-muted">—</span>
          </template>

          <template #cell-part_stock="{ row }">
            <span class="tabular-nums" :class="(row.part_stock ?? 0) >= row.quantity_required ? 'text-success' : 'text-danger'">
              {{ row.part_stock ?? 0 }}
            </span>
          </template>

          <template #cell-status="{ row }">
            <span
              v-if="bomLineStatus(row) === 'sufficient'"
              class="inline-flex items-center gap-1 text-[11px] text-success"
            >
              <CheckCircle class="h-3 w-3" />
              OK
            </span>
            <span v-else class="inline-flex items-center gap-1 text-[11px] text-danger">
              <AlertTriangle class="h-3 w-3" />
              Short
            </span>
          </template>

          <template #cell-actions="{ row }">
            <div class="flex justify-end" @click.stop>
              <button
                class="rounded p-1 text-muted hover:bg-danger/10 hover:text-danger transition-colors"
                title="Remove line"
                :disabled="removeBomMutation.isPending.value"
                @click="removeBomMutation.mutate(row.id)"
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </div>
          </template>
        </DataTable>
      </div>

      <!-- ===== Build Readiness ===== -->
      <div class="space-y-3">
        <h2 class="text-sm font-semibold text-zinc-200">Build Readiness</h2>

        <div class="rounded-lg border border-border bg-surface-1 p-4">
          <div class="flex items-end gap-3 mb-4">
            <div>
              <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
                Build Quantity
              </label>
              <input
                v-model.number="buildQty"
                type="number"
                min="1"
                class="w-24 rounded-md border border-border bg-surface-0 px-3 py-1.5 text-xs text-zinc-200 tabular-nums focus:border-accent focus:outline-none"
              />
            </div>
            <button
              class="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-zinc-300 hover:bg-surface-2 transition-colors"
              :disabled="loadingAvailability"
              @click="checkReadiness"
            >
              <Search class="h-3.5 w-3.5" />
              Check
            </button>
          </div>

          <div v-if="loadingAvailability" class="flex items-center gap-2 text-xs text-muted">
            <LoadingSpinner size="sm" />
            Checking availability...
          </div>

          <div v-else-if="availability">
            <!-- Overall status -->
            <div class="flex items-center gap-2 mb-3">
              <span
                v-if="availability.can_build"
                class="inline-flex items-center gap-1.5 text-xs font-medium text-success"
              >
                <CheckCircle class="h-4 w-4" />
                Ready to build {{ buildQty }} unit{{ buildQty !== 1 ? "s" : "" }}
              </span>
              <span v-else class="inline-flex items-center gap-1.5 text-xs font-medium text-danger">
                <AlertTriangle class="h-4 w-4" />
                Cannot build — shortages detected
              </span>
            </div>

            <!-- Shortages list -->
            <div v-if="availability.shortages.length > 0" class="space-y-1">
              <div
                v-for="shortage in availability.shortages"
                :key="shortage.part_id"
                class="flex items-center justify-between rounded bg-surface-0 px-3 py-2 text-xs"
              >
                <span class="text-zinc-300">{{ shortage.part_name }}</span>
                <div class="flex items-center gap-4 tabular-nums">
                  <span class="text-muted">need <span class="text-zinc-300">{{ shortage.required }}</span></span>
                  <span class="text-muted">have <span class="text-zinc-300">{{ shortage.available }}</span></span>
                  <span class="text-danger font-medium">short {{ shortage.short }}</span>
                </div>
              </div>
            </div>
          </div>

          <p v-else class="text-xs text-muted">
            Enter a build quantity and click Check to verify part availability.
          </p>
        </div>
      </div>

      <!-- ===== Build Orders ===== -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-zinc-200">
            Build Orders
            <span v-if="buildList.length" class="text-muted font-normal">({{ buildList.length }})</span>
          </h2>
          <button
            class="flex items-center gap-1.5 rounded-md bg-accent/10 border border-accent/20 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
            @click="showBuildModal = true; buildQuantity = 1"
          >
            <Hammer class="h-3.5 w-3.5" />
            Create Build
          </button>
        </div>

        <DataTable :columns="buildColumns" :rows="buildList" :loading="loadingBuilds">
          <template #cell-id="{ row }">
            <span class="tabular-nums text-muted">#{{ row.id }}</span>
          </template>

          <template #cell-quantity="{ row }">
            <span class="tabular-nums">{{ row.quantity }}</span>
          </template>

          <template #cell-status="{ row }">
            <StatusBadge :status="row.status" />
          </template>

          <template #cell-created_at="{ row }">
            <span class="text-muted">{{ formatDate(row.created_at) }}</span>
          </template>

          <template #cell-completed_at="{ row }">
            <span v-if="row.completed_at" class="text-muted">{{ formatDate(row.completed_at) }}</span>
            <span v-else class="text-muted">—</span>
          </template>

          <template #cell-actions="{ row }">
            <div class="flex justify-end" @click.stop>
              <button
                v-if="row.status === 'draft'"
                class="flex items-center gap-1 rounded-md bg-success/10 border border-success/20 px-2.5 py-1 text-[11px] font-medium text-success hover:bg-success/20 transition-colors disabled:opacity-50"
                :disabled="completeBuildMutation.isPending.value"
                @click="completeBuildMutation.mutate(row.id)"
              >
                <CheckCircle class="h-3 w-3" />
                Complete
              </button>
            </div>
          </template>
        </DataTable>
      </div>
    </template>

    <!-- ===== Modals ===== -->

    <!-- Edit Project Modal -->
    <Modal :open="showEditModal" title="Edit Project" @close="showEditModal = false">
      <form class="space-y-4" @submit.prevent="handleUpdate">
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
            Name <span class="text-danger">*</span>
          </label>
          <input
            v-model="editForm.name"
            type="text"
            required
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">Description</label>
          <textarea
            v-model="editForm.description"
            rows="3"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none resize-none"
          />
        </div>
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">Status</label>
          <select
            v-model="editForm.status"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 focus:border-accent focus:outline-none"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="draft">Draft</option>
          </select>
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
          @click="showEditModal = false"
        >
          Cancel
        </button>
        <button
          class="flex items-center gap-2 rounded-md bg-accent/15 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
          :disabled="!editForm.name.trim() || updateMutation.isPending.value"
          @click="handleUpdate"
        >
          <LoadingSpinner v-if="updateMutation.isPending.value" size="sm" />
          Update
        </button>
      </template>
    </Modal>

    <!-- Add BOM Line Modal -->
    <Modal :open="showBomModal" title="Add BOM Line" @close="showBomModal = false">
      <form class="space-y-4" @submit.prevent="handleAddBomLine">
        <div class="relative">
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
            Part <span class="text-danger">*</span>
          </label>
          <div class="relative">
            <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
            <input
              v-model="partSearchQuery"
              type="text"
              placeholder="Search parts..."
              class="w-full rounded-md border border-border bg-surface-0 pl-8 pr-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none"
              @focus="showPartDropdown = true"
              @input="showPartDropdown = true"
            />
          </div>
          <!-- Part dropdown -->
          <div
            v-if="showPartDropdown && partResults.length > 0"
            class="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-border bg-surface-1 shadow-lg"
          >
            <button
              v-for="part in partResults"
              :key="part.id"
              type="button"
              class="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-zinc-300 hover:bg-surface-2 transition-colors"
              @click="selectPart(part)"
            >
              <Package class="h-3 w-3 text-muted flex-shrink-0" />
              <span class="truncate">{{ part.name }}</span>
              <span class="text-muted ml-auto tabular-nums">stock: {{ part.stock }}</span>
            </button>
          </div>
          <p v-if="selectedPart" class="mt-1 text-[11px] text-accent">
            Selected: {{ selectedPart.name }} (ID: {{ selectedPart.id }})
          </p>
        </div>
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
            Quantity <span class="text-danger">*</span>
          </label>
          <input
            v-model.number="bomForm.quantity"
            type="number"
            min="1"
            required
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 tabular-nums focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
            Reference Designators
          </label>
          <input
            v-model="bomForm.reference_designators"
            type="text"
            placeholder="e.g. R1, R2, R3"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">Notes</label>
          <textarea
            v-model="bomForm.notes"
            rows="2"
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 placeholder:text-muted/50 focus:border-accent focus:outline-none resize-none"
          />
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
          @click="showBomModal = false"
        >
          Cancel
        </button>
        <button
          class="flex items-center gap-2 rounded-md bg-accent/15 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
          :disabled="!bomForm.part_id || bomForm.quantity < 1 || addBomMutation.isPending.value"
          @click="handleAddBomLine"
        >
          <LoadingSpinner v-if="addBomMutation.isPending.value" size="sm" />
          Add Line
        </button>
      </template>
    </Modal>

    <!-- Create Build Modal -->
    <Modal :open="showBuildModal" title="Create Build Order" @close="showBuildModal = false">
      <form class="space-y-4" @submit.prevent="handleCreateBuild">
        <div>
          <label class="block text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
            Quantity <span class="text-danger">*</span>
          </label>
          <input
            v-model.number="buildQuantity"
            type="number"
            min="1"
            required
            class="w-full rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-zinc-200 tabular-nums focus:border-accent focus:outline-none"
          />
          <p class="mt-1.5 text-[11px] text-muted">
            This will create a build order and allocate stock when completed.
          </p>
        </div>
      </form>

      <template #footer>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
          @click="showBuildModal = false"
        >
          Cancel
        </button>
        <button
          class="flex items-center gap-2 rounded-md bg-accent/15 border border-accent/30 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
          :disabled="buildQuantity < 1 || createBuildMutation.isPending.value"
          @click="handleCreateBuild"
        >
          <LoadingSpinner v-if="createBuildMutation.isPending.value" size="sm" />
          Create Build
        </button>
      </template>
    </Modal>

    <!-- Delete Confirmation -->
    <Modal :open="showDeleteConfirm" title="Delete Project" @close="showDeleteConfirm = false">
      <p class="text-xs text-zinc-300 leading-relaxed">
        Are you sure you want to delete <strong>{{ project?.name }}</strong>?
        All BOM lines and build orders for this project will also be removed. This action cannot be undone.
      </p>

      <template #footer>
        <button
          class="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-zinc-300 transition-colors"
          @click="showDeleteConfirm = false"
        >
          Cancel
        </button>
        <button
          class="flex items-center gap-2 rounded-md bg-danger/15 border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/25 transition-colors disabled:opacity-50"
          :disabled="deleteMutation.isPending.value"
          @click="deleteMutation.mutate()"
        >
          <LoadingSpinner v-if="deleteMutation.isPending.value" size="sm" />
          Delete
        </button>
      </template>
    </Modal>
  </div>
</template>
