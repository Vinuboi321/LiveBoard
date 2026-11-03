import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Tray",
        short_name: "Tray",
        description: "Study notes built around markers.",
        theme_color: "#5B4BFF",
        background_color: "#F4F2FF",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        // Precache the app shell; diagram and PDF engines are cached the first time they're used.
        globPatterns: ["index.html", "assets/index-*.{js,css}", "*.{svg,png,webmanifest}", "icons/*.png"],
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith("/assets/"), handler: "CacheFirst", options: { cacheName: "tray-assets", expiration: { maxEntries: 300 } } },
          { urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com", handler: "StaleWhileRevalidate", options: { cacheName: "tray-fonts" } }
        ]
      }
    })
  ],
  server: {
    // During local dev, `vercel dev` serves /api. With plain `vite`, point this at a running `vercel dev`.
    proxy: process.env.API_PROXY ? { "/api": process.env.API_PROXY } : undefined
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1600 }
});
