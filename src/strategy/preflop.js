// Preflop situation reading + chart lookup. Shared by the range model (opponents) and the policy (hero).
import * as CH from './preflopCharts.js';
import { chen, PREFLOP_STRENGTH } from './combos.js';
import { displayLabel } from '../engine/positions.js';

const { combosOf, SIZING: S } = CH;

const ORDER = ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const POS_NAME = { UTG: 'under the gun', UTG1: 'UTG+1', LJ: 'the lojack', HJ: 'the hijack', CO: 'the cutoff', BTN: 'the button', SB: 'the small blind', BB: 'the big blind' };
// Spoken names follow the table's own labels (engine displayLabel): at 5+ handed the first seat to act reads "UTG".
let tableN = 0;
export function setTableSize(view) { tableN = view?.seats?.filter((x) => x.position).length || 0; }
export const posName = (p) => POS_NAME[tableN ? displayLabel(p, tableN).replace('UTG+1', 'UTG1').replace('BTN/SB', 'BTN') : p] || p;

const AGGR = new Set(['bet', 'raise']);
export const isAggr = (t) => AGGR.has(t);

/** Lookup obj[key], falling back to the nearest position key that exists. */
function near(obj, key) {
  if (!obj) return undefined;
  if (obj[key] !== undefined) return obj[key];
  const i = ORDER.indexOf(key);
  let best, bd = 99;
  for (const k of Object.keys(obj)) {
    const d = Math.abs(ORDER.indexOf(k) - i);
    if (ORDER.indexOf(k) >= 0 && d < bd) { bd = d; best = obj[k]; }
  }
  return best;
}
const byDepth = (obj, depth) => obj[depth] ?? obj[100];

const startStack = (seat) => seat.stack + (seat.totalBet || 0);
/** Seats dealt into this hand. */
export const liveSeats = (view) => view.seats.map((s, i) => i).filter((i) => !view.seats[i].busted && !view.seats[i].sittingOut && view.seats[i].position);

/** Effective stack (bb) for a seat at the start of the hand vs the deepest other dealt-in player. */
export function effectiveBB(view, seat, among) {
  const others = (among || liveSeats(view)).filter((i) => i !== seat);
  const mine = startStack(view.seats[seat]);
  const deep = Math.max(0, ...others.map((i) => startStack(view.seats[i])));
  return Math.min(mine, deep) / view.bigBlind;
}

function depthFor(bb) {
  return bb >= 60 ? 100 : bb >= 40 ? 40 : 25; // THEORY 8.1
}

const newCtx = () => ({ raises: 0, openerSeat: null, threeBettorSeat: null, lastRaiserSeat: null, limpers: [], callers: [], currentTo: 0, lastRaiseAllIn: false, acted: new Map(), openTo: 0, lastRaise: null });

/**
 * Walk preflop actions. Calls onEvent(rec, ctxBefore) for each voluntary action; returns the ctx after all actions.
 */
export function walkPreflop(view, onEvent) {
  const ctx = newCtx();
  ctx.currentTo = view.bigBlind;
  let pot = 0;
  for (const a of view.actions || []) {
    if (a.street !== 'preflop') continue;
    if (a.type.startsWith('post')) { if (a.to > ctx.currentTo) ctx.currentTo = a.to; pot = a.potAfter ?? pot; continue; }
    if (onEvent) onEvent(a, { ...ctx, limpers: ctx.limpers.slice(), callers: ctx.callers.slice(), acted: new Map(ctx.acted) });
    if (isAggr(a.type)) {
      // what the raise added and the pot it was made into, for size-aware defence
      ctx.lastRaise = { to: a.to, added: a.amount, potBefore: pot, callersBefore: ctx.callers.length };
      if (ctx.raises === 0) ctx.openTo = a.to;
      ctx.raises++;
      if (ctx.raises === 1) ctx.openerSeat = a.seat;
      if (ctx.raises === 2) ctx.threeBettorSeat = a.seat;
      ctx.lastRaiserSeat = a.seat;
      ctx.callers = [];
      ctx.currentTo = a.to;
      ctx.lastRaiseAllIn = !!a.allIn;
    } else if (a.type === 'call') {
      if (ctx.raises === 0) ctx.limpers.push(a.seat); else ctx.callers.push(a.seat);
    }
    ctx.acted.set(a.seat, a.type);
    pot = a.potAfter ?? pot;
  }
  return ctx;
}

