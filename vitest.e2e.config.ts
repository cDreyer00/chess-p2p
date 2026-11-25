import { defineConfig } from 'vitest/config';

// Teste de rede real (broker PeerJS + WebRTC via node-datachannel). Precisa de internet.
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    sequence: { concurrent: false },
  },
});
