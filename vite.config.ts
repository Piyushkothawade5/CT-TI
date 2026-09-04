import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseTarget = (env.VITE_SUPABASE_URL || "https://zsjmijuofklsybtynhrm.supabase.co").replace(/\/$/, "");

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
      dedupe: ["react", "react-dom"],
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    server: {
      port: 3000,
      host: "0.0.0.0",
      proxy: {
        "/api/supabase": {
          target: supabaseTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/api\/supabase/, ""),
        },
      },
    },
    preview: {
      port: 4173,
      host: "0.0.0.0",
      proxy: {
        "/api/supabase": {
          target: supabaseTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/api\/supabase/, ""),
        },
      },
    },
  };
});
