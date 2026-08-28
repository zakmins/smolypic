import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  plugins: [react()],
  base: './', // relative paths so Electron can load dist/index.html from file://
  server: { port: 5173, strictPort: true },
  // Sidebar footer reads this — always matches package.json, no manual bump.
  define: { __APP_VERSION__: JSON.stringify(version) },
});
