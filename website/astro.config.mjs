import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://willwillems.github.io",
  base: "/tray",
  vite: {
    plugins: [tailwindcss()],
  },
});
