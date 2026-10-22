import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The SPA calls FastAPI through /api. In dev, Vite proxies that to the uvicorn server,
// so there are no CORS issues and the frontend/backend run independently.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