const premiumish = (h) => chen(h) >= 9;
function subtract(a, b) { const o = {}; for (const [h, f] of Object.entries(a || {})) { const r = f - (b?.[h] || 0); if (r > 0) o[h] = r; } return o; }
function filterMap(m, pred, scale = 1) { const o = {}; for (const [h, f] of Object.entries(m || {})) if (pred(h)) o[h] = Math.min(1, f * scale); return o; }
const union = (a, b) => { const o = { ...(a || {}) }; for (const [h, f] of Object.entries(b || {})) o[h] = Math.min(1, (o[h] || 0) + f); return o; };

/**
 * Stack depth to look up in the push/fold charts. They were solved with a 1bb big-blind ante (2.5bb in the
 * pot); with less dead money a stack is effectively deeper, so look it up deeper (THEORY 2.4: no-ante ranges
 * run narrower). Chart values are capped at 20, meaning "20 or more".
 */
export function pushLookupBB(view, effBB) {
  const dead = (view.smallBlind + view.bigBlind + anteTotal(view)) / view.bigBlind;
  return Math.min(20, effBB * Math.max(1, 2.5 / Math.max(1.5, dead)));
}
function anteTotal(view) {
  return (view.actions || []).filter((a) => a.type === 'post-ante').reduce((t, a) => t + a.amount, 0);
}
export function pushMap(pos, lookBB, hu) {
  return withinStack(CH.PUSH[hu && pos === 'BTN' ? 'SB' : pos] ?? near(CH.PUSH, pos), lookBB);
}
/** Push/fold table {hand: max bb} -> the hands that qualify at this depth. */
function withinStack(table, lookBB) {
  const o = {};
  for (const [h, max] of Object.entries(table)) if (max >= lookBB) o[h] = 1; // lookBB is already capped at 20
  return o;
}
function callPushMap(heroPos, shoverPos, lookBB, hu) {
  const C = CH.CALL_PUSH;
  let t;
  if (heroPos === 'BB') t = near(C.BB, hu && shoverPos === 'BTN' ? 'SB' : shoverPos);
  else if (heroPos === 'SB') t = C.SB[shoverPos]; // only vs the button; anyone else uses the general map
  if (!t) t = C.other;
  return withinStack(t, lookBB);
}

/**
 * Size-aware defence (THEORY 1, MDF). The charts assume a standard raise size. Facing a different size,
 * scale the continuing range by the change in minimum defence frequency: continue = chart share x
 * MDF(actual) / MDF(standard), where MDF = pot before the raise / (pot before + chips the raise added).
 * Tightening drops the weakest continues first (calls before raises); widening adds the best non-chart
 * hands as calls. At the standard size this is a no-op, so the charts are untouched.
 */
