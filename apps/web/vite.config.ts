import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { resolveListenHost } from "../../packages/shared/src/networkAccess.js";

export default defineConfig({
  plugins: [react()],
  server: {
    host: resolveListenHost(process.env.NETWORKCHUM_BIND_MODE),
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
