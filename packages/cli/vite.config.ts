import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Bundles the CLI and the pure src/core modules it reuses into one Node ESM file. WXT never sees this folder:
// the extension build only reads src/ (wxt.config.ts srcDir), so nothing here can grow the extension bundle.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  logLevel: 'warn',
  build: {
    ssr: 'src/bin.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      external: [...builtinModules, /^node:/],
      output: { entryFileNames: 'rg.mjs', format: 'es', inlineDynamicImports: true },
    },
  },
  ssr: { noExternal: true },
});
