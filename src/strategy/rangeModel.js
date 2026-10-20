// Per-player range estimation from public actions only.
// Preflop: chart frequencies for each spot the player acted in. Postflop: likelihood weights per action vs board.
import { scoreInts } from '../engine/evaluator.js';
import { RANKS, NCOMBO, COMBO_A, COMBO_B, COMBO_CLASS, CLASSES, CLASS_COMBOS, CARD_INT, cardIdx, fullRange, removeDead, totalWeight, drawInfo, chen, PREFLOP_STRENGTH } from './combos.js';
import { walkPreflop, classifySpot, isAggr, setTableSize, pushMap, pushLookupBB } from './preflop.js';

const FLOOR = 0.004; // keeps "off-chart" hands possible so deviations never empty a range

// ---------- per-board strength table ----------
const boardCache = new Map();
/** For a board (3–5 cards): score, effective strength (percentile + draw bonus), outs, category code per combo. */
export function boardTable(board) {
  const key = board.join('');
  let t = boardCache.get(key);
  if (t) return t;
  const b = board.map(cardIdx);
  const dead = new Uint8Array(52);
  for (const c of b) dead[c] = 1;
  const score = new Int32Array(NCOMBO).fill(-1);
  const ints = [0, 0, ...b.map((c) => CARD_INT[c])];
  const live = [];
  for (let k = 0; k < NCOMBO; k++) {
    if (dead[COMBO_A[k]] || dead[COMBO_B[k]]) continue;
    ints[0] = CARD_INT[COMBO_A[k]]; ints[1] = CARD_INT[COMBO_B[k]];
    score[k] = scoreInts(ints);
    live.push(k);
  }
  live.sort((x, y) => score[x] - score[y]);
  const hs = new Float64Array(NCOMBO), es = new Float64Array(NCOMBO);
  const outs = new Uint8Array(NCOMBO), cat = new Uint8Array(NCOMBO);
  const N = live.length;
  for (let i = 0; i < N;) {
    let j = i;
    while (j < N && score[live[j]] === score[live[i]]) j++;
    const pct = (i + (j - i - 1) / 2) / Math.max(1, N - 1);
    for (let q = i; q < j; q++) hs[live[q]] = pct;
    i = j;
  }
  let boardTop = 0, boardLow = 12;
  const boardRanks = new Uint8Array(13);
  for (const c of b) { boardTop = Math.max(boardTop, c >> 2); boardLow = Math.min(boardLow, c >> 2); boardRanks[c >> 2]++; }
  for (const k of live) {
    let e = hs[k];
    if (b.length < 5) {
      const d = drawInfo(COMBO_A[k], COMBO_B[k], b);
      outs[k] = d.outs;
      const de = drawEquity(d.outs, b.length) + (b.length === 3 ? (d.backdoorFlush ? 0.03 : 0) + (d.overcards ? 0.04 : 0) : 0);
      e = e + (1 - e) * de;
    }
    es[k] = e;
    // category for descriptions: 0 air, 1 weak pair, 2 middle pair, 3 top pair/overpair, 4 two pair or better
    const c = score[k] >> 20;
    const ra = COMBO_A[k] >> 2, rb = COMBO_B[k] >> 2;
    if (c >= 3 || (c === 2 && ra !== rb && boardRanks[ra] && boardRanks[rb])) cat[k] = 4;
    else if (c >= 1) { // one pair that matters (pocket pair or a hole card paired)
      const pr = ra === rb ? ra : boardRanks[ra] ? ra : boardRanks[rb] ? rb : -1;
      if (pr < 0) cat[k] = 0; // pair is on the board
      else if (pr >= boardTop) cat[k] = 3;
      else if (pr > boardLow) cat[k] = 2;
      else cat[k] = 1;
    } else cat[k] = 0;
  }
  t = { score, hs, es, outs, cat, live };
  if (boardCache.size > 64) boardCache.clear();
  boardCache.set(key, t);
  return t;
}

/** Equity a draw adds (exact hit chance, discounted because not every out wins / gets paid). */
export function drawEquity(outs, boardLen) {
  if (!outs || boardLen >= 5) return 0;
  const hit = boardLen === 3 ? 1 - ((47 - outs) * (46 - outs)) / (47 * 46) : outs / 46;
  return Math.min(0.6, hit * 0.8);
}

// ---------- action likelihoods (THEORY 8.4) ----------
// Hand buckets on that board: S strong, D strong draw, M medium, d weak draw, W weak showdown value, A air.
function bucket(es, outs, river) {
  if (es >= 0.8) return 'S';
  if (!river && outs >= 8) return 'D';
  if (es >= 0.45) return 'M';
  if (!river && outs >= 4) return 'd';
  return es >= 0.3 ? 'W' : 'A';
}
const L_SMALL = { S: 0.8, D: 0.6, M: 0.7, d: 0.55, W: 0.5, A: 0.5 };
const L_BIG = { S: 1, D: 0.8, M: 0.2, d: 0.45, W: 0.1, A: 0.3 };
const L_RAISE = { S: 1, D: 0.7, M: 0.05, d: 0.25, W: 0.05, A: 0.15 };
const L_CHECK_INIT = { S: 0.3, D: 0.6, M: 0.8, d: 0.7, W: 0.9, A: 0.6 }; // had the initiative and checked
const L_CHECK = { S: 0.75, D: 0.85, M: 1, d: 1, W: 1, A: 1 };
const L_CALL = { S: 0.4, D: 1, M: 1, d: 0.8, W: 0.5, A: 0.1 };
const L_CALL_RIVER = { S: 0.4, D: 0.02, M: 1, d: 0.02, W: 0.5, A: 0.02 };

