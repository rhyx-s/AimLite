import { defineConfig } from 'vitest/config';

// Tauri loads the built files from dist/ (frontendDist). The dev server is only for `tauri dev`.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
