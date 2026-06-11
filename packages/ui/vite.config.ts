import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',  // CRITICAL for file:// URL compatibility
  build: { outDir: 'dist' }
});
