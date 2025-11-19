import path from "path"
import { fileURLToPath } from "url"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { cloudflare } from "@cloudflare/vite-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  define: {
    'process.env': {}
  },
  plugins: [
    react(),
    cloudflare(),
    tailwindcss(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      exclude: ['fs'],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "stream/promises": path.resolve(__dirname, "./src/polyfills/stream-promises.ts"),
      "readable-stream/promises": path.resolve(__dirname, "./src/polyfills/stream-promises.ts"),
      "stream": "stream-browserify",
      "fs": path.resolve(__dirname, "./src/polyfills/fs-polyfill.ts"),
    },
  },
  optimizeDeps: {
    include: ['@metaplex-foundation/umi', '@metaplex-foundation/umi-bundle-defaults', '@metaplex-foundation/mpl-core', '@metaplex-foundation/umi-uploader-irys', 'readable-stream', '@irys/bundles'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  build: {
    target: 'esnext',
  },
})