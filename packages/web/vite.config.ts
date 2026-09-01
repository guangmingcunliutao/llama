import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import Pages from "vite-plugin-pages";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [
    react(),
    Pages({
      dirs: "src/pages",
      extensions: ["tsx"],
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:5000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
