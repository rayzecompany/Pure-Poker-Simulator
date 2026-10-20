# Pure Poker Sim

## Rules
- Never push to GitHub (commits, tags or releases) without asking first. The repo is public.
- Keep code efficient, clean and simple. No overengineering; write code a senior engineer would be glad to maintain.
- Keep comments and docs short. Don't write long explanations of how systems work.
- Patch notes are barebones: a short list of what changed. No marketing copy.
- Bots must keep playing near-perfect, theory-based poker (`docs/THEORY.md`); check strength before and after any strategy change.

## Commands
- `npm run dev`: dev server on http://localhost:5183
- `npm test`: all tests (must pass before any commit)
- `npm run build`: single-file build in `dist/`

## Releasing
1. Bump `version` in `package.json` (and `npm install --package-lock-only`).
2. Write the patch notes in `RELEASE_NOTES.md`.
3. After the user approves, push `main`, then run Actions > Release > Run workflow with tag `v<version>`. It tests, builds the Windows exe and Mac dmg, and publishes the release.
