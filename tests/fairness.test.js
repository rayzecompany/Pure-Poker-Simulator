// Fairness: the deal is uniform, nobody is favored, and hands are ranked and named exactly.
// Statistical checks use a one-in-a-million false-alarm threshold, so they don't flake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDeck, shuffle, secureRng } from '../src/engine/cards.js';
import { scoreInts, cardToInt, evaluate } from '../src/engine/evaluator.js';
import { Game, autoPlayHand } from '../src/engine/game.js';
import { describeHand } from '../src/strategy/coach.js';

// Wilson-Hilferty chi-square critical value for p = 1e-6 (z = 4.753)
const chiCrit = (df) => df * (1 - 2 / (9 * df) + 4.753 * Math.sqrt(2 / (9 * df))) ** 3;
function chiSquare(observed, expected) {
  let x = 0;
  for (let i = 0; i < observed.length; i++) x += (observed[i] - expected[i]) ** 2 / expected[i];
  return x;
}

test('evaluator: all 2,598,960 five-card hands land in the exact textbook categories', () => {
  const counts = new Array(9).fill(0);
  const c = [0, 0, 0, 0, 0];
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) for (let d = b + 1; d < 52; d++)
    for (let e = d + 1; e < 52; e++) for (let f = e + 1; f < 52; f++) {
      c[0] = a; c[1] = b; c[2] = d; c[3] = e; c[4] = f;
      counts[scoreInts(c) >> 20]++;
    }
  assert.deepEqual(counts, [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
});

test('secure RNG: integers are uniform and the shuffle is a permutation', () => {
  const n = 7, draws = 140000, obs = new Array(n).fill(0);
  for (let i = 0; i < draws; i++) obs[secureRng.int(n)]++;
  assert.ok(chiSquare(obs, obs.map(() => draws / n)) < chiCrit(n - 1));
  for (let i = 0; i < 1000; i++) { const x = secureRng(); assert.ok(x >= 0 && x < 1); }
  const deck = shuffle(newDeck());
  assert.equal(new Set(deck).size, 52);
});

test('shuffle: every card is equally likely in every deck position', () => {
  const N = 26000, pos = [0, 1, 25, 51];
  const counts = pos.map(() => new Array(52).fill(0));
  const idx = Object.fromEntries(newDeck().map((c, i) => [c, i]));
  for (let t = 0; t < N; t++) {
    const d = shuffle(newDeck());
    pos.forEach((p, k) => counts[k][idx[d[p]]]++);
  }
  for (const row of counts) assert.ok(chiSquare(row, row.map(() => N / 52)) < chiCrit(51));
});

test('seven-card hands appear at their true probabilities (no inflated or deflated hands)', () => {
  // exact 7-card category counts out of C(52,7) = 133,784,560
  const exact = [23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 41584];
  const N = 400000, obs = new Array(9).fill(0), ints = new Array(7);
  for (let t = 0; t < N; t++) {
    const d = shuffle(newDeck());
    for (let k = 0; k < 7; k++) ints[k] = cardToInt(d[k]);
    obs[scoreInts(ints) >> 20]++;
  }
  const expected = exact.map((x) => (x / 133784560) * N);
  assert.ok(chiSquare(obs, expected) < chiCrit(8), `observed ${obs}`);
});

test('dealing: you get the same cards as every opponent (no seat is favored)', () => {
  const g = new Game({ players: Array.from({ length: 6 }, (_, i) => ({ id: i ? `b${i}` : 'hero', isHuman: !i })), startingStack: 1e9 });
  const N = 9000, perSeat = Array.from({ length: 6 }, () => new Array(52).fill(0)), pairs = new Array(6).fill(0);
  for (let t = 0; t < N; t++) {
    g.startHand();
    g.state.seats.forEach((s, i) => {
      for (const c of s.holeCards) perSeat[i][cardToInt(c)]++;
      if (s.holeCards[0][0] === s.holeCards[1][0]) pairs[i]++;
    });
    autoPlayHand(g, (v) => (v.legal.canCheck ? { type: 'check' } : { type: 'fold' }));
  }
  for (const row of perSeat) assert.ok(chiSquare(row, row.map(() => (2 * N) / 52)) < chiCrit(51));
  // pocket pairs: 6/102 = 5.88% for every seat (binomial sd ~0.25%)
  for (const p of pairs) assert.ok(Math.abs(p / N - 6 / 102) < 0.012, `pair rate ${p / N}`);
});

test('live hand label names exactly what you hold', () => {
  assert.equal(describeHand(['9h', '9d'], ['8c', '8s', '5c', '5d', '2h']).name, 'Two Pair, Nines and Eights');
  assert.equal(describeHand(['9h', '9d'], ['8c', '8s', '8d', '5c', '5d']).name, 'Full House, Eights full of Nines');
  assert.equal(describeHand(['9h', '9d'], ['8c', '8s', '5c', '5d']).name, 'Two Pair, Nines and Eights');
  assert.match(describeHand(['Ah', 'Jd'], ['9c', '7s', '9d']).name, /board: pair of nines/);
  assert.match(describeHand(['2h', '3d'], ['8c', '8s', '5c', '5d', 'Kh']).name, /playing the board/);
  // the label's category always matches the evaluator's
  for (let t = 0; t < 20000; t++) {
    const d = shuffle(newDeck()), n = 3 + (t % 3);
    const hero = d.slice(0, 2), board = d.slice(2, 2 + n);
    const r = describeHand(hero, board), ev = evaluate([...hero, ...board]);
    assert.equal(r.category, ev.category);
    if (!r.name.includes('(board')) assert.ok(r.name.startsWith(ev.name), `${hero} ${board}: ${r.name} vs ${ev.name}`);
  }
});