function sizeAdjust(spot, view, ctx, stdTo) {
  const R = ctx.lastRaise;
  if (!R || !(stdTo > 0) || R.potBefore <= 0) return;
  const stdAdded = stdTo - (R.to - R.added);
  if (stdAdded <= 0) return;
  const mdf = (x) => R.potBefore / (R.potBefore + x);
  const ratio = Math.max(0.2, Math.min(1.6, mdf(R.added) / mdf(stdAdded)));
  spot.sizeRatio = ratio;
  if (Math.abs(ratio - 1) < 0.06) return;
  const cont = (h) => (spot.raise[h] || 0) + (spot.call[h] || 0);
  let have = 0;
  for (const h of Object.keys(PREFLOP_STRENGTH)) have += combosOf(h) * cont(h);
  if (have <= 0) return;
  const target = Math.min(have * ratio, 1326 * 0.92);
  const order = Object.keys(PREFLOP_STRENGTH).sort((a, b) => PREFLOP_STRENGTH[a] - PREFLOP_STRENGTH[b]); // weakest first
  if (ratio < 1) {
    // re-raise bluffs get pricier faster than value: scale the light part of the raise range by the same ratio
    const light = PREFLOP_STRENGTH.AJo;
    for (const h of Object.keys(spot.raise)) if (PREFLOP_STRENGTH[h] < light) { const d = spot.raise[h] * (1 - ratio); spot.raise[h] -= d; have -= d * combosOf(h); }
    let cut = Math.max(0, have - target);
    for (const h of order) {
      if (cut <= 0) break;
      const c = cont(h);
      if (!c) continue;
      const drop = Math.min(c, cut / combosOf(h));
      // calls go first; the raise share is the value part of the range
      const fromCall = Math.min(spot.call[h] || 0, drop);
      if (fromCall) spot.call[h] -= fromCall;
      if (drop - fromCall > 0) spot.raise[h] = (spot.raise[h] || 0) - (drop - fromCall);
      cut -= drop * combosOf(h);
    }
  } else {
    let add = target - have;
    for (let i = order.length - 1; i >= 0 && add > 0; i--) {
      const h = order[i], room = 1 - cont(h);
      if (room <= 0.001) continue;
      const take = Math.min(room, add / combosOf(h));
      spot.call[h] = (spot.call[h] || 0) + take;
      add -= take * combosOf(h);
    }
  }
}
/** The open size the charts assume for an opener in `pos` (chips). */
function stdOpenTo(view, pos, depth, hu) {
  const t = S.open[depth];
  return (hu ? (depth >= 100 ? 2.5 : 2.2) : t[pos] ?? t.default) * view.bigBlind;
}
/** Iso-raise size over limpers (chips). */
const isoTo = (view, ip, limpers) => ((ip ? S.isoRaise.IP : S.isoRaise.OOP) + S.limpAdd * limpers) * view.bigBlind;

/**
 * What kind of preflop spot is `seat` in, given ctx (state before its action)?
 * Returns { kind, desc, raise: {hand:freq}, call: {hand:freq}, jam: bool, depth, effBB, chart }
 */
