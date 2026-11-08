import { defineConfig } from 'vite';

// Relative base so the build works at https://<user>.github.io/room-to-stop/.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1000 },
  test: { include: ['tests/**/*.test.ts'] },
});
