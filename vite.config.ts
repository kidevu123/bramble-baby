/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig, type ProxyOptions } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const upstream = process.env.BB_UPSTREAM ?? 'http://127.0.0.1:8000'
// The companion service can be pointed elsewhere (e.g. a local python process) for tests.
const companionUpstream = process.env.BRAMBLE_UPSTREAM ?? upstream
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
const gitSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'nogit'
  }
})()
const proxyPaths = ['/api', '/login', '/logout', '/static', '/media', '/admin', '/bramble']

export default defineConfig({
  // Shown in Settings so a phone that is still running a cached build is obvious at a glance.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(gitSha),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // 'prompt': the new build waits until the user taps "Update" (UpdateBanner), so a mid-feed reload never happens.
      registerType: 'prompt',
      includeAssets: ['icons/*.svg', 'icons/*.png'],
      manifest: {
        name: 'Bramble',
        short_name: 'Bramble',
        description: 'Baby tracker with nap prediction',
        theme_color: '#F4FAFB',
        background_color: '#F4FAFB',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        categories: ['health', 'lifestyle', 'kids'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    // Dev only: Django's CSRF origin check needs Origin/Referer to match the upstream host.
    proxy: Object.fromEntries(
      proxyPaths.map((p) => [
        p,
        {
          target: p === '/bramble' ? companionUpstream : upstream,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (req) => {
              if (req.getHeader('origin')) req.setHeader('origin', upstream)
              if (req.getHeader('referer')) req.setHeader('referer', `${upstream}/`)
            })
          },
        } satisfies ProxyOptions,
      ]),
    ),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: { provider: 'v8', include: ['src/lib/**'], reporter: ['text'] },
  },
})
