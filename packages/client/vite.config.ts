import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4201,
    proxy: {
      '/ws': {
        target: 'ws://localhost:4200',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:4200',
      },
    },
  },
});
