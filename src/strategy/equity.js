// Monte Carlo equity vs weighted ranges or random hands. Exact enumeration on the river heads-up.
import { scoreInts } from '../engine/evaluator.js';
import { NCOMBO, COMBO_A, COMBO_B, COMBO_ID, CARD_INT, cardIdx } from './combos.js';

/** Range (Float64Array(1326), Map "AhKh"->w, or [[c1, c2, w]]) -> weighted sampler. null = random hand. */
function toSampler(range, dead) {
  if (range == null) return null;
  const ks = [], ws = [];
  const push = (k, w) => { if (k >= 0 && w > 0 && !dead[COMBO_A[k]] && !dead[COMBO_B[k]]) { ks.push(k); ws.push(w); } };
  if (range instanceof Float64Array) {
    for (let k = 0; k < NCOMBO; k++) push(k, range[k]);
  } else if (range instanceof Map) {
    for (const [c, w] of range) push(COMBO_ID[cardIdx(c.slice(0, 2)) * 52 + cardIdx(c.slice(2, 4))], w);
  } else {
    for (const [c1, c2, w] of range) push(COMBO_ID[cardIdx(c1) * 52 + cardIdx(c2)], w ?? 1);
  }
  if (!ks.length) return null; // nothing left: treat as random
  const cum = new Float64Array(ks.length);
  let t = 0;
  for (let i = 0; i < ks.length; i++) { t += ws[i]; cum[i] = t; }
  return { ks: Int32Array.from(ks), cum, total: t };
}

function sampleCombo(s, rng) {
  const x = rng() * s.total;
  let lo = 0, hi = s.cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (s.cum[mid] > x) hi = mid; else lo = mid + 1; }
  return s.ks[lo];
}

export function equityVsRanges(hero, board, villainRanges, opts = {}) {
  const rng = opts.rng || Math.random;
  const dead = new Uint8Array(52);
  const h = hero.map(cardIdx), b = board.map(cardIdx);
  for (const c of h) dead[c] = 1;
  for (const c of b) dead[c] = 1;
  const samplers = villainRanges.map((r) => toSampler(r, dead));
  const nV = samplers.length;
  if (nV === 0) return { win: 1, tie: 0, equity: 1, iterations: 0 };

  // Exact river, heads-up vs a range.
  if (b.length === 5 && nV === 1 && samplers[0]) return exactRiver(h, b, samplers[0]);

  const iters = opts.iterations || 2000;
  const deck = [];
  for (let c = 0; c < 52; c++) if (!dead[c]) deck.push(c);
  const used = new Int32Array(52); // stamp per iteration
  const need = 5 - b.length;
  const heroInts = new Array(2 + 5), vInts = [];
  for (let v = 0; v < nV; v++) vInts.push(new Array(7));
  heroInts[0] = CARD_INT[h[0]]; heroInts[1] = CARD_INT[h[1]];
  for (let i = 0; i < b.length; i++) { const ci = CARD_INT[b[i]]; heroInts[2 + i] = ci; for (const a of vInts) a[2 + i] = ci; }
  const vCards = new Int32Array(nV * 2);

  let win = 0, tie = 0, eq = 0, done = 0;
  for (let it = 1; it <= iters; it++) {
    let ok = true;
    for (let v = 0; v < nV && ok; v++) {
      const s = samplers[v];
      let a = -1, c2 = -1;
      for (let tries = 0; tries < 30; tries++) {
        if (s) { const k = sampleCombo(s, rng); a = COMBO_A[k]; c2 = COMBO_B[k]; }
        else { a = deck[(rng() * deck.length) | 0]; c2 = deck[(rng() * deck.length) | 0]; if (a === c2) { a = -1; continue; } }
        if (used[a] !== it && used[c2] !== it) break;
        a = -1;
      }
      if (a < 0) { ok = false; break; }
      used[a] = it; used[c2] = it;
      vCards[v * 2] = a; vCards[v * 2 + 1] = c2;
    }
    if (!ok) continue;
    for (let i = 0; i < need; i++) {
      let c;
      do { c = deck[(rng() * deck.length) | 0]; } while (used[c] === it);
      used[c] = it;
      const ci = CARD_INT[c];
      heroInts[2 + b.length + i] = ci;
      for (const arr of vInts) arr[2 + b.length + i] = ci;
    }
    const hs = scoreInts(heroInts);
    let best = true, ties = 0;
    for (let v = 0; v < nV; v++) {
      const arr = vInts[v];
      arr[0] = CARD_INT[vCards[v * 2]]; arr[1] = CARD_INT[vCards[v * 2 + 1]];
      const vs = scoreInts(arr);
      if (vs > hs) { best = false; break; }
      if (vs === hs) ties++;
    }
    done++;
    if (best) { if (ties) { tie++; eq += 1 / (ties + 1); } else { win++; eq += 1; } }
  }
  if (!done) return { win: 0, tie: 0, equity: 0.5, iterations: 0 };
  return { win: win / done, tie: tie / done, equity: eq / done, iterations: done };
}

function exactRiver(h, b, s) {
  const base = b.map((c) => CARD_INT[c]);
  const hs = scoreInts([CARD_INT[h[0]], CARD_INT[h[1]], ...base]);
  const arr = [0, 0, ...base];
  let win = 0, tie = 0, tot = 0, prev = 0;
  for (let i = 0; i < s.ks.length; i++) {
    const w = s.cum[i] - prev; prev = s.cum[i];
    const k = s.ks[i];
    arr[0] = CARD_INT[COMBO_A[k]]; arr[1] = CARD_INT[COMBO_B[k]];
    const vs = scoreInts(arr);
    if (hs > vs) win += w; else if (hs === vs) tie += w;
    tot += w;
  }
  return { win: win / tot, tie: tie / tot, equity: (win + tie / 2) / tot, iterations: s.ks.length };
}

export function equityVsRandom(hero, board, numOpponents, opts = {}) {
  return equityVsRanges(hero, board, new Array(Math.max(1, numOpponents)).fill(null), opts);
}