export function classifySpot(view, seat, ctx) {
  const live = liveSeats(view);
  const hu = live.length === 2;
  const me = view.seats[seat];
  const pos = me.position;
  const effBB = effectiveBB(view, seat, live);
  const depth = depthFor(effBB);
  const fl = view.betting === 'FL';
  const opener = ctx.openerSeat != null ? view.seats[ctx.openerSeat].position : null;
  const lastRaiser = ctx.lastRaiserSeat != null ? view.seats[ctx.lastRaiserSeat] : null;
  // push/fold: NL at <= 15bb; PL only when a pot-sized raise is most of the stack (~7bb)
  const shortPF = !fl && effBB <= (view.betting === 'PL' ? 7.5 : 15);
  const look = pushLookupBB(view, effBB);
  const spot = { kind: '', desc: '', raise: {}, call: {}, jam: false, depth, effBB, hu, pos };

  if (ctx.raises === 0) {
    const limps = ctx.limpers.length;
    if (shortPF && !(pos === 'BB' && limps === 0)) {
      // the BB shoving over a limp is in a button-like spot, not the SB's first-in one
      spot.kind = 'push'; spot.jam = true; spot.raise = pushMap(pos === 'BB' ? 'BTN' : pos, look, hu && pos !== 'BB');
      spot.desc = `push-or-fold with about ${Math.round(effBB)} big blinds`;
      if (pos === 'BB') spot.call = {}; // check option handled by caller
      return spot;
    }
    if (limps === 0) {
      if (pos === 'BB') { spot.kind = 'bbOption'; spot.desc = 'big blind option'; return spot; }
      spot.kind = 'rfi';
      if (fl) { spot.raise = near(CH.FL.RFI, pos) || {}; spot.desc = `opening from ${posName(pos)} (limit chart)`; }
      else if (hu) {
        spot.raise = byDepth(CH.HU.BTN_RFI, depth) || {};
        spot.desc = `opening heads-up from the button (${depth}bb chart)`;
      }
      else {
        spot.raise = near(byDepth(CH.RFI, depth), pos) || {};
        if (pos === 'SB') spot.call = byDepth(CH.SB_LIMP, depth) || {};
        spot.desc = `first in from ${posName(pos)} (${depth}bb chart)`;
      }
      return spot;
    }
    // facing limpers
    // THEORY 8.1: iso-raise with the RFI range of a seat two positions earlier (SB ~30%); BB checks the rest
    const rfiOf = (p) => (fl ? near(CH.FL.RFI, p) : near(byDepth(CH.RFI, depth), p)) || {};
    const rfi = hu ? (byDepth(CH.HU.BTN_RFI, depth) || {}) : rfiOf(pos);
    if (pos === 'BB') {
      spot.kind = 'bbVsLimp'; spot.desc = 'big blind facing limpers';
      const sbOnly = limps === 1 && view.seats[ctx.limpers[0]].position === 'SB';
      spot.raise = hu ? (byDepth(CH.HU.BB_VS_BTN, depth)?.threeBet || {}) : rfiOf(sbOnly ? 'CO' : 'HJ');
      return spot;
    }
    spot.kind = 'limped'; spot.desc = `${limps} limper${limps > 1 ? 's' : ''} in front`;
    spot.raise = pos === 'SB' ? rfiOf('CO') : rfiOf(ORDER[Math.max(0, ORDER.indexOf(pos) - 2)]);
    spot.call = pos === 'BTN' || pos === 'SB' ? filterMap(subtract(rfi, spot.raise), (h) => h.length === 2 || h[2] === 's', 0.6) : {};
    if (pos === 'SB') spot.call = union(spot.call, byDepth(CH.SB_LIMP, depth));
    return spot;
  }

  const raiserBB = lastRaiser ? (lastRaiser.allIn ? startStack(lastRaiser) / view.bigBlind : 999) : 999;
  if (ctx.raises === 1) {
    if (ctx.lastRaiseAllIn && raiserBB <= 25 && !fl) {
      spot.kind = 'callPush'; spot.desc = `facing an all-in of about ${Math.round(Math.min(raiserBB, effBB))} big blinds`;
      // with a caller already in, the heads-up calling chart no longer applies: price it by pot odds (policy)
      spot.call = ctx.callers.length ? {} : callPushMap(pos, opener, pushLookupBB(view, Math.min(raiserBB, effBB)), hu);
      return spot;
    }
    let t;
    if (fl) t = near(CH.FL.VS_RFI, pos);
    else if (hu) t = byDepth(CH.HU.BB_VS_BTN, depth);
    else t = near(near(byDepth(CH.VS_RFI, depth), pos), opener);
    t = t || {};
    spot.kind = 'vsOpen';
    spot.raise = { ...(t.threeBet || {}) }; spot.call = { ...(t.call || {}) }; // copies: sizeAdjust edits them
    const nCall = ctx.callers.length;
    if (nCall > 0) { // THEORY 8.1 squeeze: halve the low-frequency 3-bet bluffs, call only the top half of the call map
      spot.raise = Object.fromEntries(Object.entries(spot.raise).map(([h, f]) => [h, f < 0.5 ? f * 0.5 : f]));
      const calls = Object.keys(spot.call).sort((a, b) => chen(b) - chen(a));
      const keep = new Set(calls.slice(0, Math.ceil(calls.length / 2)));
      spot.call = filterMap(spot.call, (h) => keep.has(h));
    }
    if (!fl && opener) {
      const isoIP = opener !== 'SB' && opener !== 'BB';
      const std = ctx.limpers.length
        ? isoTo(view, isoIP, ctx.limpers.length)
        : stdOpenTo(view, opener, depthFor(effectiveBB(view, ctx.openerSeat, live)), hu); // the opener's own chart size
      sizeAdjust(spot, view, ctx, std);
      // calling a quarter of the stack or more leaves no room to play: jam or fold with the strong part
      const posted = seat === view.bbSeat ? view.bigBlind : seat === view.sbSeat ? view.smallBlind : 0;
      if (!shortPF && ctx.currentTo - posted >= 0.25 * effBB * view.bigBlind) {
        spot.jam = true;
        spot.raise = union(spot.raise, filterMap(spot.call, (h) => PREFLOP_STRENGTH[h] >= PREFLOP_STRENGTH.AQo));
        spot.call = {};
      }
    }
    if (shortPF) { spot.jam = true; spot.raise = union(spot.raise, filterMap(spot.call, premiumish)); spot.call = filterMap(spot.call, (h) => !premiumish(h) && chen(h) >= 7, 0.5); }
    spot.desc = nCall ? `facing a raise from ${posName(opener)} with ${nCall} caller${nCall > 1 ? 's' : ''} (squeeze spot)` : `facing an open from ${posName(opener)}${fl ? '' : ` (${depth}bb chart)`}`;
    return spot;
  }
  if (ctx.raises === 2) {
    if (seat === ctx.openerSeat) {
      const tbPos = view.seats[ctx.threeBettorSeat].position;
      const ip = isIP(view, seat, ctx.threeBettorSeat);
      let t;
      if (fl) { const rfi = near(CH.FL.RFI, pos) || {}; t = { fourBet: filterMap(rfi, (h) => chen(h) >= 11), call: filterMap(rfi, (h) => chen(h) >= 6 && chen(h) < 11) }; }
      else if (hu) t = byDepth(CH.HU.BTN_VS_3BET, depth);
      else t = near(byDepth(CH.VS_3BET, depth), pos)?.[ip ? 'IP' : 'OOP'];
      t = t || {};
      spot.kind = 'vs3bet'; spot.raise = { ...(t.fourBet || {}) }; spot.call = { ...(t.call || {}) };
      if (!fl && ctx.openTo) {
        const m = isIP(view, ctx.threeBettorSeat, seat) ? S.threeBet.IP : S.threeBet.OOP;
        const k = ctx.lastRaise?.callersBefore || 0;
        sizeAdjust(spot, view, ctx, ctx.openTo * (m + (k ? 1 : 0)) + k * ctx.openTo);
      }
      spot.desc = `facing a 3-bet from ${posName(tbPos)} after opening`;
    } else {
      const t = byDepth(CH.VS_4BET, depth) || {};
      spot.kind = 'cold3bet'; spot.raise = t.jam || {}; spot.call = filterMap(t.call || {}, () => true, 0.6);
      spot.desc = 'facing a raise and a 3-bet (cold)';
    }
  } else if (ctx.raises === 3 && seat === ctx.threeBettorSeat) {
    const t = byDepth(CH.VS_4BET, depth) || {};
    spot.kind = 'vs4bet'; spot.raise = t.jam || {}; spot.call = t.call || {}; spot.jam = true;
    spot.desc = 'facing a 4-bet after 3-betting';
  } else {
    const t = byDepth(CH.VS_4BET, depth) || {};
    spot.kind = 'vs5bet'; spot.raise = filterMap(t.jam || {}, (h) => chen(h) >= 14); spot.call = filterMap(t.jam || {}, () => true); spot.jam = true;
    spot.desc = 'facing a 4-bet or more';
  }
  if (fl) spot.jam = false;
  return spot;
}

