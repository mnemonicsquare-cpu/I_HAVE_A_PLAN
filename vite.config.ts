import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  base: "/I_HAVE_A_PLAN/",
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "icon.svg",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png",
        "maskable-512.png",
      ],
      manifest: {
        id: "/I_HAVE_A_PLAN/",
        name: "Сейчас — одно следующее действие",
        short_name: "Сейчас",
        lang: "ru",
        description: "Спокойный локальный планировщик",
        start_url: "/I_HAVE_A_PLAN/",
        scope: "/I_HAVE_A_PLAN/",
        display: "standalone",
        theme_color: "#0B0D10",
        background_color: "#0B0D10",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cacheId: "seychas-v1",
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: "/I_HAVE_A_PLAN/index.html",
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
