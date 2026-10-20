# Poker theory reference

The strategy the bots play and the coach teaches. The table rules are summarized in `ARCHITECTURE.md`. Numbers are solver-era approximations cross-checked across GTO Wizard blog articles, TDA rules (2024 edition text via pokertda.com), Robert's Rules of Poker (Ciaffone, via Card Player), HoldemResources heads-up Nash charts, Upswing/PokerCoaching-style charts and general solver aggregates. They are **anchors, not exact solver outputs**: solver frequencies move with stack depth, rake and the sizes allowed.

Units: `bb` = big blinds. "Pot" = pot before the bet. Hand classes like `AKs`, `AKo`, `TT`.

---

## 1. Core math the coach uses everywhere

| Bet size (fraction of pot) | Caller's pot odds (equity needed) | MDF (defend at least) | Alpha (bluff needs folds) | River bluff share of betting range | Value : bluff |
|---|---|---|---|---|---|
| 25% | 16.7% | 80% | 20% | 16.7% | 5 : 1 |
| 33% | 20% | 75% | 25% | 20% | 4 : 1 |
| 50% | 25% | 67% | 33% | 25% | 3 : 1 |
| 66% | 28.6% | 60% | 40% | 28.6% | 2.5 : 1 |
| 75% | 30% | 57% | 43% | 30% | 2.3 : 1 |
| 100% | 33% | 50% | 50% | 33% | 2 : 1 |
| 150% | 37.5% | 40% | 60% | 37.5% | 1.67 : 1 |
| 200% | 40% | 33% | 67% | 40% | 1.5 : 1 |

