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
 * Strategy: Split only truly independent libraries to avoid circular deps
 */
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) {
    return undefined
  }

  // date-fns is a pure utility library with no React deps
  if (id.includes('date-fns')) {
    return 'vendor-date'
  }

  // i18next core is standalone (but react-i18next depends on React)
  if (id.includes('node_modules/i18next/') || id.includes('node_modules/i18next-browser-languagedetector/')) {
    return 'vendor-i18n'
  }

  // Radix primitives - large but self-contained UI library
  if (id.includes('@radix-ui')) {
    return 'vendor-radix'
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
