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
    'process.env': {},
  },
  plugins: [
    react(),
    cloudflare(),
    tailwindcss(),
    // @solana/web3.js and the wallet adapters expect Buffer, global and process to exist. The
    // stream and fs shims that used to sit alongside these were for umi and the Irys uploader,
    // which this frontend does not use: transactions are built on the backend and signed here
    // with raw web3.js.
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: 'esnext',
  },
})