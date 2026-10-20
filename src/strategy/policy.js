// Baseline decision engine shared by the bots and the coach.
// analyze(view) -> { options: [{ action, label, kind, freq, ev, why }], facts }
import { equityVsRanges } from './equity.js';
import { rangeOf, opponentRanges, boardTable, drawEquity, viewKey } from './rangeModel.js';
import { makeRng } from '../engine/cards.js';
import { walkPreflop, classifySpot, preflopRaiseTo, isIP, isAggr, setTableSize } from './preflop.js';
import { NCOMBO, COMBO_ID, COMBO_A, COMBO_B, COMBO_CLASS, CLASS_COMBOS, RANKS, cardIdx, handClassOf, drawInfo, drawNames, chen, CLASSES } from './combos.js';
import { evaluate } from '../engine/evaluator.js';

export const BASE_PARAMS = Object.freeze({
  looseness: 0,     // + widens preflop ranges a little (VPIP), - tightens
  aggression: 0,    // + moves some calls into raises, - the reverse
  bluff: 1,         // multiplier on bluff / semi-bluff frequencies
  sizing: 1,        // multiplier on bet sizes
  callDown: 0,      // equity bonus when deciding to call (+ = calls wider)
  slowplay: 0,      // extra slowplay / check-raise frequency with monsters
  overbet: 0,       // extra chance to pick the big (overbet) size
  riverPressure: 0, // extra river bluffing
  ipAggro: 0,       // extra betting frequency in position
  bluffRaise: 0,    // extra bluff-raise frequency
});

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// ---------- helpers ----------
function legalize(view, to) {
  const legal = view.legal;
  if (!(legal.canBet || legal.canRaise)) return null;
  const type = legal.canBet ? 'bet' : 'raise';
  // never put in more than the deepest opponent can match
  const cover = Math.max(0, ...view.seats.map((s, i) => (i !== view.heroSeat && !s.folded && !s.busted ? s.stack + s.bet : 0)));
  if (cover > 0 && to > cover) to = cover;
  to = Math.round(to);
  // all-in only when the format allows it (NL, or a PL/FL stack that is already short)
  const canJam = legal.maxTo >= legal.allInTo;
  // NL: a bet that leaves less than ~a quarter of the pot behind should just be all-in
  if (canJam && (to >= legal.allInTo || legal.allInTo - to < 0.25 * (legal.pot + 2 * to))) to = legal.allInTo;
  else to = clamp(to, legal.minTo, legal.maxTo);
  return { type, to };
}

function actionLabel(action, legal) {
  switch (action.type) {
    case 'fold': return 'Fold';
    case 'check': return 'Check';
    case 'call': return legal ? `Call ${legal.callAmount}` : 'Call';
    default: {
      const allIn = legal && action.to === legal.allInTo;
      return `${action.type === 'bet' ? 'Bet' : 'Raise to'} ${action.to}${allIn ? ' (all-in)' : ''}`;
    }
  }
}

/** Board texture summary. */
function boardTexture(board) {
  if (board.length < 3) return null;
  const suits = [0, 0, 0, 0], ranks = new Uint8Array(13);
  for (const c of board) { suits[cardIdx(c) & 3]++; ranks[cardIdx(c) >> 2]++; }
  const maxSuit = Math.max(...suits);
  const paired = ranks.some((n) => n >= 2);
  let conn = 0;
  for (let lo = -1; lo <= 8; lo++) {
    let n = 0;
    for (let r = lo; r < lo + 5; r++) if (ranks[r < 0 ? 12 : r]) n++;
    conn = Math.max(conn, n);
  }
  const high = 12 - [...ranks].reverse().findIndex((n) => n > 0);
  const flushy = board.length === 3 ? maxSuit >= 2 : maxSuit >= 3;
  const wet = (flushy ? 1 : 0) + (maxSuit >= 3 ? 1 : 0) + (conn >= 3 ? 1 : 0) + (conn >= 4 ? 1 : 0);
  const parts = [];
  if (maxSuit >= 3) parts.push(maxSuit >= 4 ? 'four to a flush' : board.length === 3 ? 'monotone' : 'three to a flush');
  else if (maxSuit === 2 && board.length === 3) parts.push('two-tone');
  if (conn >= 4) parts.push('very connected'); else if (conn >= 3) parts.push('connected');
  if (paired) parts.push('paired');
  const desc = `${wet === 0 ? 'dry' : wet >= 3 ? 'very wet' : 'wet'}${parts.length ? ' (' + parts.join(', ') + ')' : ''}, ${RANK_NAME[RANKS[high]].toLowerCase()}-high`;
  return { wet, dry: wet === 0 || (paired && wet <= 1 && conn < 3), paired, maxSuit, conn, high, desc };
}

