// Hand evaluator: rank bitmasks + per-suit masks, small 8192-entry lookup tables.
// Score = category << 20 | tiebreak nibbles (ranks 0..12, '2'..'A'). Higher wins; equal = tie.
import { RANKS, SUITS } from './cards.js';

const HB = new Int8Array(8192);    // index of highest set bit (-1 for 0)
const POP = new Uint8Array(8192);  // popcount
const STR = new Int8Array(8192);   // high rank of best straight in mask, -1 if none (wheel = 3)
const TOP5 = new Int32Array(8192); // top 5 ranks as nibbles, highest first, zero padded

HB[0] = -1;
for (let m = 1; m < 8192; m++) {
  HB[m] = 31 - Math.clz32(m);
  POP[m] = POP[m & (m - 1)] + 1;
  let s = 0, x = m;
  for (let i = 0; i < 5; i++) {
    const h = x ? 31 - Math.clz32(x) : 0;
    s = (s << 4) | h;
    if (x) x ^= 1 << h;
  }
  TOP5[m] = s;
}
for (let m = 0; m < 8192; m++) {
  STR[m] = -1;
  for (let hi = 12; hi >= 4; hi--) {
    const pat = 0x1f << (hi - 4);
    if ((m & pat) === pat) { STR[m] = hi; break; }
  }
  if (STR[m] < 0 && (m & 0x100f) === 0x100f) STR[m] = 3; // A-2-3-4-5
}

const CARD_INT = {};
for (let r = 0; r < 13; r++) for (let s = 0; s < 4; s++) CARD_INT[RANKS[r] + SUITS[s]] = r * 4 + s;

export function cardToInt(c) {
  const v = CARD_INT[c];
  if (v === undefined) throw new Error(`Invalid card: ${c}`);
  return v;
}

// Fast path: ints = cardToInt values, 5 to 7 cards.
export function scoreInts(c) {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, m1 = 0, m2 = 0, m3 = 0, m4 = 0;
  for (let i = 0; i < c.length; i++) {
    const v = c[i], b = 1 << (v >> 2);
    switch (v & 3) { case 0: s0 |= b; break; case 1: s1 |= b; break; case 2: s2 |= b; break; default: s3 |= b; }
    m4 |= m3 & b; m3 |= m2 & b; m2 |= m1 & b; m1 |= b;
  }
  // With <= 7 cards a flush can't coexist with quads or a full house, so it is safe to return early.
  const f = POP[s0] >= 5 ? s0 : POP[s1] >= 5 ? s1 : POP[s2] >= 5 ? s2 : POP[s3] >= 5 ? s3 : 0;
  if (f) {
    const sf = STR[f];
    return sf >= 0 ? (8 << 20) | sf : (5 << 20) | TOP5[f];
  }
  if (m4) { const q = HB[m4]; return (7 << 20) | (q << 4) | HB[m1 & ~(1 << q)]; }
  if (m3) {
    const t = HB[m3], rest = m2 & ~(1 << t);
    if (rest) return (6 << 20) | (t << 4) | HB[rest];
  }
  const st = STR[m1];
  if (st >= 0) return (4 << 20) | st;
  if (m3) { const t = HB[m3]; return (3 << 20) | (t << 8) | (TOP5[m1 & ~(1 << t)] >>> 12); }
  if (m2) {
    const p1 = HB[m2], r = m2 ^ (1 << p1);
    if (r) { const p2 = HB[r]; return (2 << 20) | (p1 << 8) | (p2 << 4) | HB[m1 & ~(1 << p1) & ~(1 << p2)]; }
    return (1 << 20) | (p1 << 12) | (TOP5[m1 ^ (1 << p1)] >>> 8);
  }
  return TOP5[m1];
}

const NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
const PLURAL = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

function straightRanks(hi) {
  return hi === 3 ? [3, 2, 1, 0, 12] : [hi, hi - 1, hi - 2, hi - 3, hi - 4];
}
const nib = (score, i) => (score >> (16 - 4 * i)) & 15; // i-th of 5 nibbles

export function evaluate(cards) {
  if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7) throw new Error('evaluate needs 5 to 7 cards');
  if (new Set(cards).size !== cards.length) throw new Error('Duplicate cards');
  const ints = cards.map(cardToInt);
  const score = scoreInts(ints);
  const category = score >> 20;
  let ranks, name, flushSuit = -1;
  if (category === 5 || category === 8) {
    const counts = [0, 0, 0, 0];
    for (const v of ints) counts[v & 3]++;
    flushSuit = counts.findIndex((n) => n >= 5);
  }
  switch (category) {
    case 8: {
      const hi = score & 15;
      ranks = straightRanks(hi);
      name = hi === 12 ? 'Royal Flush' : `Straight Flush, ${NAMES[hi]} high`;
      break;
    }
    case 7: { const q = (score >> 4) & 15; ranks = [q, q, q, q, score & 15]; name = `Four of a Kind, ${PLURAL[q]}`; break; }
    case 6: {
      const t = (score >> 4) & 15, p = score & 15;
      ranks = [t, t, t, p, p]; name = `Full House, ${PLURAL[t]} full of ${PLURAL[p]}`; break;
    }
    case 5: ranks = [0, 1, 2, 3, 4].map((i) => nib(score, i)); name = `Flush, ${NAMES[ranks[0]]} high`; break;
    case 4: { const hi = score & 15; ranks = straightRanks(hi); name = `Straight, ${NAMES[hi]} high`; break; }
    case 3: { const t = (score >> 8) & 15; ranks = [t, t, t, (score >> 4) & 15, score & 15]; name = `Three of a Kind, ${PLURAL[t]}`; break; }
    case 2: {
      const a = (score >> 8) & 15, b = (score >> 4) & 15;
      ranks = [a, a, b, b, score & 15]; name = `Two Pair, ${PLURAL[a]} and ${PLURAL[b]}`; break;
    }
    case 1: {
      const p = (score >> 12) & 15;
      ranks = [p, p, (score >> 8) & 15, (score >> 4) & 15, score & 15]; name = `Pair of ${PLURAL[p]}`; break;
    }
    default: ranks = [0, 1, 2, 3, 4].map((i) => nib(score, i)); name = `High Card, ${NAMES[ranks[0]]} high`;
  }
  const used = new Array(ints.length).fill(false);
  const best5 = ranks.map((r) => {
    const i = ints.findIndex((v, k) => !used[k] && v >> 2 === r && (flushSuit < 0 || (v & 3) === flushSuit));
    used[i] = true;
    return cards[i];
  });
  return { score, category, name, best5 };
}
