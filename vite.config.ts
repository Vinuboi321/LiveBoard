import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const artifact = !!process.env.ARTIFACT; // single-file build for a claude.ai artifact preview

export default defineConfig({
  define: { "import.meta.env.VITE_ARTIFACT": JSON.stringify(artifact ? "1" : "") },
  worker: { format: "es" },
  plugins: artifact ? [
    // the preview has no service worker; give the update hook an empty stand-in
    { name: "no-pwa", resolveId: (id: string) => (id === "virtual:pwa-register" ? "\0no-pwa" : null), load: (id: string) => (id === "\0no-pwa" ? "export const registerSW = () => () => Promise.resolve();" : null) }
  ] : [
    VitePWA({
      // Ask before updating, so a new version never reloads the page in the middle of typing.
      registerType: "prompt",
      injectRegister: null,
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "LiveBoard",
        short_name: "LiveBoard",
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
          { urlPattern: ({ url }) => url.pathname.startsWith("/assets/"), handler: "CacheFirst", options: { cacheName: "liveboard-assets", expiration: { maxEntries: 300 } } },
          { urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com", handler: "StaleWhileRevalidate", options: { cacheName: "liveboard-fonts" } }
        ]
      }
    })
  ],
  server: {
    // During local dev, `vercel dev` serves /api. With plain `vite`, point this at a running `vercel dev`.
    proxy: process.env.API_PROXY ? { "/api": process.env.API_PROXY } : undefined
  },
  build: artifact
    ? { target: "es2022", outDir: "dist-artifact", cssCodeSplit: false, assetsInlineLimit: 100_000_000, modulePreload: false, chunkSizeWarningLimit: 99999, rollupOptions: { output: { inlineDynamicImports: true } } }
    : { target: "es2022", chunkSizeWarningLimit: 1600 }
});
