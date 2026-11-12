import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { dashboardConfig } from "./src/shared/config.ts";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: dashboardConfig.webPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${dashboardConfig.apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
