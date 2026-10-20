import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, scoreInts, cardToInt } from '../src/engine/evaluator.js';
import { newDeck, shuffle, makeRng } from '../src/engine/cards.js';

const h = (s) => s.split(' ');
const ev = (s) => evaluate(h(s));

test('every category with names', () => {
  const cases = [
    ['As Ks Qs Js Ts 2d 3c', 8, 'Royal Flush'],
    ['9h 8h 7h 6h 5h Ad Ac', 8, 'Straight Flush, Nine high'],
    ['Ad 2d 3d 4d 5d Kc Kh', 8, 'Straight Flush, Five high'],
    ['7c 7d 7h 7s Kd 2c 3c', 7, 'Four of a Kind, Sevens'],
    ['Kc Kd Kh 7s 7d 2c 3h', 6, 'Full House, Kings full of Sevens'],
    ['Ah 9h 6h 4h 2h Kd Qc', 5, 'Flush, Ace high'],
    ['Ad 2c 3h 4s 5d Kc 9h', 4, 'Straight, Five high'],
    ['Ad Kc Qh Js Td 2c 3h', 4, 'Straight, Ace high'],
    ['8c 8d 8h Ks 4d 2c 3h', 3, 'Three of a Kind, Eights'],
    ['Kc Kd 7h 7s 4d 2c 3h', 2, 'Two Pair, Kings and Sevens'],
    ['Qc Qd 9h 7s 4d 2c 3h', 1, 'Pair of Queens'],
    ['Ac Jd 9h 7s 4d 2c 3h', 0, 'High Card, Ace high'],
  ];
  for (const [cards, cat, name] of cases) {
    const r = ev(cards);
    assert.equal(r.category, cat, cards);
    assert.equal(r.name, name, cards);
  }
});

test('kickers decide', () => {
  const gt = (a, b) => assert.ok(ev(a).score > ev(b).score, `${a} > ${b}`);
  const eq = (a, b) => assert.equal(ev(a).score, ev(b).score, `${a} = ${b}`);
  gt('Ac Ad Kh 9s 4d 3c 2h', 'As Ah Qh Js 9d 3s 2d'); // pair, K kicker beats Q
  gt('Ac Ad Kh 9s 5d 3c 2h', 'As Ah Kd 9c 4d 3s 2d'); // third kicker
  eq('Ac Ad Kh 9s 5d 3c 2h', 'As Ah Kd 9c 5c 3s 2d'); // same 5
  gt('Kc Kd 7h 7s Ad 2c 3h', 'Ks Kh 7d 7c Qd 2s 3d'); // two pair kicker
  eq('Kc Kd 7h 7s 4d 4c Qh', 'Ks Kh 7d 7c Qd 2s 3d'); // 3rd pair irrelevant vs kicker Q
  gt('8c 8d 8h As 4d 2c 3h', '8s 8d 8h Ks Qd 2c 3h'); // trips kicker
  gt('7c 7d 7h 7s Ad 2c 3c', '7c 7d 7h 7s Kd Qc Jc'); // quads kicker
  gt('Kc Kd Kh 7s 7d 2c 3h', 'Qc Qd Qh As Ad 2c 3h'); // FH trips rank first
  gt('Kc Kd Kh 8s 8d 2c 3h', 'Kc Kd Kh 7s 7d 2c 3h'); // FH pair
  gt('Kc Kd Kh 7s 7d 7c 3h', 'Kc Kd Kh 6s 6d 2c 3h'); // two trips -> higher pair from second trips
  gt('Ah Kh 6h 4h 2h', 'Ah Qh Jh Th 8h'); // flush second card
  gt('Ah Kh 6h 4h 3h', 'Ad Kd 6d 4d 2d'); // flush 5th card
  gt('2c 3d 4h 5s 6d', 'Ad 2c 3h 4s 5d'); // six-high straight beats wheel
  gt('Ac Kd Qh Js 9d', 'Ac Kd Qh Js 8d'); // high card 5th
  gt('2d 3d 4d 5d 6d', 'Ad 2d 3d 4d 5d'); // steel wheel is lowest SF
  gt('Ad 2d 3d 4d 5d', 'Ac Ad Ah As Kd'); // steel wheel beats quads
});

test('5, 6 and 7 card inputs agree with best 5', () => {
  const r5 = ev('Kc Kd Kh 7s 7d');
  const r6 = ev('Kc Kd Kh 7s 7d 2c');
  const r7 = ev('Kc Kd Kh 7s 7d 2c 3h');
  assert.equal(r5.score, r6.score);
  assert.equal(r6.score, r7.score);
  assert.equal(ev('Ad 2c 3h 4s 5d 6c').name, 'Straight, Six high');
  assert.throws(() => evaluate(h('As Ks Qs Js')));
  assert.throws(() => evaluate(h('As As Qs Js Ts')));
  assert.throws(() => evaluate(h('As Xs Qs Js Ts')));
});

