import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_SERVER_URL || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});

