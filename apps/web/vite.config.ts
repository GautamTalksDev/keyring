import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(() => {
  const apiPort = Number(process.env.VITE_API_PORT ?? 3001);
  const apiTarget = `http://127.0.0.1:${apiPort}`;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        "/scans": apiTarget,
        "/cards": apiTarget,
        "/audit": apiTarget,
        "/recordings": apiTarget,
        "/health": apiTarget,
      },
    },
  };
});
