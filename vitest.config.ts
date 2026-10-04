import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'url';
import path from 'path';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
      '@tests': path.join(root, 'tests'),
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './test/wrangler.toml' },
      miniflare: {
        bindings: { JWT_SECRET: 'test-secret' },
      },
    }),
  ],
});
