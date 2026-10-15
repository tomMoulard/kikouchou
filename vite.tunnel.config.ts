// Scratch config for the ngrok tunnel session. Not part of the build.
import { defineConfig, mergeConfig, type UserConfig } from 'vite'
import base from './vite.config.ts'

export default defineConfig(async (env) => {
  const resolved = (typeof base === 'function' ? await base(env) : base) as UserConfig
  return mergeConfig(resolved, {
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      allowedHosts: true,
      watch: {
        ignored: [
          '**/.worktrees/**',
          '**/dist/**',
          '**/playwright-report/**',
          '**/test-results/**',
          '**/coverage/**',
        ],
      },
    },
  } satisfies UserConfig)
})
