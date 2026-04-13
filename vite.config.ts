import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Base URL for deployment - set to repo name for GitHub Pages
const base = process.env.GITHUB_ACTIONS ? '/kikoushou/' : '/'

/**
 * Manual chunk splitting strategy to keep bundles under 500KB
 * Groups dependencies by functionality for optimal caching
 * 
 * Strategy: Split stable vendor libraries into long-lived cacheable chunks
 */
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) {
    return undefined
  }

  // React core — extremely stable, rarely changes between deploys
  if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
    return 'vendor-react'
  }

  // React Router — stable routing library
  if (id.includes('react-router')) {
    return 'vendor-router'
  }

  // Dexie (IndexedDB) — stable data layer with no React dependency
  if (id.includes('node_modules/dexie')) {
    return 'vendor-dexie'
  }

  // date-fns is a pure utility library with no React deps
  if (id.includes('date-fns')) {
    return 'vendor-date'
  }

  // i18next core + react-i18next bridge
  if (id.includes('i18next')) {
    return 'vendor-i18n'
  }

  // Radix primitives — large but self-contained UI library
  if (id.includes('@radix-ui')) {
    return 'vendor-radix'
  }

  // Lucide icons — tree-shaken but imported from many eager components
  if (id.includes('lucide-react')) {
    return 'vendor-icons'
  }

  // Hugging Face Transformers.js — large ML runtime, only loaded by the AI assistant page
  if (id.includes('@huggingface/transformers') || id.includes('onnxruntime')) {
    return 'vendor-transformers'
	}

  // Yjs CRDT + sync protocols — P2P sync layer
  if (
    id.includes('node_modules/yjs') ||
    id.includes('node_modules/y-webrtc') ||
    id.includes('node_modules/simple-peer') ||
    id.includes('y-protocols') ||
    id.includes('lib0')
  ) {
    return 'vendor-yjs'
  }

  // Let Rollup handle the rest to avoid circular dependencies
  return undefined
}

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.svg', 'favicon.svg'],
      manifest: {
        name: 'Kikoushou',
        short_name: 'Kikoushou',
        description: 'Organize your vacation house rooms and arrivals',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: base,
        icons: [
          {
            src: 'icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icons/icon-maskable.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Exclude large Transformers.js vendor chunk from precache (loaded on demand)
        globIgnores: ['**/vendor-transformers*.js'],
        // Runtime caching for external resources
        runtimeCaching: [
          {
            // Cache OpenStreetMap tiles for offline map viewing
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: {
                maxEntries: 500, // ~50MB assuming ~100KB per tile
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache Nominatim geocoding responses for location search
            urlPattern: /^https:\/\/nominatim\.openstreetmap\.org\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nominatim-geocoding',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
})
