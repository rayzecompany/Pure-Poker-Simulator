// Shared card/combo indexing for the strategy layer.
// Card index = rank*4 + suit (rank 0..12 = 2..A, suit 0..3 = c d h s). 1326 two-card combos.
import { cardToInt } from '../engine/evaluator.js';
import { RANKS, SUITS } from '../engine/cards.js';

export { RANKS };
const CARD_STR = [];
for (let r = 0; r < 13; r++) for (let s = 0; s < 4; s++) CARD_STR.push(RANKS[r] + SUITS[s]);
export const CARD_INT = CARD_STR.map((c) => cardToInt(c));

export const cardIdx = (c) => RANKS.indexOf(c[0]) * 4 + SUITS.indexOf(c[1]);

export const NCOMBO = 1326;
export const COMBO_A = new Uint8Array(NCOMBO); // higher card index
export const COMBO_B = new Uint8Array(NCOMBO);
export const COMBO_ID = new Int16Array(52 * 52).fill(-1);
export const COMBO_CLASS = new Array(NCOMBO);
export const CLASS_COMBOS = new Map();

function classOf(a, b) {
  const ra = a >> 2, rb = b >> 2;
  const hi = Math.max(ra, rb), lo = Math.min(ra, rb);
  if (hi === lo) return RANKS[hi] + RANKS[lo];
  return RANKS[hi] + RANKS[lo] + ((a & 3) === (b & 3) ? 's' : 'o');
}

{
  let k = 0;
  for (let a = 51; a >= 0; a--) for (let b = a - 1; b >= 0; b--) {
    COMBO_A[k] = a; COMBO_B[k] = b;
    COMBO_ID[a * 52 + b] = k; COMBO_ID[b * 52 + a] = k;
    const cls = classOf(a, b);
    COMBO_CLASS[k] = cls;
    if (!CLASS_COMBOS.has(cls)) CLASS_COMBOS.set(cls, []);
    CLASS_COMBOS.get(cls).push(k);
    k++;
  }
}
export const CLASSES = [...CLASS_COMBOS.keys()];

export const comboOf = (c1, c2) => COMBO_ID[cardIdx(c1) * 52 + cardIdx(c2)];
export const handClassOf = (c1, c2) => classOf(cardIdx(c1), cardIdx(c2));

export const fullRange = () => new Float64Array(NCOMBO).fill(1);

/** Zero every combo that uses a dead card (in place). */
export function removeDead(w, dead) {
  const d = new Uint8Array(52);
  for (const c of dead) d[cardIdx(c)] = 1;
  for (let k = 0; k < NCOMBO; k++) if (d[COMBO_A[k]] || d[COMBO_B[k]]) w[k] = 0;
  return w;
}

export const totalWeight = (w) => { let t = 0; for (let k = 0; k < NCOMBO; k++) t += w[k]; return t; };

/** Chen formula: cheap preflop hand-strength score for a class (higher = better). */
export function chen(cls) {
  const val = { A: 10, K: 8, Q: 7, J: 6, T: 5 };
  const hi = cls[0], lo = cls[1];
  const rv = (r) => val[r] ?? (RANKS.indexOf(r) + 2) / 2;
  if (hi === lo) return Math.max(5, rv(hi) * 2);
  let s = rv(hi);
  if (cls[2] === 's') s += 2;
  const gap = RANKS.indexOf(hi) - RANKS.indexOf(lo) - 1;
  s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && RANKS.indexOf(hi) < RANKS.indexOf('Q')) s += 1;
  return Math.ceil(s);
}