/** Keep the top `frac` (by weight) of a range by effective strength on this board. */
function topFraction(w, es, frac) {
  const ks = [];
  let tot = 0;
  for (let k = 0; k < NCOMBO; k++) if (w[k] > 0) { ks.push(k); tot += w[k]; }
  ks.sort((a, b) => es[b] - es[a]);
  const out = new Float64Array(NCOMBO);
  let acc = 0;
  for (const k of ks) { if (acc >= frac * tot) break; out[k] = w[k]; acc += w[k]; }
  return out;
}

function rangeStats(w, t) {
  let tot = 0, mean = 0, nuts = 0;
  for (let k = 0; k < NCOMBO; k++) {
    if (!w[k] || t.score[k] < 0) continue;
    tot += w[k]; mean += w[k] * t.hs[k]; if (t.hs[k] >= 0.93) nuts += w[k];
  }
  return tot ? { mean: mean / tot, nuts: nuts / tot, tot } : { mean: 0.5, nuts: 0, tot: 0 };
}

/** Weighted percentile of value x within a range (by es). */
function pctlIn(w, es, x) {
  let below = 0, tot = 0;
  for (let k = 0; k < NCOMBO; k++) if (w[k] > 0) { tot += w[k]; if (es[k] < x) below += w[k]; else if (es[k] === x) below += w[k] / 2; }
  return tot ? below / tot : 0.5;
}

/** Merge identical actions, drop near-zero ones, renormalise, label. */
function finalize(options, legal) {
  const map = new Map();
  for (const o of options) {
    if (!o.action || !(o.freq > 0.0005)) continue;
    const key = o.action.type + (o.action.to ?? '');
    const prev = map.get(key);
    if (prev) { prev.freq += o.freq; prev.ev ??= o.ev; }
    else map.set(key, { ...o });
  }
  let list = [...map.values()];
  const tot = list.reduce((a, o) => a + o.freq, 0);
  if (!tot) list = [{ action: { type: legal.canCheck ? 'check' : 'fold' }, kind: legal.canCheck ? 'check' : 'fold', freq: 1, why: 'default' }];
  else for (const o of list) o.freq /= tot;
  for (const o of list) o.label = actionLabel(o.action, legal);
  return list.sort((a, b) => b.freq - a.freq);
}

// ---------- main ----------
export function analyze(view, params = BASE_PARAMS) {
  setTableSize(view);
  const legal = view.legal;
  if (!legal) return null;
  const P = { ...BASE_PARAMS, ...params };
  const hero = view.heroSeat, me = view.seats[hero];
  const { pot, callAmount: toCall } = legal;
  const opps = opponentRanges(view);
  const oppSeats = opps.map((o) => o.seat);
  const effBehind = Math.min(me.stack, Math.max(0, ...oppSeats.map((s) => view.seats[s].stack + view.seats[s].bet - me.bet)));
  const facts = {
    street: view.street, pot, toCall, potOdds: toCall > 0 ? toCall / (pot + toCall) : 0,
    villains: opps.map((o) => ({ name: o.name, desc: o.desc, pct: o.pct })),
    spr: pot > 0 ? effBehind / pot : 0, ip: oppSeats.every((s) => isIP(view, hero, s)), effStackBB: effBehind / view.bigBlind,
  };
  const options = view.street === 'preflop' ? preflopDecision(view, P, facts, opps) : postflopDecision(view, P, facts, opps);
  return { options: finalize(options, legal), facts };
}

