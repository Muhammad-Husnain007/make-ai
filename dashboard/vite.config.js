import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pulseApi = process.env.PULSE_API_ORIGIN || 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': pulseApi,
      '/ingest': pulseApi,
      '/health': pulseApi,
      '/queues': pulseApi,
      '/realtime': { target: pulseApi, ws: true },
    },
  },
  preview: {
    proxy: {
      '/api': pulseApi,
      '/ingest': pulseApi,
      '/health': pulseApi,
      '/queues': pulseApi,
      '/realtime': { target: pulseApi, ws: true },
    },
  },
});