Formulas (b = bet / pot):
- **Pot odds / required equity** = call / (pot + bet + call) = b / (1 + 2b).
- **Alpha** (how often a pure bluff must work) = b / (1 + b). **MDF** = 1 − alpha = 1 / (1 + b).
- **Optimal river bluff share** of the betting range = b / (1 + 2b) (it equals the caller's pot odds, so bluff-catchers become indifferent).
- **Caveats (GTO Wizard):** MDF assumes the bettor's bluffs have zero equity. Earlier streets have equity in "bluffs", so defenders correctly **fold more than MDF** on the flop and turn (BB over-folds vs c-bets in solver outputs). MDF does not apply vs raises the same way. MDF is a sanity check for the river and for spotting huge over-folding, not a target.
- **EV of a call** = equity × (final pot) − call. **EV of a bluff** = fold% × pot − (1 − fold%) × bet (ignoring equity when called).

**Outs → equity** (unseen cards: 47 on the flop, 46 on the turn):
- One card to come: outs × 2 (+1 or 2 for 10+ outs). Exact: outs/46 on the turn, outs/47 on the flop.
- Two cards (flop all-in to the river): outs × 4, but **subtract (outs − 8) when outs > 8**. Exact: 4 outs 16.5%, 8 outs 31.5%, 9 outs 35%, 12 outs 45%, 15 outs 54%.
- Common outs: flush draw 9; open-ender 8; gutshot 4; double gutter 8; flush + open-ender 15; flush + gutshot 12; two overcards 6 (discount to ~3–4 since pairing may not win); pair + flush draw ~14; set → full house or better on the next card 7 (10 on the river).
- **Discount outs** that complete a better hand for villain (e.g. a flush card that pairs the board, low-end straights, the 4th flush card when you hold a low flush draw).

**Implied odds:** call a draw without direct odds only if you expect to win extra later: needed future winnings ≈ (call / equity) − (pot + call). These matter deep and in position, and when the draw is disguised. They are small when stacks are short (SPR < 3), multiway on scary boards, or when the draw is obvious (four-flush). **Reverse implied odds:** dominated hands (weak kickers, low flushes, bottom-end straights) win small pots and lose big ones. Prefer to keep pots small with them.

**SPR (stack-to-pot ratio)** = effective stack / pot at the start of the flop.
- SPR < 2: commit with top pair or any strong draw. Bet/jam, rarely fold.
- SPR 2–4 (3-bet pots): top pair good kicker and overpairs usually play for stacks.
- SPR 4–10: one pair (even top pair) is usually a 1–2 street value hand; two pair+ plays for stacks.
- SPR > 10: stack off mainly with two pair+, sets, nut draws. One pair should mostly control the pot.
- Single-raised pot at 100bb heads-up (BTN 2.5 vs BB): pot 5.5bb, SPR ≈ 17.7. 3-bet pot: pot ≈ 20–23bb, SPR ≈ 3.5–4.5. 4-bet pot: SPR < 1.5.

---

## 2. Preflop

### 2.1 Open-raise (RFI) by position and depth
Charts are in `src/strategy/preflopCharts.js` (`RFI`). Measured widths of the authored charts:

| Depth | UTG | UTG1 | LJ | HJ | CO | BTN | SB |
|---|---|---|---|---|---|---|---|
| 100bb cash (2.5bb, SB 3bb) | 12.9% | 15.0% | 18.3% | 22.4% | 29.2% | 44.0% | 40.6% raise, no limps |
| 40bb MTT w/ ante (2.2bb) | 17.0% | 19.3% | 22.6% | 27.0% | 32.7% | 49.2% | 18.3% raise + 34.2% limp |
| 25bb MTT w/ ante (2bb) | 16.6% | 18.5% | 21.6% | 25.8% | 32.1% | 49.6% | 14.5% raise + 43.9% limp |
| Fixed limit | 11.9% | 14.9% | 19.1% | 23.8% | 32.4% | 44.8% | 51.4% |

Principles:
- **Sizing:** 100bb cash: 2.5bb from all seats except SB 3bb (2.2–2.5 BTN also fine). 40bb with antes: 2.2bb. 25bb: 2.0bb. **Add +1bb per limper** (iso-raise: 3bb IP / 4bb OOP base, +1 per limper). Never min-raise 100bb deep from early position just because it's cheap.
- **Early position (8-handed UTG ~13%)**: pairs 66+, all suited aces, suited broadways, AJo+, KQo. Tight because 7 players are behind.
- **Antes widen everything** (more dead money): late positions open ~5–10% wider with antes, and the BB defends much wider.
- **Shorter stacks** drop the weakest suited connectors and small pairs from early position (less implied odds) and add more offsuit broadways / Ax (play well all-in).
- **SB strategy.** Cash 100bb: mostly **raise-or-fold** to ~3bb (~40%). Tournaments with antes: **mixed limp/raise** (limp ~35–45% of hands, raise ~15–20% with strong and some polar hands), because the price is great and the SB is out of position. ≤15bb: open-shove or limp; see push/fold.
- **Limpers ahead (multiway):** iso-raise tighter and bigger (top ~10–20% from late, linear: pairs, Ax suited, broadways), overlimp suited connectors/small pairs from the BTN/SB at times, and check the BB option with weak hands.

### 2.2 Facing an open (`VS_RFI`)
- **IP cold-callers (UTG1–CO) are mostly 3-bet-or-fold**, with small flatting ranges (pairs 77–JJ, AQs/AJs/KQs). **BTN flats more** (it has position for sure): small pairs, suited connectors, suited broadways. **SB is mostly 3-bet-or-fold** (OOP to the opener and the BB behind).
- **BB defends the widest** because it closes the action and already has 1bb in. Measured authored widths (3-bet + call): 100bb vs UTG ~23%, vs HJ ~30%, vs CO ~47%, vs BTN ~62%, vs SB ~53%. At 40bb with antes vs BTN ~72%. (Solver cash numbers with rake run ~5% tighter. The sim has no rake.)
- **3-bet ranges:** vs early opens fairly **linear-tight** (QQ+, AK, AQs, plus A5s/A4s blockers as bluffs). vs late opens **polarized-ish**: value (TT+, AQ+, AJs, KQs) + suited bluffs with blockers or playability (A5s–A2s, K9s, Q9s, J9s, T8s, 76s, 65s) + some offsuit broadways.
- **3-bet sizing:** IP **3× the open** (2.5 → 7.5bb); OOP **4×** (SB/BB vs 2.5 → 10–11bb). Add +1 open size per caller already in (squeeze). At 25bb and below, a 3-bet is usually an **all-in**.
- **Squeeze** (3-bet after an open and a call): the caller's range is capped, so squeeze more polar and bigger (4–5× the open, +1× per caller). Value hands that like isolating (QQ+, AK) plus suited blockers (A5s, KJs). Cold-call less when there's a squeeze risk behind.
- **Multiway adjustments:** with more players already in, play tighter and value-heavier (fewer pure bluffs), and prefer hands that make nuts (suited, pairs).
- **Heads-up:** BTN opens ~80–86% at 2–2.5bb (100bb). BB defends ~70–75% vs 2.5bb (3-bets ~15%). Ranges are in `HU`.

### 2.3 Facing a 3-bet (`VS_3BET`) and 4-bet (`VS_4BET`)
- The opener continues roughly **40–55% of its opening range** vs a standard 3-bet at 100bb. It continues more when IP and when the 3-bettor is a late position/blind with a wide range.
- **4-bet sizing:** IP ~2.2× the 3-bet, OOP ~2.5×. At ≤40bb, a 4-bet is all-in.
- **4-bet ranges:** value KK+/AK (QQ mixed vs tight 3-bettors), bluffs with ace blockers (A5s–A3s) and some Kx suited. **Call 3-bets IP** with pairs, suited broadways, and suited connectors deep. **Call less OOP.**
- **Facing a 4-bet (100bb):** jam (5-bet) KK+, AKs, some QQ/AKo and rare A5s bluffs; call QQ–TT, AK, some AQs/A5s. At 40bb and below: jam or fold, plus call off when the 4-bet is already all-in.
- **Dominated offsuit hands (KJo, QJo, ATo) are the classic folds vs 3-bets.**

### 2.4 Push/fold and short stacks (`PUSH`, `CALL_PUSH`)
- **Use push/fold at ≤ ~12–15bb effective** (tables go to 20bb). Between 15–25bb, open small (2bb) or shove from late position. Reshove (3-bet all-in) over late opens with pairs, Ax and broadways.
- `PUSH[pos][hand]` = the max stack (bb) at which open-shoving is +chip-EV with a BB-ante of 1bb. Measured widths: 10bb: UTG 14.8%, UTG1 17.9%, LJ 21.9%, HJ 28.2%, CO 32.1%, BTN 43.9%, SB 72.5%. 20bb: UTG 6%, BTN 33%, SB 54%.
- `CALL_PUSH.BB[shover]`: BB calling widths at 10bb: vs UTG 19%, vs CO 30%, vs BTN 35%, vs SB 53%. **Calling ranges are tighter than shoving ranges** (no fold equity): only the shover gets the "everyone folds" bonus.
- Antes widen both. Without antes, ranges are ~15–25% narrower (relative).
- These are **chip-EV**. Near the money / final table, apply ICM (2.6).

### 2.5 Fixed-limit preflop
- **Raise or fold** when first in. Cold-calling is rare (3-bet or fold) except BTN/BB.
- **BB defends very wide** (gets ~3.5:1 vs a raise and closes the action): ~55–60% vs late opens.
- 3-bets are **value/linear** (you can't price out draws), and they're used to isolate.

### 2.5b Pot-limit preflop
- Max open = **pot: 3.5bb** (call 1 + pot 2.5 → raise to 3.5bb). Typical opens are 2.5–3bb. Max 3-bet over a 3bb open with blinds in = 3 + (3 + 3 + 1.5) = 10.5bb.
- Getting stacks in at 100bb needs 4-bet/5-bet or several streets, so **pot geometry matters**: plan to get it in over 2–3 streets with strong hands.

### 2.6 Tournament specifics
- **Antes:** more dead money. Open wider (especially BTN/SB), defend the BB much wider, 3-bet a bit wider.
- **Stack-depth plan:** 40bb: normal poker, 2.2bb opens, 3-bet 2.8–3×, 4-bet = jam. 25bb: 2bb opens, 3-bet = jam with many hands, flat less. 15–20bb: open-jam ranges appear from late positions. ≤12bb: push/fold.
- **ICM (simple model):** near the bubble and at final tables, chips lost are worth more than chips won. Use a **risk premium**: a call that needs X% equity in chip EV needs roughly X% + 5–10% (bubble, medium stacks) or more (final-table pay jumps). In practice: **tighten calling ranges much more than shoving ranges**; big stacks shove/open wider vs medium stacks; medium stacks avoid confrontations with big stacks; short stacks shove a bit tighter only if other short stacks are about to bust.
- A simple "bubble factor" for the coach: BF ≈ 1.2–1.5 on the bubble for medium stacks. Required equity for a call = BF × risk / (BF × risk + reward).

---

## 3. Postflop

### 3.1 Range advantage vs nut advantage
- **Range advantage** = higher average equity. **Nut advantage** = more of the very strongest hands (sets, two pair, straights).
- Range advantage + no strong opposing nut share → **bet often, small** (25–33%), e.g. BTN on A-K-x dry, K-Q-6r, paired boards.
- Nut advantage (polar, opponent capped) → **bet bigger, less often** (66–125%), e.g. K-4-3 from UTG vs BTN (UTG has KK/AK/sets more), turns that complete your draws but not theirs, rivers after the opponent's check-call capped their range.
- The preflop caller wins **middling/low connected boards** (9-8-7, 7-6-5, 6-5-4): the PFR checks a lot there.
- The biggest driver of postflop strategy is the preflop action (whose range is strong). Texture comes second (GTO Wizard).

### 3.2 Flop c-bets (heads-up, single-raised pot, 100bb)

| Spot | Board | Frequency | Size |
|---|---|---|---|
| IP PFR (BTN/CO vs BB) | A-high or K-high dry (A72r, K83r) | 75–90% | 25–33% |
| IP PFR | Paired (K-K-5, 8-8-3), high pair especially | 70–85% | 25–33% |
| IP PFR | Broadway-heavy (KQJ, QJT) | 45–60% | 33–50%, some 75% |
| IP PFR | Two-tone middling/connected (9-8-6tt, J-T-7) | 35–50% | 50–75% (polar) |
| IP PFR | Low connected (7-6-5, 6-5-4) | 30–45% | 50–75% |
| IP PFR | Monotone | 35–50% | 25–33% (small) |
| IP PFR | Low, disconnected (8-4-2r, 2/3-high) | 55–75% | 33% |
| OOP PFR (UTG/HJ vs BTN caller) | Overall | ~30–45% | mostly 50–75% |
| OOP PFR | High card + range edge (K-Q-6r, A-A-K) | 70–100% | 33% |
| OOP PFR | K-4-3r type (PFR has more Kx/sets) | high | 66% |
| OOP PFR | Middling (Q-9-6r, T-9-x, 4-3-2) | check nearly everything | – |
| SB vs BB (SB raised) | Most boards | 55–70% | 33% |
| 3-bet pot, IP 3-bettor/PFR | Most boards | 60–80% | 25–33% |
| 3-bet pot, OOP 3-bettor | A/K-high | 60–75% | 25–33% |
| 3-bet pot, OOP 3-bettor | Low connected | 30–45% | 33–50% |

GTO Wizard aggregates: rainbow boards get bet most; two-tone a little less often and slightly more polar; monotone much less often and smaller. Paired boards get bet more often but small. Medium connected boards are the worst c-bet boards. Ace-high boards are bet slightly less than K/Q-high boards from the BTN (the BB has many Ax hands).

**Multiway (3+ players): c-bet far less** (~20–35% with two callers). Bet mostly for value and strong draws, sized 50–75%. Almost no pure air. Each extra opponent sharply reduces fold equity.

### 3.3 Defending vs c-bets
- vs 33% (MDF 75%): BB vs BTN continues ~60–70% (calls a lot: any pair, gutshots, overcards with backdoors, ace-high on low boards).
- vs 66–75% (MDF 57–60%): continue ~45–55%. Fold weak no-equity hands.
- **Check-raise (BB vs IP c-bet):** ~8–15% overall. More on low/connected boards (12–20%) where BB has sets/two pair/straights. Less on A-high/K-high dry boards (5–8%). Low on monotone boards. Size ~3–3.5× a small c-bet, ~2.5× a big one. Value: two pair+, sets, strong draws (combo draws, nut flush draws). Bluffs: gutshots + backdoors, weak draws with overcards.
- **Raise IP (vs a donk or an OOP c-bet):** similar logic, a bit less often.
- **Float:** call IP with backdoors/overcards, planning to bet when checked to (or to bluff good turn cards).

### 3.4 Turn and river
- **Barrel turns that are good for your range:** overcards to the board that favor the PFR (A, K on low boards), cards that complete your draws, blanks that keep you ahead. **Slow down** on cards that hit the caller (low connected cards, the flush card when you're short of flushes, board pairs that make their trips/boats more often).
- Turn barrel frequency after a flop c-bet: ~45–60% (lower after a small range bet). Size 66–75%. **Overbet 125–150%** when you hold the nuts more often and their range is capped.
- **Delayed c-bet:** PFR checks back flop IP, OOP checks turn → bet ~50–60% at 50–75%.
- **Probe:** IP PFR checked back the flop → OOP leads turn ~40–60%. IP's checking range is weak.
- **Donk bets** (OOP caller leading into the PFR): rare at equilibrium (0–10% on most flops). More common on turns/rivers that strongly favor the caller.
- **River:** bet **polar** (strong value + bluffs) at the value:bluff ratio for the size. Thin value with medium strength when the opponent's calling range is wide and worse. **Bluff with hands that can't win at showdown, that block their calls and unblock their folds** (e.g. missed draws, with the nut-flush blocker when the flush got there). **Bluff-catch** with hands that block their value and unblock their bluffs.
- **Overbets (150–200%+):** on rivers when you have the nuts often and their range is capped (they checked or called twice with medium hands). Bluff with the most blocker-heavy misses. Defenders should call with the best bluff-catchers at roughly MDF (33–40%).

### 3.5 Polarized vs merged (linear)
- **Polarized** = nuts + bluffs, few medium hands. Used with big sizes, on rivers, and when you have a nut advantage.
- **Merged/linear** = strong + medium + some draws. Used with small sizes, when the opponent's calling range is wide/weak (calls with worse), and multiway.
- Small bets → merged, high frequency. Big bets → polar, lower frequency.

### 3.6 Slowplaying and trapping
- Slowplay when: the board is dry (few draws to give free cards), you block their continuing range (e.g. top set on A-7-2 blocks Ax), or your betting range is better served by checking. **Don't slowplay** on wet boards or multiway.
- Check-raise or check-call strong hands sometimes so your checking range isn't weak (protects the checking range).

### 3.7 Multiway
- Bluff much less. Value-bet tighter (need stronger hands since someone is more likely to have it). Draws gain value (more callers = better implied odds). Pot control with one pair.
- In a 3-way pot, needed fold equity multiplies: a bluff must get through two players.

---

## 4. Fixed-limit specifics
- **Pots are big relative to bets**, so callers get great odds: on the river with 10 big bets in the pot, you need ~8% equity to call one bet. **Fold far less** than in NL, especially on the river with any bluff-catcher that beats a bluff.
- **Raise/check-raise for value and protection.** Charging draws matters, since they can't be priced out with big sizes.
- **Turn = big-bet street.** Decisions with marginal hands happen there. Free-card play: raise the flop IP (small bet) with a draw, then check the turn when checked to (saves a big bet).
- **Bluffing:** works best on the flop/turn as semi-bluffs. Pure river bluffs need to work only 1/(pot/bet + 1) of the time, but callers know this and call a lot.
- **Cap dynamics:** with the nuts, keep raising to the cap. Heads-up in cash it's uncapped (raise war with the nuts).
- **Slowplay less.** Bets are fixed, so you can't win a big pot later by trapping.
- **Preflop:** raise or fold first-in. 3-bet to isolate. BB defends very wide.

## 5. Pot-limit specifics
- Max bet = pot. You can't overbet, so polarization caps at pot-size bets, and stacks take 2–3 streets to get in at 100bb.
- Plan bet sizes so the river bet is a pot-or-less shove (**geometric sizing**: 3 equal-fraction bets to get stacks in from SPR ~13 are ~pot each).
- Draws are more playable (no shove to price them out). Strong hands should start building the pot early.
- 4-bets are pot-limited: a 4-bet preflop at 100bb is ~25–30bb, which leaves a lot behind.

---

## 6. Common beginner mistakes (coach should catch)

| Mistake | Correct reasoning |
|---|---|
| Open-limping | Raising wins the blinds often, takes initiative and builds a pot you're ahead in. Limp only SB in tournaments (mixed strategy). |
| Playing too many hands early / out of position | 7 players behind: UTG opens ~13%. Position lets you realize equity. |
| Calling too much preflop OOP | SB should 3-bet or fold. Flatting OOP with dominated offsuit hands loses. |
| Overvaluing weak aces / KJo / QJo vs raises | These are dominated by the 3-bettor/opener's range (AK, AQ, KQ). |
| Not defending the BB enough | You have 1bb in and close the action: defend ~60%+ vs BTN 2.5x. |
| Over-defending vs early-position opens | UTG range is strong: defend ~23% from the BB vs UTG at 100bb. |
| Auto c-betting every flop | C-bet depends on range/nut advantage. Check middling connected boards OOP. C-bet far less multiway. |
| Bluffing multiway / vs calling stations | Each opponent must fold. Value-bet thinner instead. |
| Chasing draws without odds | Compare equity to pot odds. 9-outer on the turn = ~20% (needs ≤ ~1/4-pot bets without implied odds). |
| Slowplaying on wet boards | Gives free cards. Bet for value and protection. |
| Min-raising / tiny bets with strong hands | Size by what worse hands call: usually 50–75% postflop. |
| Calling river raises/overbets with one pair | Those lines are polarized and value-heavy at most stakes. Check blockers and MDF only after accounting for their range. |
| Ignoring stack depth | Play changes with SPR and with tournament stacks: push/fold ≤ 12–15bb. |
| Calling all-ins as wide as you'd shove | Calling needs more equity than shoving (no fold equity). |
| Results-oriented thinking | Judge the decision by the information and odds at the time, not by the cards that came. |
| Fancy plays / level-hopping | Solid fundamentals beat creative lines. Reserve bluffs for good blockers and good cards. |
| Tilt after a bad beat | Variance is normal: AA loses to KK ~18% of the time. |

---

## 7. Glossary (plain English)
- **VPIP** (voluntarily put money in pot): % of hands a player calls or raises preflop (blind posts don't count). Solid 8-max ~20–25%.
- **PFR** (preflop raise): % of hands raised preflop. Solid players' PFR is close to their VPIP.
- **RFI** (raise first in): opening raise when everyone before you folded.
- **3-bet / 4-bet / 5-bet:** the re-raise after a raise (the blind counts as the first bet, the open is the 2nd).
- **Squeeze:** a 3-bet after an open and one or more callers.
- **Iso-raise:** raising over a limper to play heads-up with them.
- **C-bet** (continuation bet): the preflop raiser bets the next street.
- **Donk bet:** an out-of-position player leads into the previous street's aggressor.
- **Probe bet:** OOP bets the turn after the IP aggressor checked back the flop.
- **Delayed c-bet:** the preflop raiser checks the flop, then bets the turn.
- **Float:** call a bet (often IP) with a weak hand, planning to take the pot away later.
- **Check-raise:** check, then raise when the opponent bets.
- **Value bet:** bet hoping worse hands call. **Thin value:** a value bet with a hand only slightly ahead of the calling range.
- **Bluff:** bet with a hand that wins mainly when they fold. **Semi-bluff:** a bluff with a draw that can improve.
- **Slowplay:** play a strong hand passively to trap.
- **Equity:** your share of the pot if all cards were dealt out now (win % + half of ties).
- **Pot odds:** price of a call: call / (pot after you call). Call when equity > pot odds (ignoring future betting).
- **Implied odds:** extra money you expect to win after hitting. **Reverse implied odds:** extra money you lose when you hit but are still behind.
- **Outs:** unseen cards that improve you to (probably) the best hand.
- **SPR:** stack-to-pot ratio on the flop. It tells you how committed you are.
- **MDF** (minimum defense frequency): how often you must continue vs a bet so pure bluffs don't auto-profit: 1/(1 + bet/pot).
- **Alpha:** how often a bluff must work to break even: bet/(pot + bet).
- **IP / OOP:** in position (act last) / out of position (act first).
- **Range:** all the hands a player could have given their actions, with frequencies.
- **Range advantage / nut advantage:** more equity overall / more of the very best hands.
- **Polarized:** range of very strong hands and bluffs, few medium hands. **Merged/linear:** strong + medium hands. **Capped:** range that rarely contains the strongest hands (because they'd have raised earlier).
- **Blockers:** cards in your hand that make certain opponent hands impossible or less likely (holding the A♠ blocks the nut spade flush).
- **Bluff-catcher:** a hand that beats only bluffs.
- **Protection:** betting to make draws pay or fold.
- **Overbet:** a bet larger than the pot.
- **Geometric sizing:** equal-fraction bets that get stacks in exactly by the river.
- **GTO / solver:** game-theory-optimal (unexploitable) strategy, as approximated by software.
- **ICM:** Independent Chip Model, a way to convert tournament chips into prize-money value. Losing chips hurts more than winning helps near pay jumps.
- **Push/fold (shove/fold):** short-stack strategy of only going all-in or folding preflop.
- **Effective stack:** the smaller of the two stacks in a confrontation (what's actually at risk).
- **Dead money:** chips in the pot from players no longer contesting it (antes, folded blinds).
- **Showdown value:** a hand that can win without betting.

---

## 8. Implementation heuristics (encode these)

### 8.1 Using `preflopCharts.js`
- **Depth bucket:** effective stack `eff` in bb (vs the players still to act/relevant opponent). `eff >= 60 → 100`; `40 <= eff < 60 → 40`; `eff < 40 → 25`. If `eff <= 15` and folded to you (or facing one all-in), use `PUSH`/`CALL_PUSH` instead of RFI. Cash has no antes but uses the 100 bucket. **Short cash stacks use the 40/25 charts**, which assume antes: slight overplay, acceptable.
- **Position at short tables:** use the canonical keys as given (6-handed first to act = `LJ`). **Heads-up:** use `HU.BTN_RFI`, `HU.BB_VS_BTN`, `HU.BTN_VS_3BET` (BTN = SB), and `PUSH.SB` / `CALL_PUSH.BB.SB` for short stacks.
- **Mixed frequencies:** draw `rng() < freq` per decision. When a hand is in both maps (3-bet 0.4, call 0.5), roll once: `r < raise ? raise : r < raise + call ? call : fold`.
- **Sizes:** `SIZING.open[depth][pos] ?? SIZING.open[depth].default`, +`limpAdd` per limper. 3-bet = open × `threeBet.IP|OOP` (+1× open per caller); 4-bet = 3-bet × `fourBet.IP|OOP`. If the raise would commit > ~40% of the stack, jam instead.
- **Facing a limp (no chart):** iso-raise the top ~15% from MP, ~25% from CO/BTN, ~30% from SB (use the RFI chart of a seat 2 positions earlier as the iso range). BB checks the rest. BB vs SB limp: raise ~35% (strong + some bluffs) to ~3.5bb, check the rest.
- **Multiway preflop (open + caller(s)):** squeeze with the `VS_RFI` 3-bet map vs the opener but drop its lowest-frequency bluffs (×0.5), and call only the top half of the call map.
- **FL:** `FL.RFI`, `FL.VS_RFI[hero]` (assumes a typical open; vs UTG tighten by moving down to the EP map), `FL.BB_DEFEND`.

### 8.2 Postflop decision skeleton for bots
1. Build villain range(s) (8.4), compute hero equity vs range (Monte Carlo, 500–2000 iterations), plus **hand class**: nuts/very strong (top ~10% of hero's range on this board), strong, medium (showdown value), draw (≥8 outs or ≥ 25% equity), air.
2. **As bettor:** pick size by texture (table 3.2) and SPR. Value-bet hands with > ~55–60% equity vs the *calling* range. Add bluffs to reach the value:bluff ratio (table 1), choosing draws first, then blocker hands. Check medium-strength hands mostly.
3. **Facing a bet:** continue if equity ≥ pot odds − implied-odds bonus (draws IP deep: −3 to −8%). On the river, use pure pot odds with no bonus. Defend at least ~MDF − 10% on the flop and ~MDF on the river, choosing the best hands by equity + blockers. Raise the top ~⅓ of continues (value) + some strong draws (bluff-raises).
4. **Multiway:** cut bluff frequency by ~60–70%. Require ~10% more equity to value-bet.
5. **Mix:** never deterministic. Add ±5–10% noise to thresholds. Personalities shift these thresholds slightly (contract).

Concrete encodable rules:
- Flop c-bet IP, dry A/K-high or paired boards: **75–90% at 25–33%**. Wet middling/low connected: **35–50% at 66–75%**. Monotone: **35–50% at 25–33%**. OOP PFR: halve those frequencies and check range on middling boards.
- 3-bet pots: c-bet **25–33% pot** at high frequency on A/K-high boards.
- Turn barrel ~50% of flop bets at 66–75%. Overbet 125% only with nut advantage + capped villain.
- River sizes: 66–75% default, 125–200% with the nuts vs a capped range, 33% thin value.
- Check-raise BB vs c-bet: **~10%** (low connected boards 15–20%, A/K-high dry 5%). Size 3× the bet.
- Donk: ≤ 5% (mostly on turns that favor the caller).
- SPR < 2: get it in with top pair+ or 12+ outs. SPR > 10: one pair = pot control.

### 8.3 Coach checks (flag as "mistake" if clearly outside)
- Preflop: compare the action to the chart for the spot. If the chart frequency for the chosen action is 0 and for another action ≥ 0.7 → **mistake**; if mixed (≥ 0.2 for the chosen action) → **good/okay**.
- Calling with equity < pot odds − 5% (no implied odds, river) → mistake. 5% margin → okay.
- Folding with equity > pot odds + 10% (and no reverse-implied-odds problem) → mistake.
- Bluffing into 2+ opponents with air → usually mistake. Slowplaying on a wet board multiway → okay/mistake.
- Bet size far off the texture/value norm (e.g. 15% or 300% without a reason) → okay with an explanation.
- **Never judge by the result.** Only the information at the time.

### 8.4 Modeling an opponent's range from actions
1. **Start preflop** from the chart for their action: opened from X → `RFI[d][X]`; called an open → `VS_RFI[...].call`; 3-bet → `.threeBet`; limped → SB_LIMP or a loose/weak range (pairs, suited, offsuit broadways minus the raising range); BB checked option → everything not in a BB raise range. Multiply by frequencies. Expand classes into combos, then **remove known cards** (hero's hole cards + board).
2. **Each postflop action re-weights combos** (Bayes): weight × P(action | combo). Practical approximations by hand category on that board:
   - **Bet/raise big (≥ 66% pot):** strong (×1.0), strong draws (×0.8), medium made hands (×0.2), weak/air (×0.3 flop, ×0.25 river: these are the bluffs), weak showdown value (×0.1).
   - **Bet small (≤ 40%):** strong (×0.8), medium (×0.7), draws (×0.6), air (×0.5). Small-bet ranges are wide.
   - **Check (as PFR):** strong (×0.3), medium (×0.8), draws (×0.6), air (×0.6).
   - **Call:** strong (×0.4, rest raised), medium (×1), draws (×1), air (×0.1 flop, ~0 river).
   - **Check-raise / raise:** strong (×1), strong draws (×0.7), medium (×0.05), air (×0.15).
   - **River call:** remove most air and draws (missed draws fold).
3. Easiest consistent method: **use the bot's own policy** as the likelihood: weight × (probability our baseline bot would take that action with that combo). Bots and coach then model each other consistently.
4. **Sizing tells at equilibrium:** bigger = more polar; smaller = wider/merged. Multiway aggression = stronger.
5. **Text summary for the coach:** sort remaining combos by strength and describe buckets ("mostly top pair+, some flush draws, a few bluffs"), with % of combos.

---

## 9. Data notes for `preflopCharts.js`
- 100bb charts: cash, 8-max, no ante, **no rake** (the sim has no rake; real raked charts run slightly tighter, especially the BB and SB flats).
- 40/25bb charts: tournament with a ~12.5% ante (BB-ante 1bb), chip EV.
- `VS_RFI` groups openers as EP (UTG, UTG1), MP (LJ, HJ), CO, BTN, SB, and heroes as IP cold-callers (UTG1–CO), BTN, SB, BB. Every hero/opener pair is filled.
- `VS_3BET[d][opener].IP/OOP`: IP when the 3-bettor is in the blinds. At 40/25bb, IP and OOP share one map (4-bet = jam).
- `PUSH`/`CALL_PUSH`: computed by a chip-EV push/fold solver (169×169 Monte Carlo equity matrix, iterated best response, BB-ante 1bb, single-caller approximation). Validated by re-solving heads-up with a 10% ante and matching the HoldemResources Nash chart to within ~0.5–1bb per hand. `CALL_PUSH.other` is a non-blind cold-caller (CO vs LJ shove) for any unlisted caller.
- Push values are on a 0.25bb grid. 20 means "20+". Weakest hands show small values (≥ 0.75).

### Sources consulted
- GTO Wizard blog: "MDF & Alpha", "Mathematical Misconceptions in Poker", "Flop Heuristics: IP C-Betting in Cash Games", "Flop Heuristics: IP C-Betting in MTTs", "C-Betting As the OOP Preflop Raiser", "Aggregate Flop Strategy: SB C-Betting in SRP".
- Poker TDA Rules (pokertda.com): Rules 17, 18, 21, 23, 34, 36, 45, 49, 54, 56. 2019 TDA Summit coverage (PokerNews) on the BB-ante posting order.
- Robert's Rules of Poker (Card Player "rules of poker"): limit cap / heads-up exception, half-bet all-in rule, tournament cap.
- HoldemResources.net heads-up Nash push/fold charts (no ante and 10% ante).
- PokerSkill / PokerStrategy push-fold articles (widths by seat, effect of antes) for cross-checking.