function postflopLik(type, r, es, outs, river, hadInitiative) {
  const b = bucket(es, outs, river);
  switch (type) {
    case 'bet': {
      const x = Math.max(0, Math.min(1, (r - 0.4) / 0.26)); // <= 40% pot: small table, >= 66%: big table
      const big = b === 'A' && river ? 0.25 : L_BIG[b];
      return L_SMALL[b] + (big - L_SMALL[b]) * x;
    }
    case 'raise': return L_RAISE[b];
    case 'check': return (hadInitiative ? L_CHECK_INIT : L_CHECK)[b];
    case 'call': return (river ? L_CALL_RIVER : L_CALL)[b] * (b === 'M' && r > 1 ? 0.7 : 1);
    default: return 1;
  }
}
/**
 * An open-shove deeper than push/fold depth is a shove range, not an open range (THEORY 2.4): the push chart at
 * that depth, and from 25bb up only its strongest part, shrinking with depth (about QQ+/AK at 100bb).
 */
function openJamRange(spot, view) {
  const base = pushMap(spot.hu && spot.pos === 'BTN' ? 'SB' : spot.pos, pushLookupBB(view, spot.effBB), spot.hu);
  if (spot.effBB <= 25) return base;
  const keep = Math.min(1, (25 / spot.effBB) ** 1.5);
  const hands = Object.keys(base).sort((a, b) => PREFLOP_STRENGTH[b] - PREFLOP_STRENGTH[a]);
  return Object.fromEntries(hands.slice(0, Math.max(3, Math.round(hands.length * keep))).map((h) => [h, 1]));
}

function classFactor(spot, type, allIn, view, to = 0) {
  const f = new Map();
  // an open of a quarter of the stack or more is committed: read it like a shove
  const committed = allIn || to >= 0.25 * spot.effBB * view.bigBlind;
  const jamRange = isAggr(type) && committed && spot.kind === 'rfi' ? openJamRange(spot, view) : null;
  for (const h of CLASSES) {
    let p;
    if (jamRange) p = jamRange[h] || 0;
    else if (isAggr(type)) p = spot.raise[h] || 0;
    else if (type === 'check') p = 1 - 0.9 * (spot.raise[h] || 0);
    else if (type === 'call') {
      if (spot.kind === 'rfi' && !Object.keys(spot.call).length || spot.kind === 'push') {
        // an open-limp: mostly speculative and medium hands, few premiums
        const c = chen(h);
        p = c >= 12 ? 0.25 : c >= 5 ? 0.6 : 0.15;
      } else p = spot.call[h] || 0;
    } else p = 1;
    f.set(h, Math.max(FLOOR, Math.min(1, p)));
  }
  return f;
}

// ---------- main ----------
const cache = new Map();

/** Everything a decision depends on (also seeds the equity sampler). Hand numbers repeat across games, so the actions go in too. */
export const viewKey = (view) => [view.handNumber, view.betting, view.buttonSeat, view.heroSeat, (view.seats[view.heroSeat].holeCards || []).join(''), view.board.join(''),
  view.seats.map((s) => s.stack).join(), (view.actions || []).map((a) => a.seat + a.type + a.to).join()].join('|');

/**
 * Range for `seat` as seen by view.heroSeat (removes the viewer's cards + board).
 * Returns { seat, weights: Float64Array(1326), desc, pct }
 */
