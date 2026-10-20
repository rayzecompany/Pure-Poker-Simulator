# Fairness

Pure Poker Sim deals a real, fair game. Nobody, you or any opponent, gets better or worse cards than chance gives them, and every hand is ranked and named exactly.

## How cards are dealt

- One standard 52-card deck per hand, shuffled with Fisher–Yates using the system's cryptographic random number generator (Web Crypto `getRandomValues`, with rejection sampling so there is no modulo bias). Every one of the 52! deck orders is equally likely.
- Cards are dealt one at a time starting left of the button, with a burn card before the flop, turn and river, exactly as at a real table.
- Your seat is dealt by the same code as every opponent's. There is no difficulty setting, no "rigging", and no adjustment based on who is winning.
- Opponents never see your cards or the deck. Each bot decides from the same public view you have: its own two cards, the board, the bets and the stacks. Folded hands are never revealed.

## How it is verified

`npm test` runs `tests/fairness.test.js` on every build, alongside the rules-engine tests:

| Check | What it proves |
| --- | --- |
| All 2,598,960 five-card hands | The evaluator puts each hand in exactly the right category (40 straight flushes, 624 quads, 3,744 full houses ... 1,302,540 high cards). |
| 400,000 random seven-card hands | Each category appears at its true probability (e.g. pair 43.8%, flush 3.0%, full house 2.6%): hands are neither inflated nor deflated. |
| 26,000 shuffles | Every card is equally likely in every deck position. |
| 9,000 dealt hands at 6 players | Your hole cards follow the same distribution as every opponent's, including pocket pairs at 5.9%. |
| Live hand label | The "what you hold" readout always names the same hand as the evaluator. |

Before v1.0 an independent audit also ran: 220,000 six- and seven-card hands against a brute-force reference (no mismatches in score, ordering, name or best five cards); 750,000 hands through the real game engine at 2, 6 and 8 players (per-seat card frequencies, all 169 starting-hand classes, board cards and seven-card hand frequencies all matched theory, for you and for the bots); and 30,000 fuzzed hands with side pots and split pots (chip totals, pot eligibility, winners and odd chips all correct).
