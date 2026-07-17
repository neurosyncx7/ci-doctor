import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: __dirname,
  base: process.env.DASHBOARD_PUBLIC_BASE ?? '/',
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: {
    host: '127.0.0.1', port: 4311, strictPort: true,
    allowedHosts: ['copies-opinions-post-hours.trycloudflare.com'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4300',
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  build: { outDir: 'dist', emptyOutDir: true }
});
