import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Caminhos relativos: o build funciona em qualquer subpasta (ex.: GitHub Pages).
  base: './',
  server: { port: 5173, host: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
