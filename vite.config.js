import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // relative paths so Electron can load dist/index.html from file://
  server: { port: 5173, strictPort: true },
});
