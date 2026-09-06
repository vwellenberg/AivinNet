/* eslint-disable no-undef */
/// <reference types="vitest" />

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import svgLoader from "vite-svg-loader";
import { VitePWA } from "vite-plugin-pwa";
import viteCompression from "vite-plugin-compression";
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const path = require("path");
// Single source of truth for the brand/accent colours. Injected into SCSS below
// (so $brand-green / $brand-red derive from it) and imported in TS via
// pageGradient.ts. Change the colour here once and rebuild.
const brandColors = require("./src/brand-colors.json");

export default defineConfig({
  base: "./",
  plugins: [
    vue(),
    // Keep the viewBox on every SVG. SVGO's default `removeViewBox` strips it
    // when width/height attrs are present, which breaks CSS-resizing: without a
    // viewBox the icon renders at native coordinates and the SVG's own
    // overflow:hidden CROPS anything past the (smaller) CSS box — this clipped
    // the bottom of the shuffle/repeat glyphs in the bottom bar. Preserve it.
    svgLoader({
      svgoConfig: {
        plugins: [
          {
            name: "preset-default",
            params: { overrides: { removeViewBox: false } },
          },
        ],
      },
    }),
    VitePWA({
      // SERVICE WORKER DISABLED ON PURPOSE.
      // This is a self-hosted player on the LAN that we deploy to constantly.
      // A precaching service worker repeatedly served STALE assets: hard
      // refresh (Ctrl+Shift+R) and "clear cache" do NOT bypass a service
      // worker, so deployed fixes never reached the browser until the SW was
      // manually unregistered. skipWaiting/clientsClaim did not help because an
      // already-installed older SW kept waiting.
      // `selfDestroying` ships a SW whose only job is to unregister itself and
      // wipe the old caches. After it runs once, NO service worker controls the
      // page, so every deploy is visible on a normal reload. Do not re-enable
      // PWA caching here without a very good reason — see CLAUDE.md.
      selfDestroying: true,
      registerType: "autoUpdate",
      devOptions: {
        enabled: false,
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: "AivinNet",
        short_name: "AivinNet",
        description: "AivinNet — selbst-gehosteter Musik-Player",
        theme_color: brandColors.memphis.paper,
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          {
            name: "Playlists",
            description: "View your playlists",
            url: "/#/playlists",
            icons: [
              {
                src: "/icons/playlist.svg",
                type: "image/svg+xml",
              },
            ],
          },
          {
            name: "Favorites",
            description: "View your favorites",
            url: "/#/favorites",
            icons: [
              {
                src: "/icons/heart.svg",
                type: "image/svg+xml",
              },
            ],
          },
          // No "Settings" shortcut: settings are a MODAL, so there is no URL to
          // point one at. It used to target `/#/settings`, which is exactly the
          // page removed here — long-pressing the installed app's icon would
          // have opened a 404.
        ],
        start_url: "/",
        display: "standalone",
        background_color: brandColors.memphis.paper,
      },
    }),
    viteCompression({
      threshold: 150,
    }),
    nodePolyfills({
      include: ['crypto'],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        // Feed the brand + memphis colours from the single JSON source into
        // SCSS. These win over the `!default` fallbacks in _variables.scss
        // and _candy.scss. The $candy-* names are legacy aliases from the
        // candy design, re-pointed at memphis roles (see _candy.scss).
        additionalData:
          `$brand-green: ${brandColors.green}; $brand-red: ${brandColors.red}; ` +
          `$mem-ink: ${brandColors.memphis.ink}; $mem-paper: ${brandColors.memphis.paper}; ` +
          `$mem-panel: ${brandColors.memphis.panel}; $mem-teal: ${brandColors.memphis.teal}; ` +
          `$mem-yellow: ${brandColors.memphis.yellow}; $mem-coral: ${brandColors.memphis.coral}; ` +
          `$mem-lavender: ${brandColors.memphis.lavender}; $mem-pink: ${brandColors.memphis.pink}; ` +
          `$mem-blue: ${brandColors.memphis.blue}; ` +
          `$mem-blush: ${brandColors.memphis.blush}; $mem-blush-soft: ${brandColors.memphis.blushSoft}; ` +
          `$mem-text-muted: ${brandColors.memphis.textMuted}; ` +
          `$mem-dark-ground: ${brandColors.memphisDark.ground}; ` +
          `$mem-dark-panel: ${brandColors.memphisDark.panel}; ` +
          `$mem-dark-soft: ${brandColors.memphisDark.soft}; ` +
          `$mem-dark-line: ${brandColors.memphisDark.line}; ` +
          `$mem-dark-text: ${brandColors.memphisDark.text}; ` +
          `$mem-dark-text-muted: ${brandColors.memphisDark.textMuted}; ` +
          `$mem-dark-content-text: ${brandColors.memphisDark.contentText}; ` +
          `$mem-dark-content-muted: ${brandColors.memphisDark.contentMuted}; ` +
          `$mem-dark-grid-line: ${brandColors.memphisDark.gridLine}; ` +
          `$candy-pink: ${brandColors.memphis.blush}; $candy-pink-soft: ${brandColors.memphis.blushSoft}; ` +
          `$candy-pink-deep: ${brandColors.memphis.yellow}; $candy-white: ${brandColors.memphis.panel}; ` +
          `$candy-lavender: ${brandColors.memphis.lavender}; $candy-black: ${brandColors.memphis.ink}; ` +
          `$candy-text-muted: ${brandColors.memphis.textMuted}; ` +
          `@import "@/assets/scss/_variables.scss", "@/assets/scss/_mixins.scss", "@/assets/scss/_candy.scss", "@/assets/scss/_motion.scss", "@/assets/scss/Global/_buttons.scss";`,
      },
    },
  },
  build: {
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1500,
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
