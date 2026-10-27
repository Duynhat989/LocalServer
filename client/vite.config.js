import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  root: path.resolve(__dirname),
  base: '/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:6868',
      '/health': 'http://127.0.0.1:6868',
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../views'),
    emptyOutDir: true,
    assetsDir: 'assets',
  },
});
