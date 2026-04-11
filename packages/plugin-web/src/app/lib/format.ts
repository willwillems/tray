/** Formatting utilities for display. */

export function timeAgo(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    ok: "text-success",
    active: "text-success",
    received: "text-success",
    complete: "text-success",
    completed: "text-success",
    draft: "text-muted",
    unknown: "text-muted",
    damaged: "text-danger",
    cancelled: "text-danger",
    quarantined: "text-warning",
    returned: "text-warning",
    ordered: "text-accent",
    allocated: "text-accent",
    partial: "text-warning",
    archived: "text-muted",
    low: "text-warning",
  };
  return map[status] ?? "text-zinc-400";
}

export function stockLevel(stock: number, minStock: number): "ok" | "low" | "out" {
  if (stock <= 0) return "out";
  if (minStock > 0 && stock <= minStock) return "low";
  return "ok";
}