// Independent naive reference: sort-based 5-card ranking, max over all 5-subsets.
const RV = (c) => '23456789TJQKA'.indexOf(c[0]);
function ref5(cards) {
  const rs = cards.map(RV).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const uniq = [...new Set(rs)];
  let sHigh = -1;
  if (uniq.length === 5 && rs[0] - rs[4] === 4) sHigh = rs[0];
  if (uniq.length === 5 && rs[0] === 12 && rs[1] === 3) sHigh = 3;
  const cnt = {};
  rs.forEach((r) => { cnt[r] = (cnt[r] || 0) + 1; });
  const groups = Object.entries(cnt).map(([r, n]) => [n, +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const shape = groups.map((g) => g[0]).join('');
  const tb = groups.map((g) => g[1]);
  if (sHigh >= 0 && flush) return [8, sHigh];
  if (shape === '41') return [7, ...tb];
  if (shape === '32') return [6, ...tb];
  if (flush) return [5, ...rs];
  if (sHigh >= 0) return [4, sHigh];
  if (shape === '311') return [3, ...tb];
  if (shape === '221') return [2, ...tb];
  if (shape === '2111') return [1, ...tb];
  return [0, ...rs];
}
const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? -1) - (b[i] ?? -1); if (d) return Math.sign(d); } return 0; };
function refBest(cards) { // 7 cards: best of the 21 five-card subsets
  let best = null;
  for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
    const r = ref5(cards.filter((_, i) => i !== a && i !== b));
    if (!best || cmp(r, best) > 0) best = r;
  }
  return best;
}

test('matches independent reference on random 7-card pairs', () => {
  const rng = makeRng(12345);
  for (let i = 0; i < 20000; i++) {
    const d = shuffle(newDeck(), rng);
    const board = d.slice(0, 5), A = [...board, d[5], d[6]], B = [...board, d[7], d[8]];
    const ra = refBest(A), rb = refBest(B);
    const ea = evaluate(A), eb = evaluate(B);
    assert.equal(ea.category, ra[0], A.join(' '));
    assert.equal(Math.sign(ea.score - eb.score), cmp(ra, rb), `${A.join(' ')} vs ${B.join(' ')}`);
    assert.deepEqual(ref5(ea.best5), ra, `best5 ${A.join(' ')}`);
  }
});

test('perf: scoreInts evals/sec', () => {
  const rng = makeRng(99);
  const N = 4096;
  const hands = [];
  for (let i = 0; i < N; i++) hands.push(shuffle(newDeck(), rng).slice(0, 7).map(cardToInt));
  let acc = 0;
  for (let i = 0; i < 200000; i++) acc += scoreInts(hands[i & (N - 1)]); // warm up
  const iters = 3_000_000;
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) acc += scoreInts(hands[i & (N - 1)]);
  const ms = performance.now() - t0;
  const rate = Math.round(iters / (ms / 1000));
  console.log(`scoreInts: ${rate.toLocaleString()} 7-card evals/sec (${acc > 0})`);
  assert.ok(rate >= 2_000_000, `too slow: ${rate}/s`);
});

test('best5 picks the right cards; a board that plays splits', () => {
  assert.deepEqual(ev('As Ks Qs Js Ts 2d 3c').best5.sort(), h('As Ks Qs Js Ts').sort());
  assert.deepEqual(ev('Ad 2c 3h 4s 5d Kc 9h').best5.sort(), h('Ad 2c 3h 4s 5d').sort());
  assert.deepEqual(ev('Ah 9h 6h 4h 2h 3h Kd').best5.sort(), h('Ah 9h 6h 4h 3h').sort());
  assert.deepEqual(ev('Kc Kd Kh 7s 7d 7c 3h').best5.sort(), h('Kc Kd Kh 7s 7d').sort());
  assert.deepEqual(ev('7c 7d 7h 7s Kd Qc Ac').best5.sort(), h('7c 7d 7h 7s Ac').sort());
  assert.deepEqual(ev('Kc Kd 7h 7s 4d 4c Ah').best5.sort(), h('Kc Kd 7h 7s Ah').sort());
  const board = h('As Ks Qd Jc Th');
  assert.equal(evaluate([...board, '2c', '3d']).score, evaluate([...board, '4h', '9h']).score);
  const quads = h('7c 7d 7h 7s Ac');
  assert.equal(evaluate([...quads, '2c', '3d']).score, evaluate([...quads, 'Kh', 'Qh']).score);
});

test('scoreInts matches evaluate for 5 to 7 cards', () => {
  const rng = makeRng(7);
  for (let i = 0; i < 2000; i++) {
    const d = shuffle(newDeck(), rng).slice(0, 5 + (i % 3));
    assert.equal(scoreInts(d.map(cardToInt)), evaluate(d).score);
  }
});