/** Is seat a in position on seat b postflop? */
export function isIP(view, a, b) {
  const n = view.seats.length, btn = view.buttonSeat;
  const ord = (s) => (s - btn - 1 + n) % n;
  return ord(a) > ord(b);
}

/** Preflop raise-to size (chips) for a spot, before legal clamping. Sizes from preflopCharts.SIZING. */
export function preflopRaiseTo(view, seat, ctx, spot) {
  const me = view.seats[seat];
  const ipVs = (other) => other != null && isIP(view, seat, other);
  let to;
  if (spot.kind === 'rfi') to = stdOpenTo(view, me.position, spot.depth, spot.hu);
  else if (spot.kind === 'limped' || spot.kind === 'bbVsLimp') to = isoTo(view, me.position !== 'SB' && me.position !== 'BB', ctx.limpers.length);
  else if (spot.kind === 'vsOpen') {
    // squeeze: one size bigger plus one open per caller (THEORY 2.2)
    to = ctx.currentTo * ((ipVs(ctx.openerSeat) ? S.threeBet.IP : S.threeBet.OOP) + (ctx.callers.length ? 1 : 0)) + ctx.callers.length * ctx.currentTo;
  } else if (spot.kind === 'vs3bet' || spot.kind === 'cold3bet') {
    to = spot.depth <= 40 ? Infinity : ctx.currentTo * (ipVs(ctx.lastRaiserSeat) ? S.fourBet.IP : S.fourBet.OOP);
  } else to = Infinity;
  const stackTotal = me.stack + (me.bet || 0);
  if (spot.jam || to >= stackTotal * 0.45) to = stackTotal;
  return to;
}
