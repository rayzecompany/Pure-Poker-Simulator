import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

// `npm run build` makes dist/index.html: one self-contained file you can double-click.
export default defineConfig({
  plugins: [viteSingleFile()],
  define: { __VERSION__: JSON.stringify(version) },
  build: { assetsInlineLimit: 100_000_000 },
});
