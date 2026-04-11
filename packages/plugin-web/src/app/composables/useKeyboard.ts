import { onMounted, onUnmounted } from "vue";

export function useKeyboard(handlers: Record<string, (e: KeyboardEvent) => void>) {
  function onKeydown(e: KeyboardEvent) {
    const key = [
      e.metaKey || e.ctrlKey ? "mod" : "",
      e.shiftKey ? "shift" : "",
      e.altKey ? "alt" : "",
      e.key.toLowerCase(),
    ]
      .filter(Boolean)
      .join("+");

    if (handlers[key]) {
      e.preventDefault();
      handlers[key](e);
    }
  }

  onMounted(() => window.addEventListener("keydown", onKeydown));
  onUnmounted(() => window.removeEventListener("keydown", onKeydown));
}
