import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const apiTarget = process.env.VITE_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["localhost", "127.0.0.1"],
    watch: {
      usePolling: true,
      interval: 1000,
    },
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/health": { target: apiTarget, changeOrigin: true },
    },
  },
});
