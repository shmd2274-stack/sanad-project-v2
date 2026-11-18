import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { nitro } from 'nitro/vite';

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tanstackStart({ server: { entry: 'server' } }),
    react(),
    tailwindcss(),
    // The embedded PostgreSQL (PGlite) loads .wasm/.data files next to its module, so ship the whole package.
    nitro({ preset: 'node-server', traceDeps: ['@electric-sql/pglite*'] }),
  ],
  resolve: { dedupe: ['react', 'react-dom', '@tanstack/react-router'] },
  server: { port: 3000 },
});
