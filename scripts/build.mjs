import { build } from 'vite';

// Vercel bundles the root api/ functions separately from these static assets.
await build({ configFile: false, build: { outDir: 'dist/client', emptyOutDir: true } });
