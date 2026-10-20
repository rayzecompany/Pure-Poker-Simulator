# Pure Poker Sim

**A production of The Rayze Company.**

Texas Hold'em against characters from six TV comedies (Community, The Office, The Good Place, Parks and Recreation, Brooklyn Nine-Nine and Superstore), with a coach that only sees what you see. No-limit, pot-limit or fixed-limit; cash game or tournament; you plus 1 to 7 opponents. Every opponent plays strong, near-optimal poker; each character adds a small, flavorful tilt.

## Download

Get the latest build from [Releases](../../releases):

- **Windows:** `Pure-Poker-Sim-<version>-Windows.exe`. Double-click it; nothing to install. If SmartScreen warns, choose *More info → Run anyway* (the app isn't code-signed yet).
- **Mac (Intel and Apple Silicon):** `Pure-Poker-Sim-<version>-Mac.dmg`. Drag the app to Applications. The first time, right-click it and choose *Open* (it isn't notarized yet).

## Develop

- `npm install`, then `npm run dev` → http://localhost:5183
- `npm test`: rules engine, evaluator, fairness, preflop charts, bots, coach
- `npm run build`: `dist/index.html`, one self-contained file that also works by double-clicking
- `npm run app`: run the desktop app locally
- `npm run dist:win` / `npm run dist:mac`: package desktop builds into `release/`

## Releasing

Push a version tag that matches `package.json` (`git tag v1.0.0 && git push origin v1.0.0`). `.github/workflows/release.yml` tests, builds the Windows exe and the Mac dmg on GitHub's runners, and publishes them as a GitHub Release.

## Docs

`docs/FAIRNESS.md` (how dealing works and how it's verified), `docs/ARCHITECTURE.md` (how the code fits together), `docs/THEORY.md` (the poker theory the bots and coach follow).

## License and credits

Code: [MIT](LICENSE), © 2026 The Rayze Company.

- Font: [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans), SIL Open Font License 1.1 (`src/assets/fonts/PlusJakartaSans-OFL.txt`).
- Player avatars are drawn in code (`src/ui/avatars.js`); no photos are included.
- This is an unofficial fan project. Show and character names belong to their respective owners and are used only to describe each opponent's play style; it is not affiliated with or endorsed by them.
