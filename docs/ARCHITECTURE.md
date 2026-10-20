# Architecture

Vite + vanilla ES modules. `src/engine` and `src/strategy` have no DOM, so tests run them in Node.

```
src/engine/     cards, evaluator, positions, game (the rules)
src/strategy/   equity, range model, policy (one baseline for bots and coach), bot, coach, personalities, preflopCharts (range data)
src/ui/         screens, table, action bar, coach panel
src/main.js     game loop: drives bots on timers, wires events to the UI
electron/       desktop shell that loads dist/index.html
```

## Data

- Card: `"As"`, `"Td"` (rank `23456789TJQKA` + suit `cdhs`). Preflop class: `"AKs"`, `"AKo"`, `"QQ"`.
- Positions, 8-handed in preflop order: `UTG UTG1 LJ HJ CO BTN SB BB`. N players use the last N. Heads-up is `BTN` (posts SB) and `BB`.

## Engine (`src/engine/game.js`)

```js
const game = new Game({ players, betting: 'NL'|'PL'|'FL', structure: 'cash'|'tournament',
  smallBlind, bigBlind, ante, bigBlindAnte, startingStack, cash: { autoRebuyBots, rebuyTo },
  tournament: { handsPerLevel, levels: [{ sb, bb, ante }] }, seed });
game.startHand();
game.legalActions();  // { canFold, canCheck, callAmount, canBet, canRaise, minTo, maxTo, allInTo, pot, toCall }
game.act({ type: 'raise', to: 12 });  // `to` = street total; throws if illegal
game.viewFor('hero');  // state with hidden hole cards removed: the only thing bots and the coach see
game.on('action' | 'street' | 'handStart' | 'handEnd' | 'busted' | 'levelUp', fn);
game.history;  // last 200 hands, each with heroDecisions: [{ view, action }]
```

Listeners run synchronously. Never call `act()` inside one; use a timer.

Rules follow TDA / casino practice:
- Heads-up blinds.
- Full-raise reopening, where several short all-ins can add up to a full raise.
- Pot-limit max, sized as if short blinds were posted in full.
- Fixed-limit 4-bet cap. It is lifted heads-up in cash games and kept in tournaments.
- Dead antes and BB-ante.
- Side pots, with the odd chip going left of the button.
- Uncalled bets are returned.
- Showdown order and mucking. When betting is closed by an all-in, every hand is tabled.
- Tournaments use a moving button with no dead-button rule.

Unseeded games shuffle with Web Crypto (see `FAIRNESS.md`).

## Strategy

- `policy.analyze(view, params)` returns legal options with frequencies, plus the facts behind them. Preflop comes from the charts, postflop from texture, equity against the modeled ranges, MDF and SPR. Both bots and the coach use it.
- `bot.createBot(id)` samples from `analyze` with that character's small personality offsets (`personalities.js`).
- The coach has three entry points:
  - `adviseNow(view)` gives the recommendation, reasons and numbers.
  - `reviewHand(record)` grades every hero decision using only that decision's view.
  - `liveEquity(view)` and `describeHand(cards, board)` feed the table readout.
- `docs/THEORY.md` is the source for the numbers.

## Tests

`npm test` covers rules, the evaluator, fairness, preflop charts, bot theory spots, personalities and coach output. `node tests/strategySim.js [hands]` is a slower bot-strength check.