// ---------- preflop ----------
function preflopDecision(view, P, facts, opps) {
  const legal = view.legal, hero = view.heroSeat, me = view.seats[hero];
  const h = handClassOf(me.holeCards[0], me.holeCards[1]);
  const ctx = walkPreflop(view);
  const spot = classifySpot(view, hero, ctx);
  Object.assign(facts, {
    spotKind: spot.kind, handClass: h, handName: preflopName(h), effStackBB: spot.effBB, depth: spot.depth, heroPos: me.position,
    openerPos: ctx.openerSeat != null ? view.seats[ctx.openerSeat].position : null, betting: view.betting,
  });
  let r = spot.raise[h] || 0, c = spot.call[h] || 0;

  // personality: looseness widens edges / tightens mixes, aggression moves call <-> raise
  // looseness only widens normal spots: never adds -EV shoves or all-in calls
  const jamSpot = spot.jam || spot.kind === 'push' || spot.kind === 'callPush';
  if (P.looseness > 0 && r + c === 0 && !jamSpot) {
    const inRange = CLASSES.filter((x) => (spot.raise[x] || 0) + (spot.call[x] || 0) > 0.5).map(chen);
    const minChen = inRange.length ? Math.min(...inRange) : 99;
    if (chen(h) >= minChen) (Object.keys(spot.call).length ? (c = P.looseness * 1.5) : (r = P.looseness * 1.5));
  } else if (P.looseness < 0) { if (r < 1) r *= 1 + P.looseness * 4; if (c < 1) c *= 1 + P.looseness * 4; }
  if (P.aggression > 0 && r > 0) { const m = c * P.aggression * 2; r += m; c -= m; }
  if (P.aggression < 0 && c > 0) { const m = r * -P.aggression * 2; r -= m; c += m; }
  if (spot.kind === 'bbOption' || spot.kind === 'bbVsLimp') c = 1 - r; // checking is free
  r = clamp(r, 0, 1); c = clamp(c, 0, 1 - r);
  facts.chart = { raise: r, call: c, fold: 1 - r - c };

  // Shown equity = the shared number (vs the players who put money in); also used for all-in decisions.
  const shown = heroEquity(view, opps);
  const eq = shown.equity;
  facts.equity = eq;
  facts.equityVs = shown.names;
  facts.behind = opps.length - shown.n; // players still to act who can wake up with a hand
  facts.ipVsRaiser = ctx.lastRaiserSeat != null ? isIP(view, hero, ctx.lastRaiserSeat) : null;
  const opts = [];
  const raiseAct = legalize(view, preflopRaiseTo(view, hero, ctx, spot));
  const facingAllIn = opps.some((o) => view.seats[o.seat].allIn && view.seats[o.seat].bet >= view.seats[hero].bet + legal.callAmount - 0.5) && !legal.canCheck;
  const bigCall = !legal.canCheck && (legal.callAmount >= me.stack * 0.5 || facingAllIn);
  if (bigCall && (spot.kind !== 'callPush' || Object.keys(spot.call).length === 0)) {
    // Pot-odds decision vs the shover's range (chip EV).
    const req = facts.potOdds;
    const pc = sigmoid((eq + P.callDown - req) / 0.02);
    facts.requiredEquity = req;
    const shove = !facingAllIn && legal.canRaise && eq > 0.6 ? legalize(view, legal.allInTo) : null;
    if (shove) opts.push({ action: shove, kind: 'raise', freq: pc * 0.7, why: 'value-shove' });
    opts.push({ action: { type: 'call' }, kind: 'call', freq: shove ? pc * 0.3 : pc, why: 'pot-odds', ev: eq * (legal.pot + legal.callAmount) - legal.callAmount });
    opts.push({ action: { type: 'fold' }, kind: 'fold', freq: 1 - pc, why: 'pot-odds', ev: 0 });
    return opts;
  }
  if (!raiseAct) { c += r; r = 0; }
  if (r > 0) opts.push({ action: raiseAct, kind: legal.canBet ? 'bet' : 'raise', freq: r, why: spot.kind === 'push' ? 'push-fold' : 'chart' });
  if (legal.canCheck) opts.push({ action: { type: 'check' }, kind: 'check', freq: 1 - r, why: 'chart' });
  else {
    if (c > 0) opts.push({ action: { type: 'call' }, kind: 'call', freq: c, why: 'chart', ev: eq * 0.85 * (legal.pot + legal.callAmount) - legal.callAmount });
    opts.push({ action: { type: 'fold' }, kind: 'fold', freq: 1 - r - c, why: 'chart', ev: 0 });
  }
  return opts;
}

export const RANK_NAME = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: 'Ten', 9: 'Nine', 8: 'Eight', 7: 'Seven', 6: 'Six', 5: 'Five', 4: 'Four', 3: 'Three', 2: 'Two' };
export function preflopName(h) {
  if (h.length === 2) return `Pocket ${h[0] === '6' ? 'Sixes' : RANK_NAME[h[0]] + 's'}`;
  return `${RANK_NAME[h[0]]}-${RANK_NAME[h[1]]} ${h[2] === 's' ? 'suited' : 'offsuit'}`;
}

