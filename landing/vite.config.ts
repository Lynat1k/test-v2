import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// ProCluster landing — served from the root of procluster.online.
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
  },
  build: {
    outDir: 'dist',
  },
});
