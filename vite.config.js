import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` makes dist/index.html: one self-contained file you can double-click.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { assetsInlineLimit: 100_000_000 },
});