// ---------- shared equity (coach, live aid and bots use the same number) ----------
function seedOf(view) {
  const s = viewKey(view);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
/**
 * Hero equity, the one number the coach, the live aid and the bots share. Deterministic per view.
 * Postflop: vs every opponent still in the hand. Preflop: vs the players who have put money in voluntarily
 * (players still to act usually fold; the coach mentions them separately), or vs everyone if nobody has.
 */
export function heroEquity(view, opps = opponentRanges(view)) {
  const me = view.seats[view.heroSeat];
  if (!opps.length) return { equity: 1, vs: 'random hands', n: 0, names: [] };
  let use = opps;
  if (view.street === 'preflop') {
    const actors = opps.filter((o) => (view.actions || []).some((a) => a.seat === o.seat && a.street === 'preflop' && (a.type === 'call' || isAggr(a.type))));
    if (actors.length) use = actors;
  }
  const informed = use.some((o) => o.pct < 0.85);
  const res = equityVsRanges(me.holeCards, view.board, use.map((o) => o.weights), { iterations: 3000, rng: makeRng(seedOf(view)) });
  return { equity: res.equity, vs: informed ? 'estimated ranges' : 'random hands', n: use.length, names: use.map((o) => o.name) };
}
/** Heads-up equity vs one opponent (e.g. the main aggressor in a multiway pot). */
function huEquity(view, o) {
  return equityVsRanges(view.seats[view.heroSeat].holeCards, view.board, [o.weights], { iterations: 2000, rng: makeRng(seedOf(view) ^ o.seat) }).equity;
}

// ---------- postflop ----------
/** Every combo's strength vs the opponents' current ranges: chance to beat all of them now (+ draw equity). */
function strengthVs(t, ranges, boardLen) {
  const lists = ranges.map((w) => {
    const ks = t.live.filter((k) => w[k] > 0); // t.live is sorted by score
    const sc = new Int32Array(ks.length), cum = new Float64Array(ks.length);
    let c = 0;
    ks.forEach((k, i) => { sc[i] = t.score[k]; c += w[k]; cum[i] = c; });
    return { sc, cum, tot: c };
  });
  const bound = (a, x, strict) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (strict ? a[m] <= x : a[m] < x) lo = m + 1; else hi = m; } return lo; };
  const made = new Float64Array(NCOMBO), s = new Float64Array(NCOMBO);
  for (const k of t.live) {
    const x = t.score[k];
    let p = 1;
    for (const L of lists) {
      if (!L.tot) { p *= 0.5; continue; }
      const lo = bound(L.sc, x, false), hi = bound(L.sc, x, true);
      const below = lo ? L.cum[lo - 1] : 0, eq = (hi ? L.cum[hi - 1] : 0) - below;
      p *= (below + eq / 2) / L.tot;
    }
    made[k] = p;
    s[k] = p + (1 - p) * drawEquity(t.outs[k], boardLen);
  }
  return { s, made };
}

/** Flop c-bet frequency and size (THEORY 3.2 / 8.2). */
function cbetPlan(tex, ip, adv, threeBetPot) {
  const hi = tex.high, akHigh = hi >= 11;
  let F, b;
  if (tex.maxSuit >= 3) { F = 0.42; b = 0.3; }
  else if (tex.paired) { F = 0.78; b = 0.3; }
  else if (akHigh && tex.conn < 3) { F = tex.maxSuit === 2 ? 0.75 : 0.85; b = 0.3; }
  else if (hi >= 9 && tex.conn >= 3) { F = 0.52; b = 0.45; }
  else if (hi <= 7 && tex.conn >= 3) { F = 0.38; b = 0.7; }
  else if (tex.conn >= 3 || tex.wet >= 2) { F = 0.42; b = 0.66; }
  else if (hi <= 6) { F = 0.65; b = 0.33; }
  else { F = 0.7; b = 0.33; }
  if (!ip) {
    if (akHigh && adv > 0.55) F *= 0.9;
    else if (hi <= 10 && tex.conn >= 2 && adv < 0.56) { F = 0.1; b = 0.66; }
    else { F *= 0.5; b = Math.max(b, 0.5); }
  }
  if (threeBetPot) { b = Math.min(b, 0.33); if (akHigh) F = Math.max(F, 0.7); }
  return { F: clamp(F + (adv - 0.5) * 0.5, 0.05, 0.95), b };
}

const SIZE_WORD = (b) => (b <= 0.36 ? 'a small bet (about a third of the pot)' : b <= 0.55 ? 'a medium bet (about half the pot)' : b <= 0.8 ? 'a big bet (two-thirds to three-quarters of the pot)' : b <= 1.05 ? 'a pot-sized bet' : 'an overbet');
const pc0 = (x) => `${Math.round(x * 100)}%`;

