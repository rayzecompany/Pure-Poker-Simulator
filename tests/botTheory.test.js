// Regression tests for the bot audit: preflop spots that must follow theory (THEORY 1, 2.2, 2.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine/game.js';
import { analyze } from '../src/strategy/policy.js';
import { classifySpot, walkPreflop } from '../src/strategy/preflop.js';
import { rangeOf } from '../src/strategy/rangeModel.js';
import { comboCount, combosOf } from '../src/strategy/preflopCharts.js';

function table({ n = 6, stacks = 200, ante = 0, betting = 'NL', hole } = {}) {
  const g = new Game({ players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, stack: stacks })), betting, smallBlind: 1, bigBlind: 2, ante, bigBlindAnte: !!ante, firstButton: 0, seed: 3, cash: { autoRebuyBots: false } });
  g.startHand(hole ? { holeCards: hole } : {});
  return g;
}
const seat = (g, pos) => g.state.seats.findIndex((s) => s.position === pos);
function play(g, seq) {
  for (const [pos, a] of seq) {
    assert.equal(g.state.toAct, seat(g, pos), `${pos} to act`);
    const L = g.legalActions();
    g.act(a === 'allin' ? { type: 'raise', to: L.allInTo } : typeof a === 'number' ? { type: 'raise', to: a } : { type: a });
  }
}
const foldTo = (g, pos) => { while (g.state.toAct !== seat(g, pos)) g.act({ type: 'fold' }); };
const spotOf = (g, pos) => { const v = g.viewFor(seat(g, pos)); return classifySpot(v, v.heroSeat, walkPreflop(v)); };
const share = (sp) => {
  let t = 0;
  for (const h of new Set([...Object.keys(sp.raise), ...Object.keys(sp.call)])) t += combosOf(h) * Math.min(1, (sp.raise[h] || 0) + (sp.call[h] || 0));
  return t / 1326;
};
const width = (m) => comboCount(m) / 1326;

test('preflop defence scales with the raise size (MDF) and is unchanged at the standard size', () => {
  const at = (chips) => { const g = table(); foldTo(g, 'BTN'); play(g, [['BTN', chips], ['SB', 'fold']]); return spotOf(g, 'BB'); };
  const std = at(5);
  assert.equal(std.sizeRatio, 1);
  const w = [4, 5, 8, 20].map((c) => share(at(c)));
  assert.ok(w[0] > w[1] && w[1] > w[2] && w[2] > w[3], `defence by size ${w.map((x) => x.toFixed(2))}`);
  assert.ok(w[0] > 0.68 && w[3] < 0.3, `2x ${w[0].toFixed(2)}, 10x ${w[3].toFixed(2)}`);
});

test('a huge non-all-in open is read as a committed range: weak hands fold', () => {
  const g = table({ hole: { 2: ['Kh', 'Jd'] } });
  foldTo(g, 'BTN'); play(g, [['BTN', 100], ['SB', 'fold']]);
  const a = analyze(g.viewFor(seat(g, 'BB')));
  assert.equal(a.options[0].action.type, 'fold');
});

test('push/fold: SB vs an early shove, multiway shoves, BB over a limp, no-ante depth', () => {
  // SB calling an UTG shove uses the general calling map, not the vs-button one
  let g = table({ n: 8, stacks: 20 });
  play(g, [['UTG', 'allin'], ['UTG1', 'fold'], ['LJ', 'fold'], ['HJ', 'fold'], ['CO', 'fold'], ['BTN', 'fold']]);
  assert.ok(share(spotOf(g, 'SB')) < 0.15, `SB vs UTG ${share(spotOf(g, 'SB'))}`);
  // with a caller in, pot odds decide: A9o folds, TT calls
  const multi = (cards) => {
    g = table({ n: 8, stacks: 20, hole: { 2: cards } });
    play(g, [['UTG', 'allin'], ['UTG1', 'fold'], ['LJ', 'fold'], ['HJ', 'fold'], ['CO', 'call'], ['BTN', 'fold'], ['SB', 'fold']]);
    return analyze(g.viewFor(seat(g, 'BB'))).options[0].action.type;
  };
  assert.equal(multi(['Ah', '9d']), 'fold');
  assert.equal(multi(['Th', 'Td']), 'call');
  // BB shoving over an SB limp is a button-like spot (~34%), not the SB's 72% first-in range
  g = table({ stacks: 20 }); foldTo(g, 'SB'); play(g, [['SB', 'call']]);
  const iso = width(spotOf(g, 'BB').raise);
  assert.ok(iso > 0.25 && iso < 0.45, `BB iso-shove ${iso}`);
  // charts were solved with a big-blind ante: without one, heads-up 10bb shoves/calls are narrower
  const hu = (ante) => { const t = table({ n: 2, stacks: 20, ante }); const p = t.state.seats[t.state.toAct].position; return width(spotOf(t, p).raise); };
  assert.ok(hu(0) < hu(2) - 0.05 && hu(0) > 0.5, `HU push no ante ${hu(0)}, ante ${hu(2)}`);
});

test('an open-shove deeper than push/fold depth is modeled as a tight range', () => {
  const g = table({ stacks: 200 }); foldTo(g, 'BTN'); play(g, [['BTN', 'allin'], ['SB', 'fold']]);
  const r = rangeOf(g.viewFor(seat(g, 'BB')), seat(g, 'BTN'));
  assert.ok(r.pct < 0.07, `100bb jam range ${r.pct}`);
});

test('personality looseness never adds shoves or all-in calls', () => {
  const g = table({ n: 8, stacks: 24, hole: { 3: ['8h', '7h'] } });
  const a = analyze(g.viewFor(seat(g, 'UTG')), { looseness: 0.04 });
  assert.equal(a.options.length, 1);
  assert.equal(a.options[0].action.type, 'fold');
});
