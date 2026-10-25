/** The one Vite config. Its paths are absolute, so the server can start Vite from any project directory (#werk-stack-layout). */
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repo = import.meta.dirname;

export default defineConfig({
  root: join(repo, "client"),
  cacheDir: join(repo, "node_modules", ".vite"),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: join(repo, "dist", "client"),
    emptyOutDir: true,
  },
});
