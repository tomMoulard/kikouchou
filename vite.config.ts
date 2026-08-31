import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
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

  // Supabase client — auth + Postgres + Realtime, loaded on every page that syncs
  if (id.includes('@supabase')) {
    return 'vendor-supabase'
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

/**
 * GitHub Pages has no SPA rewrite: a cold load of a deep link like
 * `/kikoushou/join/<token>` asks for a file that does not exist. Pages serves
 * `404.html` for those, and although the status is 404 the browser still renders
 * it — so a copy of the built `index.html` boots the app, and the router reads
 * the real `location.pathname` and resolves the route.
 *
 * Share links are deep links by definition, so this is load-bearing for the
 * join flow, not a nicety. Sign-in does not depend on it: `redirectTo` points at
 * the app root, which Pages serves normally.
 *
 * Only the cold, pre-service-worker load ever fetches it: once the SW is
 * installed its `navigateFallback` NavigationRoute answers every navigation from
 * the precached `index.html`, so `404.html` is never requested again. It is
 * therefore excluded from the precache manifest via `globIgnores` — VitePWA
 * globs `dist` in its own `closeBundle`, which runs after this one, so without
 * that entry the same bytes would be precached twice under two names.
 */
function githubPagesSpaFallback(): Plugin {
  let outDir = 'dist'

  return {
    name: 'kikoushou:github-pages-spa-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const indexHtml = resolve(outDir, 'index.html')
      if (!existsSync(indexHtml)) {
        this.warn(`no ${indexHtml} to copy — skipping 404.html fallback`)
        return
      }
      copyFileSync(indexHtml, resolve(outDir, '404.html'))
    },
  }
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
        // Exclude the large Transformers.js bundles from precache — the ML
        // runtime now lives in the assistant worker, fetched only when someone
        // actually loads a model.
        globIgnores: [
          '**/vendor-transformers*.js',
          '**/llm.worker*.js',
          // Byte-identical to index.html; see githubPagesSpaFallback above.
          '404.html',
        ],
        // Runtime caching for external resources
        runtimeCaching: [
          {
            // Supabase auth and data must NEVER be served from cache. A stale
            // session or a stale row read is a correctness bug, not a slow
            // page: the app's offline story is IndexedDB + the Yjs outbox, not
            // cached HTTP responses. Listed first so it wins over any later
            // pattern.
            urlPattern: /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/.*/i,
            handler: 'NetworkOnly',
          },
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
    githubPagesSpaFallback(),
  ],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  // The assistant worker statically imports Transformers.js, which needs
  // code-splitting — Vite's default `iife` worker format cannot express that.
  worker: {
    format: 'es',
  },
  build: {
    // Emitted so PostHog Error Tracking can de-minify production stack traces.
    // The deploy workflow uploads the maps and then deletes them, so they are
    // never served from GitHub Pages — see .github/workflows/deploy.yml.
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
})
