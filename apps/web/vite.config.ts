import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/scans": "http://127.0.0.1:3001",
      "/cards": "http://127.0.0.1:3001",
      "/audit": "http://127.0.0.1:3001",
      "/recordings": "http://127.0.0.1:3001",
      "/health": "http://127.0.0.1:3001",
    },
  },
});
