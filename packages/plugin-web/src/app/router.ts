import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      component: () => import("@/layouts/AppLayout.vue"),
      children: [
        { path: "", name: "dashboard", component: () => import("@/pages/DashboardPage.vue") },
        { path: "parts", name: "parts", component: () => import("@/pages/PartsPage.vue") },
        { path: "parts/:id", name: "part-detail", component: () => import("@/pages/PartDetailPage.vue"), props: true },
        { path: "categories", name: "categories", component: () => import("@/pages/CategoriesPage.vue") },
        { path: "locations", name: "locations", component: () => import("@/pages/LocationsPage.vue") },
        { path: "suppliers", name: "suppliers", component: () => import("@/pages/SuppliersPage.vue") },
        { path: "suppliers/:id", name: "supplier-detail", component: () => import("@/pages/SupplierDetailPage.vue"), props: true },
        { path: "projects", name: "projects", component: () => import("@/pages/ProjectsPage.vue") },
        { path: "projects/:id", name: "project-detail", component: () => import("@/pages/ProjectDetailPage.vue"), props: true },
        { path: "purchase-orders", name: "purchase-orders", component: () => import("@/pages/PurchaseOrdersPage.vue") },
        { path: "purchase-orders/:id", name: "po-detail", component: () => import("@/pages/PurchaseOrderDetailPage.vue"), props: true },
        { path: "audit", name: "audit", component: () => import("@/pages/AuditPage.vue") },
      ],
    },
  ],
});

export default router;
