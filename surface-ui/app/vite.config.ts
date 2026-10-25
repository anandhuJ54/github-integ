import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { physical, rootRoute } from "@tanstack/virtual-file-routes";

// The composed frontend: one router, one login. Each Surface keeps its pages in
// surface-ui/<surface>/src/routes; this app mounts them all at their original URLs.
const UI = path.resolve(__dirname, "..");
const SURFACES = [
  "marketing",
  "srp",
  "graph",
  "sales",
  "xmp",
  "etl",
  "nora-os",
  "skills",
  "admin",
  "ops",
];

const aliases = [
  { find: /^@v3\/ui$/, replacement: path.join(UI, "_base/index.ts") },
  { find: /^@v3\/ui\//, replacement: path.join(UI, "_base/src") + "/" },
  { find: /^@v3\/app\//, replacement: path.join(UI, "app/src") + "/" },
  ...SURFACES.map((s) => ({
    find: new RegExp(`^@v3/${s}/`),
    replacement: path.join(UI, s, "src") + "/",
  })),
];

export default defineConfig(({ mode }) => ({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: UI,
      generatedRouteTree: path.join(__dirname, ".generated/routeTree.gen.ts"),
      virtualRouteConfig: rootRoute("app/src/root.tsx", [
        physical("", "app/src/routes"),
        ...SURFACES.map((s) => physical("", `${s}/src/routes`)),
      ]),
    }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: aliases, dedupe: ["react", "react-dom", "@tanstack/react-router"] },
  envDir: __dirname,
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // Where `bun dev` forwards /api: API_PROXY_TARGET in app/.env, default the local uvicorn.
        target: loadEnv(mode, __dirname, "").API_PROXY_TARGET || "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
}));
