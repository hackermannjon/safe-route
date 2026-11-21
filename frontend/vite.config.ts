import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.API_PROXY_TARGET || 'http://127.0.0.1:8000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Listen on the LAN so the app can be tried from a phone or another machine.
      host: true,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
      },
    },
    build: {
      // MapLibre is most of the bundle and changes far less often than app code,
      // so it gets its own long-lived cached chunk. That chunk is ~1 MB minified and
      // can't be split further; it loads lazily with the map, after the form is usable.
      chunkSizeWarningLimit: 1100,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{ name: 'maplibre', test: /node_modules[\\/](maplibre-gl|@maplibre)[\\/]/ }],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: {
        // Stable class names let tests target CSS module classes without hashing noise.
        modules: { classNameStrategy: 'non-scoped' },
      },
      restoreMocks: true,
    },
  };
});