export function rangeOf(view, seat) {
  setTableSize(view);
  const key = `${viewKey(view)}|${seat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const w = fullRange();
  walkPreflop(view, (a, ctx) => {
    if (a.seat !== seat) return;
    const spot = classifySpot(view, seat, ctx);
    const f = classFactor(spot, a.type, a.allIn, view, a.to);
    for (let k = 0; k < NCOMBO; k++) w[k] *= f.get(COMBO_CLASS[k]);
  });

  // postflop narrowing
  const streets = ['flop', 'turn', 'river'];
  const boardLen = { flop: 3, turn: 4, river: 5 };
  let pot = 0;
  let cur = 0, bets = new Map(), street = 'preflop', lastAggr = null, prevAggr = null;
  for (const a of view.actions || []) {
    if (a.street !== street) { street = a.street; cur = 0; bets = new Map(); prevAggr = lastAggr; lastAggr = null; }
    if (streets.includes(a.street) && a.seat === seat && a.type !== 'fold' && view.board.length >= boardLen[a.street]) {
      const t = boardTable(view.board.slice(0, boardLen[a.street]));
      const potBefore = Math.max(1, pot);
      const mine = bets.get(a.seat) || 0;
      let r = 0;
      if (a.type === 'bet') r = (a.to - cur) / potBefore;
      else if (a.type === 'raise') r = (a.to - cur) / (potBefore + cur - mine);
      else if (a.type === 'call') r = (cur - mine) / Math.max(1, potBefore - (cur - mine));
      const river = a.street === 'river';
      const before = totalWeight(w);
      const nw = new Float64Array(w);
      for (let k = 0; k < NCOMBO; k++) {
        if (!nw[k]) continue;
        if (t.score[k] < 0) { nw[k] = 0; continue; }
        nw[k] *= postflopLik(a.type, r, t.es[k], t.outs[k], river, prevAggr === seat);
      }
      if (totalWeight(nw) > before * 0.01) w.set(nw);
    }
    pot = a.potAfter ?? pot + (a.amount || 0);
    if (a.to != null && (isAggr(a.type) || a.type.startsWith('post'))) cur = Math.max(cur, a.to);
    if (isAggr(a.type)) lastAggr = a.seat;
    if (a.to != null) bets.set(a.seat, a.to);
  }

  const viewer = view.seats[view.heroSeat];
  const dead = [...view.board];
  if (seat !== view.heroSeat && viewer.holeCards) dead.push(...viewer.holeCards);
  removeDead(w, dead);
  const res = { seat, weights: w, pct: totalWeight(w) / NCOMBO, desc: describeRange(w, view.board) };
  if (cache.size > 300) cache.clear();
  cache.set(key, res);
  return res;
}

/** Ranges of every opponent still in the hand (not folded), from view.heroSeat's perspective. */
export function opponentRanges(view) {
  setTableSize(view);
  const out = [];
  view.seats.forEach((s, i) => {
    if (i === view.heroSeat || s.folded || s.busted || s.sittingOut) return;
    out.push({ ...rangeOf(view, i), name: s.name });
  });
  return out;
}

// ---------- descriptions ----------
const GROUPS = [
  ['big pairs', (h) => h.length === 2 && 'AKQ'.includes(h[0])],
  ['medium pairs', (h) => h.length === 2 && '789TJ'.includes(h[0])],
  ['small pairs', (h) => h.length === 2 && '23456'.includes(h[0])],
  ['AK/AQ', (h) => h[0] === 'A' && 'KQ'.includes(h[1])],
  ['suited aces', (h) => h[0] === 'A' && h[2] === 's' && !'KQ'.includes(h[1])],
  ['suited broadways', (h) => h[2] === 's' && 'KQJT'.includes(h[0]) && 'KQJT'.includes(h[1])],
  ['offsuit broadways', (h) => h[2] === 'o' && 'AKQJT'.includes(h[0]) && 'KQJT'.includes(h[1]) && !(h[0] === 'A' && 'KQ'.includes(h[1]))],
  ['suited connectors', (h) => h[2] === 's' && !'AKQJ'.includes(h[0]) && RANKS.indexOf(h[0]) - RANKS.indexOf(h[1]) <= 2],
  ['weak offsuit hands', (h) => h[2] === 'o' && !'AKQJ'.includes(h[1]) && !(h[0] === 'A')],
  ['offsuit aces', (h) => h[0] === 'A' && h[2] === 'o' && !'KQ'.includes(h[1])],
];

function describeRange(w, board) {
  const tot = totalWeight(w);
  if (tot <= 0) return 'unknown';
  if (!board || board.length < 3) {
    const pct = Math.round((tot / NCOMBO) * 100);
    if (pct >= 85) return 'any two cards (no information yet)';
    const parts = [];
    for (const [name, pred] of GROUPS) {
      let have = 0, all = 0;
      for (const h of CLASSES) if (pred(h)) for (const k of CLASS_COMBOS.get(h)) { all++; have += w[k]; }
      if (all && have / all >= 0.45) parts.push(name);
    }
    return `about ${pct}% of hands${parts.length ? ': ' + parts.slice(0, 5).join(', ') : ''}`;
  }
  const t = boardTable(board);
  const cats = [0, 0, 0, 0, 0];
  let draw = 0;
  for (let k = 0; k < NCOMBO; k++) {
    if (!w[k] || t.score[k] < 0) continue;
    if (t.cat[k] <= 1 && t.outs[k] >= 8 && board.length < 5) draw += w[k];
    else cats[t.cat[k]] += w[k];
  }
  const tw = cats.reduce((a, b) => a + b, 0) + draw;
  const items = [
    ['two pair or better', cats[4]], ['top pair or an overpair', cats[3]], ['middle pairs', cats[2]],
    ['weak pairs', cats[1]], ['strong draws', draw], ['air (nothing yet)', cats[0]],
  ].map(([n, v]) => [n, Math.round((v / tw) * 100)]).filter(([, v]) => v >= 8).sort((a, b) => b[1] - a[1]);
  return items.slice(0, 4).map(([n, v]) => `${n} ${v}%`).join(', ');
}
