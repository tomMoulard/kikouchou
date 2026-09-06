import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// The app is served from the root of its own host — `app.kikouchou.app` on
// GitHub Pages, `127.0.0.1` in dev and in the Playwright `production` project.
// It used to be `/<repo>/` under GITHUB_ACTIONS, back when Pages served it at
// `tommoulard.github.io/<repo>/`; with a custom domain there is no subpath, and
// keeping this constant is also what makes the build survive a repo rename.
// Everything that builds a URL reads `import.meta.env.BASE_URL` rather than
// assuming '/', so a subpath deploy still works if this ever changes back.
const base = '/'

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

  // Yjs CRDT — the document model and its local persistence. The y-webrtc and
  // simple-peer members of this chunk went with the transport.
  if (
    id.includes('node_modules/yjs') ||
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
 * `/join/<token>` asks for a file that does not exist. Pages serves
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
    name: 'kikouchou:github-pages-spa-fallback',
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
      // Registered by `lib/pwa/register` instead of by the script this would
      // otherwise inject into index.html. That script only ever calls
      // `navigator.serviceWorker.register`, which installs the worker and then
      // leaves the running page on whatever build it booted with; the
      // `virtual:pwa-register` module is the half of `autoUpdate` that reloads
      // once a new worker activates. See that module for the production bug.
      injectRegister: null,
      includeAssets: ['icons/*.svg', 'favicon.svg'],
      manifest: {
        name: 'Kikouchou',
        short_name: 'Kikouchou',
        description: 'Organize your vacation house rooms and arrivals',
        theme_color: '#0f172a',
        background_color: '#ffffff',
        display: 'standalone',
        // The app's identity, and the one manifest field a browser is not
        // allowed to guess twice. With no `id`, the computed identity falls
        // back to `start_url` — so it moves the day `base` moves, and every
        // installed copy of the app becomes a *different* app: a second icon
        // rather than an update of the first. Pinned to `base` so it stays the
        // same string `start_url` resolves against ('/' today, a subpath if
        // that constant ever changes back), which is also the stable id a
        // cross-origin `navigator.install()` from the landing page has to name.
        id: base,
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
        // The one hand-written line in an otherwise generated worker: a
        // `notificationclick` listener, so tapping a ride notification focuses
        // the app instead of doing nothing. `public/sw-notifications.js` is
        // copied verbatim into `dist`, and Workbox emits
        // `importScripts("sw-notifications.js")` at the top of `sw.js`.
        //
        // Deliberately NOT a switch to `injectManifest`. That mode replaces the
        // generated worker with a source file of ours, and the Playwright
        // `production` project (offline-first, pwa, maps-offline) runs against
        // exactly the worker this mode produces — a rewrite to add one listener
        // trades a tested gate for a nicety. The notification itself is posted
        // from the page via `registration.showNotification()`, which needs no
        // worker source at all; see `src/lib/notifications`.
        importScripts: ['sw-notifications.js'],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Exclude the large Transformers.js bundles from precache — the ML
        // runtime now lives in the assistant worker, fetched only when someone
        // actually loads a model.
        globIgnores: [
          '**/vendor-transformers*.js',
          '**/llm.worker*.js',
          // Byte-identical to index.html; see githubPagesSpaFallback above.
          '404.html',
          // Imported by the worker itself (see `importScripts` above), which
          // means the browser stores it alongside the worker's own script
          // resource and re-fetches it when the worker updates. A precache
          // entry would be a second copy that nothing ever reads.
          'sw-notifications.js',
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
            // Cache the CARTO dark basemap on the same terms as the OSM one
            // above. `MapView` swaps to it whenever the dark theme is active,
            // so without this entry every map a dark-mode user visits would be
            // blank offline while the same map worked in light mode.
            urlPattern: /^https:\/\/[abcd]\.basemaps\.cartocdn\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'carto-dark-tiles',
              expiration: {
                maxEntries: 500,
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