// ---------- preflop strength order ----------
// All-in equity vs a random hand (x1000, 60k trials each), plus a small playability bonus for suited and
// connected hands. Used to order hands when a range has to be widened or tightened (e.g. facing an odd size).
const EQ_VS_RANDOM = (
  'AA:854 AKs:671 AKo:654 AQs:662 AQo:644 AJs:657 AJo:639 ATs:648 ATo:629 A9s:628 A9o:608 A8s:621 A8o:600 ' +
  'A7s:614 A7o:591 A6s:601 A6o:578 A5s:602 A5o:579 A4s:593 A4o:569 A3s:583 A3o:560 A2s:575 A2o:551 KK:826 ' +
  'KQs:634 KQo:614 KJs:627 KJo:607 KTs:617 KTo:596 K9s:599 K9o:577 K8s:583 K8o:561 K7s:577 K7o:553 K6s:568 ' +
  'K6o:543 K5s:560 K5o:533 K4s:551 K4o:524 K3s:542 K3o:515 K2s:532 K2o:504 QQ:801 QJs:602 QJo:581 QTs:592 ' +
  'QTo:570 Q9s:576 Q9o:553 Q8s:559 Q8o:535 Q7s:544 Q7o:518 Q6s:537 Q6o:510 Q5s:527 Q5o:500 Q4s:519 Q4o:490 ' +
  'Q3s:510 Q3o:481 Q2s:501 Q2o:472 JJ:775 JTs:575 JTo:551 J9s:557 J9o:532 J8s:540 J8o:514 J7s:526 J7o:499 ' +
  'J6s:508 J6o:480 J5s:500 J5o:472 J4s:492 J4o:464 J3s:484 J3o:455 J2s:476 J2o:445 TT:749 T9s:539 T9o:513 ' +
  'T8s:522 T8o:496 T7s:506 T7o:479 T6s:489 T6o:461 T5s:471 T5o:441 T4s:465 T4o:435 T3s:457 T3o:425 T2s:452 ' +
  'T2o:419 99:720 98s:505 98o:478 97s:490 97o:463 96s:473 96o:443 95s:457 95o:426 94s:437 94o:404 93s:433 ' +
  '93o:400 92s:425 92o:392 88:692 87s:479 87o:450 86s:460 86o:429 85s:442 85o:411 84s:423 84o:391 83s:407 ' +
  '83o:374 82s:403 82o:370 77:663 76s:452 76o:421 75s:435 75o:404 74s:418 74o:386 73s:401 73o:368 72s:384 ' +
  '72o:350 66:632 65s:430 65o:398 64s:413 64o:381 63s:396 63o:362 62s:379 62o:344 55:603 54s:414 54o:382 ' +
  '53s:396 53o:362 52s:379 52o:344 44:571 43s:384 43o:349 42s:370 42o:334 33:535 32s:360 32o:324 22:505'
).split(' ').map((t) => t.split(':'));
export const PREFLOP_STRENGTH = Object.fromEntries(EQ_VS_RANDOM.map(([h, e]) => {
  const gap = RANKS.indexOf(h[0]) - RANKS.indexOf(h[1]);
  const bonus = h.length === 2 ? 0 : (h[2] === 's' ? 0.02 : 0) + (gap === 1 ? 0.012 : gap === 2 ? 0.006 : 0);
  return [h, e / 1000 + bonus];
}));

// ---------- draws ----------
const STRAIGHTS = []; // 10 windows as rank bitmasks (ace low uses bit 12 as the "1")
for (let top = 3; top <= 12; top++) {
  let m = 0;
  for (let r = top - 4; r <= top; r++) m |= 1 << (r < 0 ? 12 : r);
  STRAIGHTS.push(m);
}
const popcount = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

/** Draws for hole (2 card idx) + board (3..4 card idx); outs is 0 once the hand is a made straight or flush. */
export function drawInfo(h1, h2, board) {
  const res = { flush: false, backdoorFlush: false, oesd: false, gutshot: false, overcards: false, outs: 0, madeStraight: false, madeFlush: false };
  if (board.length < 3 || board.length > 4) return res;
  const suitCnt = [0, 0, 0, 0];
  let boardMask = 0, boardTop = 0;
  for (const c of board) { suitCnt[c & 3]++; boardMask |= 1 << (c >> 2); boardTop = Math.max(boardTop, c >> 2); }
  const s1 = h1 & 3, s2 = h2 & 3;
  const holeMask = (1 << (h1 >> 2)) | (1 << (h2 >> 2));
  const all = boardMask | holeMask;
  for (let s = 0; s < 4; s++) {
    const n = suitCnt[s] + (s1 === s) + (s2 === s);
    if (n >= 5 && (s1 === s || s2 === s)) res.madeFlush = true;
    if (n === 4 && (s1 === s || s2 === s)) res.flush = true;
    if (n === 3 && board.length === 3 && s1 === s && s2 === s) res.backdoorFlush = true;
  }
  const outRanks = new Set();
  for (const m of STRAIGHTS) {
    const have = all & m;
    if (have === m) { if ((holeMask & m) && (boardMask & m) !== m) res.madeStraight = true; continue; }
    if (popcount(have) === 4 && (holeMask & m & ~boardMask)) {
      const missing = m & ~have;
      outRanks.add(31 - Math.clz32(missing));
    }
  }
  if (res.madeStraight || res.madeFlush) { res.flush = res.backdoorFlush = false; outRanks.clear(); }
  res.oesd = outRanks.size >= 2;
  res.gutshot = outRanks.size === 1;
  let outs = res.flush ? 9 : 0;
  outs += outRanks.size * (res.flush ? 3 : 4); // flush-suit straight outs already counted
  const pairedHole = (h1 >> 2) === (h2 >> 2) || (boardMask & holeMask);
  res.overcards = !pairedHole && (h1 >> 2) > boardTop && (h2 >> 2) > boardTop;
  res.outs = outs;
  return res;
}

/** Plain names of the draws in a drawInfo result, e.g. ['flush draw', 'gutshot straight draw']. */
export function drawNames(d) {
  const out = [];
  if (d.flush) out.push('flush draw');
  if (d.oesd) out.push('open-ended straight draw'); else if (d.gutshot) out.push('gutshot straight draw');
  if (d.backdoorFlush) out.push('backdoor flush draw');
  if (d.overcards) out.push('two overcards');
  return out;
}