function postflopDecision(view, P, facts, opps) {
  const legal = view.legal, hero = view.heroSeat, me = view.seats[hero];
  const board = view.board, hc = me.holeCards, street = view.street;
  const river = street === 'river', fl = view.betting === 'FL', nl = view.betting === 'NL';
  const pot = legal.pot, toCall = legal.callAmount;
  const n = opps.length, mw = n >= 2;
  const t = boardTable(board);
  const hk = COMBO_ID[cardIdx(hc[0]) * 52 + cardIdx(hc[1])];
  const ev7 = evaluate([...hc, ...board]);
  const d = drawInfo(cardIdx(hc[0]), cardIdx(hc[1]), board.map(cardIdx));
  const tex = boardTexture(board);
  const ranges = opps.map((x) => x.weights);
  const e = heroEquity(view, opps).equity;
  const myRange = rangeOf(view, hero).weights;
  const SV = strengthVs(t, ranges, board.length);
  const hs = SV.s[hk], hMade = SV.made[hk];
  const pctl = pctlIn(myRange, SV.s, hs);
  const myStats = rangeStats(myRange, t);
  const vStats = opps.map((x) => rangeStats(x.weights, t));
  const vMean = vStats.reduce((a, s) => a + s.mean, 0) / n, vNuts = Math.max(...vStats.map((s) => s.nuts));
  const rangeAdv = clamp(0.5 + (myStats.mean - vMean), 0, 1), nutAdv = myStats.nuts - vNuts;
  const notes = [];
  Object.assign(facts, {
    equity: e, equityVs: opps.map((x) => x.name), handName: ev7.name, category: ev7.category, draws: drawNames(d), outs: river ? 0 : d.outs,
    texture: tex, strength: hs, notes,
  });
  const ip = facts.ip, spr = facts.spr, seed = seedOf(view);
  const prevAggr = lastAggressorOn(view, STREETS[STREETS.indexOf(street) - 1]); // initiative: only the previous street counts
  const hadInit = prevAggr === hero;
  const oppInit = prevAggr != null && prevAggr !== hero && opps.some((x) => x.seat === prevAggr);
  const capped = opps.every((x) => !aggressedSince(view, x.seat));
  const threeBetPot = (view.actions || []).filter((a) => a.street === 'preflop' && isAggr(a.type)).length >= 2;
  const commit = spr < 2 && (t.cat[hk] >= 3 || d.outs >= 12);
  const options = [];
  if (mw) {
    const aggr = opps.find((x) => x.seat === (toCall > 0 ? lastAggressorOn(view, street) : prevAggr)) || opps[0];
    facts.equityHU = { name: aggr.name, equity: huEquity(view, aggr) };
  }
  const blockFactor = clamp(blockerShare(t, hc, opps) / 0.09, 0.5, 1.7);

  if (toCall === 0) {
    // ---- check or bet: build hero's whole betting range, then read off this hand (THEORY 8.2) ----
    let F = null, b;
    if (street === 'flop') {
      if (hadInit) ({ F, b } = cbetPlan(tex, ip, rangeAdv, threeBetPot));
      else if (oppInit) { F = 0.04; b = 0.5; } // donk bets are rare
      else { F = ip ? 0.5 : 0.35; b = 0.5; }
      if (mw) { F = Math.min(F, 0.3); b = Math.max(b, 0.5); }
    } else b = river ? 0.72 : 0.7;
    b *= P.sizing * (ip ? 1 + P.ipAggro : 1);
    const canBig = !fl && !mw && capped && nutAdv >= 0 && street !== 'flop';
    const bBig = nl ? (river ? 1.4 : 1.25) * (1 + P.overbet * 0.3) : 1;
    const callShare = (x) => (1 / (1 + x)) * (street === 'flop' ? 0.85 : street === 'turn' ? 0.9 : 1);
    // value needs ~55%+ equity vs the hands that call: with a share x of their range beaten and the top c calling, that is x >= 1 - 0.45c
    const vThr = (x) => clamp(1 - 0.45 * callShare(x) + (mw ? 0.05 : 0) - (fl ? 0.05 : 0), 0.55, 0.95);
    const thrStd = vThr(b), thrThin = river && !mw && !fl ? vThr(0.33) : thrStd;
    const slowOf = (s) => (s >= 0.95 && tex.dry && !fl && !mw && !river ? 0.25 + P.slowplay : fl || mw || tex.wet >= 2 || river ? 0.03 : 0.08);
    const donk = oppInit && !ip;
    let Wbig = 0, Wstd = 0, Wthin = 0, WD = 0, Wd = 0, WA = 0, WM = 0, W = 0;
    for (const k of t.live) {
      const w = myRange[k];
      if (!w) continue;
      W += w;
      const s = SV.s[k];
      if (s >= thrStd) { const v = w * (1 - slowOf(s)); if (canBig && s >= 0.93) Wbig += v; else Wstd += v; }
      else if (s >= thrThin) Wthin += w;
      else if (!river && t.outs[k] >= 8) WD += w;
      else if (!river && t.outs[k] >= 4) Wd += w;
      else if (SV.made[k] < 0.35) WA += w;
      else WM += w;
    }
    const sh = (x) => (W ? x / W : 0);
    const valueShare = sh(Wbig + Wstd) * (donk ? 0.12 : 1);
    const ratio = (x) => x / (1 + x); // bluff combos per value combo (THEORY table 1)
    let B = F != null ? Math.max(F - valueShare - sh(Wthin), valueShare * ratio(b))
      : (sh(Wstd) * ratio(b) + sh(Wbig) * ratio(bBig)) * (river ? 1 : 1.4) * (donk ? 0.12 : 1);
    if (mw) B *= 0.35;
    if (fl && river) B *= 0.6;
    B *= P.bluff * (river ? 1 + P.riverPressure : 1) * (ip ? 1 + P.ipAggro : 1);
    const fill = {};
    let rem = B;
    for (const [tier, w] of [['D', sh(WD)], ['d', sh(Wd)], ['A', sh(WA)], ['M', sh(WM)]]) {
      fill[tier] = w > 0 ? clamp(rem / w, 0, 1) : 0;
      rem -= fill[tier] * w;
    }
    let tier, pBet, why;
    if (hs >= thrStd) { tier = 'value'; pBet = 1 - slowOf(hs); why = 'value'; if (donk) pBet *= 0.12; }
    else if (hs >= thrThin) { tier = 'thin'; pBet = 0.75; why = 'thin-value'; }
    else if (!river && d.outs >= 8) { tier = 'D'; pBet = fill.D; why = 'semi-bluff'; }
    else if (!river && d.outs >= 4) { tier = 'd'; pBet = fill.d; why = 'semi-bluff'; }
    else if (hMade < 0.35) { tier = 'A'; pBet = fill.A * (river ? blockFactor : 1); why = 'bluff'; }
    else { tier = 'M'; pBet = fill.M; why = F != null && F > 0.6 ? 'range-bet' : 'protection'; }
    if (commit && (tier === 'value' || tier === 'thin' || d.outs >= 12)) { pBet = Math.max(pBet, 0.9); why = 'commit'; }
    pBet = clamp(pBet, 0, 1);
    facts.plan = { F, tier, hadInit };
    if (F != null && hadInit) notes.push(`As the preflop raiser on this ${tex.desc} flop, strong players c-bet (bet again) about ${pc0(F)} of the time, using ${SIZE_WORD(b)}.`);
    else if (donk) notes.push('The last aggressor acts after you, so strong players mostly check to them (leading out, a "donk bet", is rare).');
    if (river && tier !== 'M') notes.push(`A balanced river bet of this size is about ${pc0(b / (1 + 2 * b))} bluffs (value to bluff about ${((1 + b) / b).toFixed(1)} to 1).`);
    if (commit) notes.push(`The stack-to-pot ratio is only ${spr.toFixed(1)}: with top pair or better, or a big draw, plan to get all-in.`);
    if (mw && tier === 'A') notes.push('Bluffing into two or more players rarely works: every one of them has to fold.');

    const sizeFor = (x) => legalize(view, me.bet + x * pot);
    const std = sizeFor(commit ? 9 : b), big = canBig ? sizeFor(bBig) : null, thin = sizeFor(0.33);
    if (!std) return [{ action: { type: 'check' }, kind: 'check', freq: 1, why: 'no-bet', ev: e * pot }];
    const Rr = river ? 1 : ip ? 0.95 : 0.85;
    const evOf = (act) => betEV(act.to - me.bet, pot, opps, t, hc, board, Rr, seed);
    let bigShare = 0;
    if (big && tier === 'value' && hs >= 0.93) bigShare = 1;
    else if (big && (tier === 'A' || tier === 'D' || tier === 'd') && Wbig + Wstd > 0) bigShare = Wbig / (Wbig + Wstd);
    const mainAct = tier === 'thin' ? thin : std;
    if (bigShare < 1) options.push({ action: mainAct, kind: 'bet', freq: pBet * (1 - bigShare), why, ev: evOf(mainAct), pf: (mainAct.to - me.bet) / pot });
    if (bigShare > 0) options.push({ action: big, kind: 'bet', freq: pBet * bigShare, why: why === 'value' ? 'polar-value' : why, ev: evOf(big), pf: (big.to - me.bet) / pot });
    const checkWhy = pBet > 0.5 ? (tier === 'value' ? 'trap' : 'balance') : donk && tier !== 'M' ? 'check-to-raiser'
      : tier === 'A' ? 'give-up' : tier === 'value' ? 'trap' : tier === 'D' || tier === 'd' ? 'free-card' : 'pot-control';
    options.push({ action: { type: 'check' }, kind: 'check', freq: 1 - pBet, why: checkWhy, ev: e * pot * Rr });
    return options;
  }

  // ---- facing a bet or raise ----
  const req = facts.potOdds;
  const bFace = toCall / Math.max(1, pot - toCall);
  const mdf = 1 / (1 + bFace);
  const allInCall = toCall >= me.stack;
  const facingRaise = (view.actions || []).some((a) => a.street === street && a.seat === hero && isAggr(a.type));
  const bonus = !river && d.outs >= 8 && spr > 3 && !allInCall ? (ip ? 0.06 : 0.03) : 0; // implied odds (THEORY 8.2)
  const R = river || fl || allInCall ? 1 : ip ? 0.97 : 0.9; // equity realization
  Object.assign(facts, { requiredEquity: Math.max(0, req - bonus), mdf, facingRaise });
  const eAdj = e * R + P.callDown;
  let pCall = sigmoid((eAdj - (req - bonus) - (facingRaise && river ? 0.05 : 0)) / 0.02);
  let callWhy = d.outs >= 8 && !river ? (bonus ? 'implied-odds' : 'draw-odds') : e >= 0.6 ? 'value-call' : 'bluff-catch';
  // MDF floor vs bets (not raises), heads-up: keep the best (MDF - margin) of the range (THEORY 1, 8.2)
  let defend = null;
  if (!facingRaise && !mw) {
    defend = clamp(mdf - (street === 'flop' ? 0.1 : street === 'turn' ? 0.05 : 0), 0, 1);
    const floor = e >= req * 0.5 ? clamp(0.5 + (pctl - (1 - defend)) / 0.06, 0, 1) : 0;
    if (floor > pCall) { pCall = floor; if (floor > 0.5) callWhy = 'mdf-defend'; }
  }
  if (commit) pCall = 1;
  const evCall = e * R * (pot + toCall) - toCall;
  let pRaise = 0, rwhy = '', evRaise;
  const curBet = me.bet + toCall;
  let raiseTo = facingRaise ? curBet * 2.5 : curBet * (bFace <= 0.5 ? 3.2 : 2.6);
  if (spr < 2.5 || raiseTo - me.bet > 0.6 * me.stack) raiseTo = legal.allInTo;
  const raiseAct = legal.canRaise && !allInCall ? legalize(view, raiseTo) : null;
  if (raiseAct) {
    const A = raiseAct.to - me.bet, V = raiseAct.to - curBet;
    const c = clamp((pot + toCall) / (pot + toCall + V), 0.2, 0.95);
    const sub = opps.map((x) => topFraction(x.weights, t.es, c));
    const eC = equityVsRanges(hc, board, sub, { iterations: 1200, rng: makeRng(seed + 7) }).equity;
    const fe = Math.pow(1 - c, n);
    evRaise = fe * pot + (1 - fe) * (eC * (pot + A + V) - A);
    let rFrac = street === 'flop' ? (tex.maxSuit >= 3 ? 0.05 : tex.high >= 11 && tex.dry ? 0.06 : tex.high <= 7 && tex.conn >= 3 ? 0.18 : 0.11) : street === 'turn' ? 0.09 : 0.07;
    if (ip) rFrac *= 0.8;
    if (facingRaise) rFrac = 0.04;
    if (fl) rFrac *= 1.5;
    if (mw) rFrac *= 0.6;
    if ((pctl >= 1 - rFrac * 0.65 && e >= 0.55 && eC >= 0.5) || (e >= 0.8 && eC >= 0.55)) {
      rwhy = 'value-raise';
      pRaise = (fl ? 0.95 : 0.8) * (1 + P.aggression);
      if (hs >= 0.95 && tex.dry && !river && !fl) pRaise -= 0.2 + P.slowplay;
      if (!ip) pRaise += P.slowplay * 0.5;
    } else if (!river && d.outs >= 8 && !facingRaise) {
      let WD = 0, W = 0;
      for (const k of t.live) if (myRange[k]) { W += myRange[k]; if (t.outs[k] >= 8) WD += myRange[k]; }
      rwhy = 'semi-bluff';
      pRaise = clamp((rFrac * 0.35) / Math.max(0.02, WD / Math.max(W, 1e-9)), 0, 0.6) * (mw ? 0.35 : 1) * P.bluff + P.bluffRaise;
    } else if (river && hMade < 0.3 && !mw && !facingRaise) {
      rwhy = 'bluff'; pRaise = (0.02 + P.bluffRaise) * P.bluff * blockFactor;
    }
    if (commit && e >= 0.4) { pRaise = Math.max(pRaise, 0.5); rwhy = rwhy || 'commit'; }
    pRaise = clamp(pRaise, 0, 0.95);
  }
  if (facingRaise && river) notes.push('A river raise is a value-heavy line: call only with hands that beat some of their value hands, not just their bluffs.');
  else if (defend != null) notes.push(`Against ${SIZE_WORD(bFace)} you need ${pc0(req)} equity, and you should keep playing with roughly ${pc0(defend)} of your range (MDF${river ? '' : ', minus a little because their bluffs still have outs'}).`);
  if (bonus) notes.push(`Deep stacks behind make this draw worth more than the pot odds say (implied odds, about ${Math.round(bonus * 100)}% equity).`);
  if (commit) notes.push(`The stack-to-pot ratio is only ${spr.toFixed(1)}: this hand is strong enough to commit.`);
  if (raiseAct && pRaise > 0) options.push({ action: raiseAct, kind: 'raise', freq: pRaise, why: rwhy, ev: evRaise });
  const rest = 1 - (raiseAct ? pRaise : 0);
  options.push({ action: { type: 'call' }, kind: 'call', freq: rest * pCall, why: callWhy, ev: evCall });
  options.push({ action: { type: 'fold' }, kind: 'fold', freq: rest * (1 - pCall), why: facingRaise && river ? 'river-raise' : 'pot-odds', ev: 0 });
  return options;
}

