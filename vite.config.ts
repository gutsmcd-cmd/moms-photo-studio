import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-32.png', 'icons/icon-180.png', 'icon.svg'],
      manifest: {
        id: '/moms-photo-studio/',
        name: "Mom's Photo Studio",
        short_name: 'Photo Studio',
        description: 'An easy photo editor with big buttons. Free, no ads, no sign-in.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#fff7fb',
        theme_color: '#2e8b57',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net' || url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'mps-runtime', expiration: { maxEntries: 40 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
})
