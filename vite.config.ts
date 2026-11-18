import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const API_PORT = Number(process.env.TAGORE_API_PORT ?? 3001);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src/web"),
      "@shared": path.resolve(import.meta.dirname, "src/shared"),
      "@server": path.resolve(import.meta.dirname, "src/server"),
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${API_PORT}` },
  },
  build: { outDir: "dist" },
});