const STREETS = ['preflop', 'flop', 'turn', 'river'];
/** Did this seat bet or raise on the previous or the current postflop street? */
function aggressedSince(view, seat) {
  const si = STREETS.indexOf(view.street);
  return (view.actions || []).some((a) => a.seat === seat && isAggr(a.type) && a.street !== 'preflop' && STREETS.indexOf(a.street) >= si - 1);
}
/** Last seat to bet or raise on `street`, or null. */
function lastAggressorOn(view, street) {
  const acts = (view.actions || []).filter((a) => a.street === street && isAggr(a.type));
  return acts.length ? acts[acts.length - 1].seat : null;
}
/** Share of the opponents' strong hands that hero's cards block (hero's cards are dead in the model, so estimate the blocked combos from their hand class). Random cards block ~9%. */
function blockerShare(t, hc, opps) {
  const h0 = cardIdx(hc[0]), h1 = cardIdx(hc[1]);
  let blk = 0, tot = 0;
  for (const o of opps) {
    const w = o.weights;
    for (let k = 0; k < NCOMBO; k++) {
      if (t.score[k] < 0 || t.es[k] < 0.66) continue;
      const a = COMBO_A[k], b = COMBO_B[k];
      if (a === h0 || a === h1 || b === h0 || b === h1) blk += classAvg(w, k);
      else tot += w[k];
    }
  }
  return tot + blk ? blk / (tot + blk) : 0.09;
}
function classAvg(w, k) {
  let s = 0, c = 0;
  for (const j of CLASS_COMBOS.get(COMBO_CLASS[k])) if (w[j] > 0) { s += w[j]; c++; }
  return c ? s / c : 0;
}

function betEV(s, pot, opps, t, hc, board, R, seed) {
  const c = clamp(pot / (pot + s), 0.25, 0.95);
  const sub = opps.map((x) => topFraction(x.weights, t.es, c));
  const eCall = equityVsRanges(hc, board, sub, { iterations: 1200, rng: makeRng(seed + Math.round(s)) }).equity;
  const fe = Math.pow(1 - c, opps.length);
  return fe * pot + (1 - fe) * (eCall * R * (pot + 2 * s) - s);
}

export function sample(options, rng = Math.random) {
  let x = rng();
  for (const o of options) { x -= o.freq; if (x <= 0) return o; }
  return options[options.length - 1];
}
