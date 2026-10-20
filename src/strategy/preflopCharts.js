// Preflop range data (research agent). Plain ES module: no DOM, runs in Node and the browser.
//
// Range strings: comma-separated tokens like "22+", "A2s+", "KTo+", "76s", "T9s-65s", "A5s:0.5"
// (":f" = mix frequency 0..1, default 1). Later tokens override earlier ones, and ":0" removes a hand,
// so "A2s+,A9s-A6s:0.5" means every suited ace, with A9s..A6s at half frequency.
// Also accepted: "AK" (= AKs + AKo), pair dashes "88-55", fixed-top dashes "A5s-A2s".
//
// Sources / assumptions (see docs/THEORY.md for detail):
// - 100bb: cash, 8-max, 2.5bb opens (SB 3bb), no ante, no rake. Approximates modern solver charts.
// - 40bb / 25bb: tournament, chip-EV, 8-max, ~12.5% ante (BB-ante of 1bb).
// - PUSH/CALL_PUSH: solved offline (chip-EV push/fold Nash approximation, BB-ante 1bb); see that section.

const R = 'AKQJT98765432'; // index 0 = Ace (highest)
const ri = (c) => {
  const i = R.indexOf(c);
  if (i < 0) throw new Error(`bad rank "${c}"`);
  return i;
};
const name = (a, b, t) => (a === b ? R[a] + R[a] : R[Math.min(a, b)] + R[Math.max(a, b)] + t);

/** All 169 hand classes, strongest-rank first ('AA','AKs','AKo',...). */
export const ALL_HANDS = [];
for (let a = 0; a < 13; a++) for (let b = a; b < 13; b++) {
  if (a === b) ALL_HANDS.push(name(a, a));
  else ALL_HANDS.push(name(a, b, 's'), name(a, b, 'o'));
}

/** Number of card combos in a hand class: pair 6, suited 4, offsuit 12. */
export const combosOf = (h) => (h.length === 2 ? 6 : h[2] === 's' ? 4 : 12);

/** Weighted combo count of a range map (1326 = every hand). */
export const comboCount = (map) => Object.entries(map).reduce((n, [h, f]) => n + combosOf(h) * f, 0);

function base(tok) {
  const m = /^([AKQJT2-9])([AKQJT2-9])([so]?)$/.exec(tok);
  if (!m) throw new Error(`bad hand "${tok}"`);
  const a = ri(m[1]), b = ri(m[2]);
  if (a === b && m[3]) throw new Error(`pair with suit flag "${tok}"`);
  if (a > b) throw new Error(`higher rank must come first "${tok}"`);
  return { a, b, t: m[3] };
}
const withTypes = (a, b, t) => (a === b ? [name(a, a)] : t ? [name(a, b, t)] : [name(a, b, 's'), name(a, b, 'o')]);

function expand(tok) {
  const plus = tok.endsWith('+');
  const body = plus ? tok.slice(0, -1) : tok;
  if (body.includes('-')) {
    const [x, y] = body.split('-').map(base);
    if (x.t !== y.t) throw new Error(`mismatched dash "${tok}"`);
    const out = [];
    if (x.a === x.b && y.a === y.b) { // pairs "88-55"
      for (let r = Math.min(x.a, y.a); r <= Math.max(x.a, y.a); r++) out.push(name(r, r));
    } else if (x.a === y.a) { // fixed top card "A5s-A2s"
      for (let k = Math.min(x.b, y.b); k <= Math.max(x.b, y.b); k++) out.push(...withTypes(x.a, k, x.t));
    } else { // same gap stepping down "T9s-65s"
      if (x.b - x.a !== y.b - y.a) throw new Error(`gap differs in "${tok}"`);
      const [hi, lo] = x.a < y.a ? [x, y] : [y, x];
      for (let d = 0; d <= lo.a - hi.a; d++) out.push(...withTypes(hi.a + d, hi.b + d, x.t));
    }
    return out;
  }
  const { a, b, t } = base(body);
  if (!plus) return withTypes(a, b, t);
  if (a === b) { // "22+": this pair and every higher pair
    const out = [];
    for (let r = a; r >= 0; r--) out.push(name(r, r));
    return out;
  }
  const out = []; // "A2s+": kicker climbs up to one below the top card
  for (let k = b; k > a; k--) out.push(...withTypes(a, k, t));
  return out;
}

/** Parse a range string into { handClass: freq }. Throws on malformed tokens. */
export function parseRange(str) {
  const map = {};
  for (const raw of str.split(',')) {
    const tok = raw.trim();
    if (!tok) continue;
    const [hands, f] = tok.split(':');
    const fr = f === undefined ? 1 : Number(f);
    if (!(fr >= 0 && fr <= 1)) throw new Error(`bad frequency in "${tok}"`);
    for (const h of expand(hands)) {
      if (fr === 0) delete map[h];
      else map[h] = fr;
    }
  }
  return map;
}

/** Frequency of a hand class in a range map (0 if missing). */
export function freq(map, handClass) {
  return (map && map[handClass]) || 0;
}

export const DEPTHS = [100, 40, 25];

const P = parseRange;
// Author "continue" (total) and "raise" ranges; call = what continues but doesn't raise.
function split(defend, raise) {
  const d = P(defend), r = P(raise), call = {};
  for (const h of Object.keys(d)) {
    const c = +(d[h] - (r[h] || 0)).toFixed(3);
    if (c > 0) call[h] = c;
  }
  return { r, call };
}
const vs = (defend, threeBet) => { const s = split(defend, threeBet); return { threeBet: s.r, call: s.call }; };
const v3 = (defend, fourBet) => { const s = split(defend, fourBet); return { fourBet: s.r, call: s.call }; };
const v4 = (defend, jam) => { const s = split(defend, jam); return { jam: s.r, call: s.call }; };

const ORDER = ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const group = (pos) => (pos === 'UTG' || pos === 'UTG1' ? 'EP' : pos === 'LJ' || pos === 'HJ' ? 'MP' : pos);

// ---------------------------------------------------------------- RFI (folded to you)
export const RFI = {
  100: {
    UTG: P('66+,A2s+,A9s-A6s:0.5,KTs+,QTs+,JTs,T9s:0.5,AJo+,KQo,KJo:0.25'),
    UTG1: P('55+,55:0.5,A2s+,K9s+,QTs+,JTs,T9s,98s:0.5,AJo+,ATo:0.5,KQo,KJo:0.5'),
    LJ: P('44+,A2s+,K8s+,Q9s+,J9s+,T9s,98s,87s:0.5,ATo+,KJo+,QJo:0.5'),
    HJ: P('44+,33:0.5,A2s+,K7s+,Q8s+,J8s+,T8s+,97s+,87s,76s,65s:0.5,ATo+,A9o:0.5,KTo+,QJo'),
    CO: P('33+,22:0.5,A2s+,K5s+,Q7s+,J7s+,T7s+,97s+,96s:0.5,86s+,75s+,65s,54s,A8o+,KTo+,K9o:0.5,QTo+,JTo'),
    BTN: P('22+,A2s+,K2s+,Q2s+,J4s+,T6s+,96s+,85s+,74s+,64s+,53s+,43s:0.5,A2o+,K8o+,Q9o+,J9o+,T9o'),
    SB: P('22+,A2s+,K2s+,Q5s+,J7s+,T6s+,96s+,85s+,75s+,64s+,54s,A2o+,K9o+,Q9o+,J9o+,T9o'), // raise-or-fold, 3bb
  },
  40: {
    UTG: P('44+,A2s+,K8s+,Q9s+,J9s+,T9s,98s:0.5,AJo+,ATo:0.5,KJo+'),
    UTG1: P('33+,A2s+,K7s+,Q9s+,J9s+,T8s+,98s,87s:0.5,ATo+,KJo+,QJo:0.5'),
    LJ: P('22+,A2s+,K6s+,Q8s+,J8s+,T8s+,97s+,87s,76s:0.5,ATo+,A9o:0.5,KJo+,KTo:0.5,QJo'),
    HJ: P('22+,A2s+,K5s+,Q8s+,J7s+,T7s+,97s+,86s+,76s,65s,A9o+,A8o:0.5,KTo+,QTo+,JTo:0.5'),
    CO: P('22+,A2s+,K2s+,Q5s+,J7s+,T7s+,96s+,86s+,75s+,64s+,54s,A8o+,A5o:0.5,K9o+,QTo+,JTo,T9o:0.5'),
    BTN: P('22+,A2s+,K2s+,Q2s+,J4s+,T5s+,95s+,85s+,74s+,63s+,53s+,43s,A2o+,K7o+,Q8o+,J8o+,T8o:0.5,T9o,98o'),
    SB: P('55+,A2s+,K9s+,Q9s+,J9s+,T9s,ATo+,KJo+,QJo,K6s-K2s:0.5'), // raise ~3bb; rest of SB plays via SB_LIMP
  },
  25: {
    UTG: P('33+,A2s+,K9s+,QTs+,JTs,ATo+,KJo+'),
    UTG1: P('33+,22:0.5,A2s+,K8s+,Q9s+,J9s+,T9s,ATo+,A9o:0.5,KJo+'),
    LJ: P('22+,A2s+,K7s+,Q9s+,J9s+,T9s,98s,A9o+,A8o:0.5,KJo+,KTo:0.5,QJo'),
    HJ: P('22+,A2s+,K6s+,Q8s+,J8s+,T8s+,98s,87s,A8o+,A7o:0.5,KTo+,QJo,QTo:0.5,JTo'),
    CO: P('22+,A2s+,K2s+,Q6s+,J7s+,T7s+,97s+,86s+,76s,65s,A7o+,A5o,K9o+,QTo+,JTo'),
    BTN: P('22+,A2s+,K2s+,Q2s+,J4s+,T6s+,96s+,85s+,75s+,64s+,54s,A2o+,K5o+,Q8o+,J8o+,T8o+,98o'),
    SB: P('55+,A7s+,A5s-A4s,KTs+,QTs+,JTs,ATo+,KQo,K5s-K2s:0.5,Q6s-Q5s:0.5'),
  },
};

// SB completes (limps) when folded to it. Empty at 100bb: cash SB plays raise-or-fold.
export const SB_LIMP = {
  100: {},
  40: P('22-44,K8s-K7s,Q8s-Q2s,J8s-J4s,T8s-T5s,95s+,85s+,74s+,63s+,53s+,43s,A9o-A2o,KTo-K5o,QTo-Q8o,JTo-J8o,T8o+,97o+,87o'),
  25: P('22-44,A6s,A3s,A2s,K9s-K6s,Q9s-Q7s,Q4s-Q2s,J9s-J2s,T9s-T4s,94s+,84s+,74s+,63s+,53s+,43s,A9o-A2o,KJo-K4o,QJo-Q7o,JTo-J7o,T9o-T7o,97o+,87o,76o'),
};

// ---------------------------------------------------------------- facing an open (VS_RFI)
// Grouped by opener: EP = UTG/UTG1, MP = LJ/HJ, then CO, BTN, SB. "IP" = cold-caller UTG1..CO.
const VS_RFI_T = {
  100: {
    IP: {
      EP: vs('88+,77:0.4,AJs+,ATs:0.3,KQs:0.8,KJs:0.3,QJs:0.3,JTs:0.3,AKo,AQo:0.3,A5s:0.5,A4s:0.4',
        'QQ+,AKs,AKo:0.75,AQs:0.4,A5s:0.5,A4s:0.4'),
      MP: vs('66+,55:0.4,ATs+,A9s:0.3,A5s:0.7,A4s:0.6,A3s:0.3,KTs+,QTs+,JTs,T9s:0.5,98s:0.2,AQo+,AJo:0.3,KQo:0.3',
        'QQ+,JJ:0.7,TT:0.4,AKs,AQs,AJs:0.5,AKo,AQo:0.5,KQs:0.5,KJs:0.3,A5s:0.7,A4s:0.6,A3s:0.3'),
    },
    BTN: {
      EP: vs('66+,55:0.7,44:0.5,33:0.4,22:0.4,AJs+,ATs:0.8,A9s:0.2,A5s:0.5,A4s:0.4,KTs+,QTs+,JTs,T9s:0.7,98s:0.5,87s:0.4,76s:0.3,AQo+,AJo:0.3,KQo:0.4',
        'QQ+,AKs,AKo:0.8,AQs:0.5,A5s:0.5,A4s:0.4,KQs:0.2'),
      MP: vs('55+,44:0.7,33:0.5,22:0.5,A9s+,A8s:0.4,A5s-A3s,A2s:0.3,K9s+,Q9s+,J9s+,T9s,T8s:0.5,98s,87s,76s,65s:0.7,54s:0.3,AJo+,ATo:0.3,KQo,KJo:0.4,QJo:0.3',
        'JJ+,TT:0.5,AQs+,AJs:0.5,ATs:0.3,AKo,AQo:0.6,KQs:0.5,KJs:0.3,A5s:0.6,A4s:0.5,A3s:0.3,K9s:0.2,76s:0.2,65s:0.2'),
      CO: vs('22+,44-22:0.6,A2s+,K8s+,Q9s+,J8s+,T8s+,97s+,86s+,76s,65s,54s:0.5,ATo+,A9o:0.2,KJo+,KTo:0.4,QJo,QTo:0.3,JTo:0.4',
        'TT+,99:0.4,88:0.2,AQs+,AJs:0.6,ATs:0.4,A9s:0.3,A5s-A2s:0.6,KQs:0.7,KJs:0.5,KTs:0.3,K9s:0.3,QJs:0.4,Q9s:0.2,J9s:0.2,T8s:0.2,76s:0.2,65s:0.2,AKo,AQo:0.6,AJo:0.5,KQo:0.5,KJo:0.3,QJo:0.2'),
    },
    SB: { // mostly 3-bet or fold (out of position)
      EP: vs('TT+,99:0.3,AQs+,AJs:0.5,KQs:0.6,A5s:0.5,AKo,AQo:0.3', 'QQ+,JJ:0.5,AKs,AKo,AQs:0.7,A5s:0.5,KQs:0.3'),
      MP: vs('88+,77:0.3,ATs+,A5s-A4s,A3s:0.3,KJs+,QJs:0.5,JTs:0.3,AQo+,AJo:0.2',
        'JJ+,TT:0.6,99:0.3,AQs+,AJs:0.7,ATs:0.3,AKo,AQo:0.6,KQs:0.7,KJs:0.3,A5s:0.7,A4s:0.7,A3s:0.3'),
      CO: vs('66+,55:0.4,A9s+,A8s:0.3,A7s:0.2,A5s-A2s:0.8,KTs+,K9s:0.5,QTs+,Q9s:0.3,JTs,J9s:0.3,T9s,98s:0.5,87s:0.3,AJo+,ATo:0.4,KQo:0.7,KJo:0.3',
        '99+,88:0.5,77:0.3,ATs+,A9s:0.4,A5s-A2s:0.6,KTs+,K9s:0.3,QTs+,JTs:0.6,T9s:0.3,AJo+,ATo:0.4,KQo:0.7,KJo:0.3'),
      BTN: vs('22+,66-22:0.7,A2s+,K7s+,K6s:0.3,Q9s+,Q8s:0.3,J9s+,J8s:0.3,T8s+,98s,87s,76s:0.5,65s:0.4,ATo+,A9o:0.5,KJo+,KTo:0.3,QJo:0.3',
        '77+,66:0.6,55:0.4,A2s+,K9s+,K8s:0.5,K7s:0.3,QTs+,Q9s:0.6,J9s+,T9s,98s:0.5,87s:0.3,ATo+,A9o:0.5,KJo+,KTo:0.3,QJo:0.3'),
    },
    BB: {
      EP: vs('22+,A2s+,K8s+,K7s-K5s:0.5,Q8s+,J8s+,T8s+,T7s:0.5,97s+,86s+,75s+,65s,64s:0.5,54s,53s:0.5,AJo+,ATo:0.5,KQo,KJo:0.6,KTo:0.3,QJo:0.5,QTo:0.2,JTo:0.3',
        'QQ+,JJ:0.3,AKs,AKo,AQs:0.5,A5s:0.6,A4s:0.4,KQs:0.2'),
      MP: vs('22+,A2s+,K2s+,Q6s+,J7s+,T7s+,96s+,85s+,75s+,64s+,53s+,43s:0.5,ATo+,A9o:0.5,KTo+,QTo+,JTo:0.7,T9o:0.3',
        'QQ+,JJ:0.6,TT:0.2,AKs,AQs:0.7,AKo,AQo:0.3,A5s:0.7,A4s:0.6,A3s:0.3,KQs:0.3,KJs:0.2,76s:0.2,65s:0.2'),
      CO: vs('22+,A2s+,K2s+,Q2s+,J4s+,T6s+,96s+,85s+,74s+,63s+,53s+,43s,A2o+,K8o+,Q9o+,J9o+,T8o+,98o,87o:0.5',
        'JJ+,TT:0.5,99:0.2,AQs+,AJs:0.6,ATs:0.3,AKo,AQo:0.6,AJo:0.2,KQs:0.6,KJs:0.4,KTs:0.2,QJs:0.3,A5s:0.8,A4s:0.7,A3s:0.5,A2s:0.3,K9s:0.2,Q9s:0.2,J9s:0.2,T8s:0.2,97s:0.2,86s:0.2,76s:0.3,65s:0.3,54s:0.3,KQo:0.3'),
      BTN: vs('22+,A2s+,K2s+,Q2s+,J2s+,T3s+,95s+,84s+,73s+,63s+,52s+,42s+,32s:0.5,A2o+,K4o+,Q7o+,J7o+,T7o+,97o+,86o+,76o,65o:0.5,75o:0.3',
        'TT+,99:0.7,88:0.3,AJs+,ATs:0.6,A9s:0.3,A8s:0.3,A5s-A2s:0.6,AKo,AQo,AJo:0.5,ATo:0.2,A9o:0.2,KQs,KJs:0.7,KTs:0.4,K9s:0.3,K8s:0.2,K7s:0.2,K6s:0.2,K5s:0.3,QJs:0.5,QTs:0.5,Q9s:0.3,Q8s:0.2,JTs:0.5,J9s:0.3,J8s:0.2,T9s:0.3,T8s:0.3,98s:0.3,97s:0.3,87s:0.3,76s:0.4,65s:0.4,54s:0.4,KQo:0.6,KJo:0.4,QJo:0.2'),
      SB: vs('22+,A2s+,K2s+,Q2s+,J3s+,T5s+,95s+,84s+,74s+,63s+,53s+,43s,A2o+,K5o+,Q8o+,J8o+,T8o+,98o,87o:0.5,76o:0.3',
        '99+,88:0.5,ATs+,A5s-A2s:0.5,KTs+,K9s:0.3,K5s-K2s:0.3,QTs+,Q9s:0.3,JTs:0.5,J9s:0.3,T9s:0.3,98s:0.3,87s:0.3,76s:0.3,65s:0.3,54s:0.3,ATo+,A9o:0.3,KJo+,QJo:0.3'),
    },
  },
  40: {
    IP: {
      EP: vs('77+,66:0.5,AJs+,ATs:0.5,KQs,KJs:0.5,QJs:0.5,JTs:0.4,AQo+,AJo:0.2,A5s:0.4', 'QQ+,JJ:0.3,AKs,AKo,AQs:0.5,A5s:0.4'),
      MP: vs('55+,A9s+,A5s-A4s,KTs+,QTs+,JTs,T9s:0.5,AJo+,KQo:0.6', 'JJ+,TT:0.5,AQs+,AJs:0.5,AKo,AQo:0.6,KQs:0.5,A5s:0.6,A4s:0.5'),
    },
    BTN: {
      EP: vs('44+,33:0.5,22:0.5,ATs+,A9s:0.3,A5s:0.4,KTs+,QTs+,JTs,T9s:0.7,98s:0.5,AJo+,KQo:0.6', 'QQ+,JJ:0.3,AKs,AKo,AQs:0.5,A5s:0.4'),
      MP: vs('22+,A7s+,A5s-A3s,K9s+,Q9s+,J9s+,T9s,98s,87s:0.5,ATo+,KJo+,QJo:0.4', 'JJ+,TT:0.5,AQs+,AJs:0.5,AKo,AQo:0.6,KQs:0.5,A5s:0.6,A4s:0.5'),
      CO: vs('22+,A2s+,K7s+,Q9s+,J9s+,T8s+,97s+,87s,76s,65s:0.5,ATo+,KJo+,KTo:0.4,QJo,QTo:0.3,JTo:0.3',
        'TT+,99:0.5,AJs+,ATs:0.5,A5s-A3s:0.6,KQs:0.7,KJs:0.4,K9s:0.2,Q9s:0.2,J9s:0.2,T8s:0.2,76s:0.2,AKo,AQo:0.7,AJo:0.3,KQo:0.4'),
    },
    SB: {
      EP: vs('TT+,99:0.4,AQs+,AJs:0.5,KQs:0.6,A5s:0.4,AKo,AQo:0.3', 'QQ+,JJ:0.5,AKs,AKo,AQs:0.6,A5s:0.4'),
      MP: vs('77+,ATs+,A5s-A4s,KJs+,QJs:0.5,JTs:0.3,AQo+,AJo:0.3', 'JJ+,TT:0.6,99:0.3,AQs+,AJs:0.6,AKo,AQo:0.6,KQs:0.6,A5s:0.6,A4s:0.5'),
      CO: vs('55+,A8s+,A5s-A2s,KTs+,K9s:0.5,QTs+,JTs,T9s:0.6,98s:0.4,ATo+,KJo+',
        '88+,77:0.5,ATs+,A9s:0.4,A5s-A3s:0.5,KJs+,KTs:0.5,QJs:0.5,AJo+,ATo:0.3,KQo:0.6'),
      BTN: vs('22+,A2s+,K7s+,Q8s+,J8s+,T8s+,97s+,87s,76s,65s:0.5,A8o+,A5o:0.5,KTo+,QJo,QTo:0.4,JTo:0.4',
        '66+,55:0.5,A7s+,A5s-A2s:0.7,K9s+,QTs+,JTs:0.6,ATo+,A9o:0.4,KJo+,KTo:0.3,QJo:0.3'),
    },
    BB: {
      EP: vs('22+,A2s+,K5s+,Q7s+,J7s+,T7s+,96s+,86s+,75s+,64s+,54s,53s:0.5,ATo+,A9o:0.4,KTo+,QTo+,JTo:0.6',
        'QQ+,JJ:0.3,AKs,AKo,AQs:0.5,A5s:0.5,A4s:0.4'),
      MP: vs('22+,A2s+,K2s+,Q4s+,J6s+,T6s+,95s+,85s+,74s+,63s+,53s+,43s,A7o+,A5o:0.5,K9o+,QTo+,JTo,T9o:0.5,98o:0.3',
        'JJ+,TT:0.4,AQs+,AJs:0.4,AKo,AQo:0.5,A5s-A4s:0.6,A3s:0.3,KQs:0.4,76s:0.2,65s:0.2'),
      CO: vs('22+,A2s+,K2s+,Q2s+,J2s+,T4s+,95s+,84s+,74s+,63s+,52s+,42s+,32s:0.5,A2o+,K7o+,Q8o+,J8o+,T8o+,97o+,87o,76o:0.5',
        'TT+,99:0.4,AJs+,ATs:0.4,AKo,AQo:0.7,AJo:0.3,KQs:0.6,KJs:0.4,A5s-A3s:0.6,A2s:0.3,K9s:0.2,Q9s:0.2,J9s:0.2,T8s:0.2,76s:0.3,65s:0.3,54s:0.3,KQo:0.3'),
      BTN: vs('22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,83s+,73s+,62s+,52s+,42s+,32s,A2o+,K2o+,Q5o+,J6o+,T6o+,96o+,86o+,75o+,65o,54o:0.5',
        '88+,77:0.5,ATs+,A9s:0.4,A5s-A2s:0.6,KTs+,K9s:0.3,QTs+,JTs:0.4,T9s:0.3,98s:0.3,87s:0.3,76s:0.3,65s:0.3,AJo+,ATo:0.4,KQo:0.6,KJo:0.3'),
      SB: vs('22+,A2s+,K2s+,Q5s+,J7s+,T7s+,97s+,86s+,75s+,65s,54s,A2o+,K8o+,Q9o+,J9o+,T9o',
        'TT+,AJs+,AKo,AQo,A5s-A4s:0.5,KQs:0.5'),
    },
  },
  25: { // a 25bb 3-bet is effectively a jam: these 3-bet ranges are linear (strong value + blockers)
    IP: {
      EP: vs('88+,77:0.5,AJs+,ATs:0.3,KQs,KJs:0.3,QJs:0.3,AQo+,A5s:0.3', 'TT+,99:0.5,AQs+,AJs:0.3,AKo,A5s:0.3'),
      MP: vs('66+,55:0.5,ATs+,A9s:0.3,A5s-A4s:0.5,KTs+,QTs+,JTs,AJo+,KQo:0.5', '99+,88:0.5,AJs+,ATs:0.5,AQo+,AJo:0.3,KQs:0.5,A5s-A4s:0.5'),
    },
    BTN: {
      EP: vs('66+,55:0.5,ATs+,A5s:0.3,KTs+,QJs,JTs:0.6,AQo+,AJo:0.3,KQo:0.4', 'TT+,99:0.5,AQs+,AJs:0.3,AKo,A5s:0.3'),
      MP: vs('44+,33:0.5,22:0.5,A8s+,A5s-A3s,K9s+,QTs+,JTs,T9s,98s:0.4,ATo+,KJo+,QJo:0.3', '99+,88:0.5,AJs+,ATs:0.5,AQo+,AJo:0.3,KQs:0.5,A5s-A4s:0.5'),
      CO: vs('22+,A2s+,K8s+,Q9s+,J9s+,T9s,98s,87s:0.5,A9o+,KTo+,QJo,QTo:0.4,JTo:0.4',
        '88+,77:0.5,ATs+,A9s:0.5,A5s-A2s:0.5,KTs+,QJs:0.5,AJo+,ATo:0.5,KQo:0.6'),
    },
    SB: {
      EP: vs('99+,AJs+,KQs:0.4,AQo+', 'TT+,99:0.5,AQs+,AJs:0.3,AKo,AQo:0.3'),
      MP: vs('66+,ATs+,A9s:0.5,KJs+,QJs:0.5,AJo+', '88+,77:0.5,ATs+,A5s:0.4,KQs,KJs:0.3,AJo+'),
      CO: vs('55+,44:0.5,A2s+,K9s+,QTs+,JTs,ATo+,A9o:0.4,KJo+', '66+,55:0.5,A8s+,A5s-A2s:0.6,KTs+,QJs,ATo+,KQo,KJo:0.5'),
      BTN: vs('22+,A2s+,K6s+,K6s:0.4,Q8s+,Q8s:0.4,J8s+,J8s:0.3,T8s+,T8s:0.3,98s,87s:0.3,A5o+,KTo+,QJo,QTo:0.3',
        '44+,33:0.6,22:0.5,A2s+,K8s+,K7s:0.5,Q9s+,J9s+,T9s,98s:0.3,A8o+,A5o:0.5,KTo+,QJo:0.6,QTo:0.3'),
    },
    BB: { // same defend widths as 40bb (2bb opens + ante give an even better price); 3-bets are jams
      EP: vs('22+,A2s+,K5s+,Q7s+,J7s+,T7s+,96s+,86s+,75s+,64s+,54s,53s:0.5,ATo+,A9o:0.4,KTo+,QTo+,JTo:0.6', 'TT+,99:0.4,AQs+,AJs:0.3,AKo,AQo:0.3,A5s:0.3'),
      MP: vs('22+,A2s+,K2s+,Q4s+,J6s+,T6s+,95s+,85s+,74s+,63s+,53s+,43s,A7o+,A5o:0.5,K9o+,QTo+,JTo,T9o:0.5,98o:0.3',
        '99+,88:0.5,AJs+,ATs:0.5,AQo+,AJo:0.4,KQs:0.6,A5s-A4s:0.4'),
      CO: vs('22+,A2s+,K2s+,Q2s+,J2s+,T4s+,95s+,84s+,74s+,63s+,52s+,42s+,32s:0.5,A2o+,K7o+,Q8o+,J8o+,T8o+,97o+,87o,76o:0.5',
        '77+,66:0.5,A9s+,A5s-A2s:0.5,KTs+,QJs:0.6,ATo+,KQo,KJo:0.4'),
      BTN: vs('22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,83s+,73s+,62s+,52s+,42s+,32s,A2o+,K2o+,Q5o+,J6o+,T6o+,96o+,86o+,75o+,65o,54o:0.5',
        '55+,44:0.6,33:0.4,22:0.4,A7s+,A5s-A2s:0.6,K9s+,QTs+,JTs:0.6,A8o+,A5o:0.4,KTo+,QJo:0.5'),
      SB: vs('22+,A2s+,K2s+,Q5s+,J6s+,T6s+,96s+,85s+,75s+,64s+,54s,A2o+,K7o+,Q9o+,J9o+,T9o',
        '77+,A8s+,A5s:0.5,KTs+,QJs,ATo+,KJo+'),
    },
  },
};

function buildVsRfi(t) {
  const out = {};
  ORDER.forEach((hero, hi) => {
    if (hi === 0) return;
    out[hero] = {};
    for (const op of ORDER.slice(0, hi)) {
      const table = hero === 'BTN' || hero === 'SB' || hero === 'BB' ? t[hero] : t.IP;
      out[hero][op] = table[group(op)];
    }
  });
  return out;
}

/** VS_RFI[depth][heroPos][openerPos] = { threeBet, call }; anything not listed folds. */
export const VS_RFI = { 100: buildVsRfi(VS_RFI_T[100]), 40: buildVsRfi(VS_RFI_T[40]), 25: buildVsRfi(VS_RFI_T[25]) };

// ---------------------------------------------------------------- opener facing a 3-bet
// IP = opener has position on the 3-bettor (3-bet came from the blinds); OOP = 3-bettor sits behind.
const V3_T = {
  100: {
    EP: {
      IP: v3('TT+,99:0.6,88:0.4,AJs+,ATs:0.5,KQs,KJs:0.6,QJs:0.5,JTs:0.5,T9s:0.3,AKo,AQo:0.6,A5s:0.6,A4s:0.4', 'KK+,QQ:0.5,AKs,AKo:0.6,A5s:0.4,A4s:0.3'),
      OOP: v3('TT+,99:0.4,AQs+,AJs:0.6,KQs:0.7,KJs:0.3,AKo,AQo:0.3,A5s:0.4', 'KK+,QQ:0.4,AKs,AKo:0.5,A5s:0.4'),
    },
    MP: {
      IP: v3('88+,77:0.5,ATs+,A9s:0.3,A5s-A4s,A3s:0.3,KTs+,QTs+,JTs,T9s:0.6,98s:0.4,AQo+,AJo:0.3,KQo:0.3', 'QQ+,JJ:0.3,AKs,AKo:0.7,A5s:0.5,A4s:0.4'),
      OOP: v3('99+,88:0.5,AJs+,ATs:0.5,KQs,KJs:0.6,QJs:0.5,JTs:0.5,AQo+,A5s:0.6,A4s:0.4', 'QQ+,JJ:0.3,AKs,AKo:0.6,A5s:0.5,A4s:0.3'),
    },
    CO: {
      IP: v3('66+,55:0.4,A8s+,A5s-A2s,K9s+,Q9s+,J9s+,T9s,98s,87s:0.6,76s:0.4,AJo+,ATo:0.3,KQo,KJo:0.3', 'QQ+,JJ:0.4,AKs,AQs:0.3,AKo:0.8,A5s-A4s:0.5,A3s:0.3,K9s:0.2'),
      OOP: v3('77+,66:0.4,ATs+,A9s:0.4,A5s-A4s,KTs+,QTs+,JTs,T9s:0.5,AQo+,AJo:0.4,KQo:0.4', 'QQ+,JJ:0.4,AKs,AKo:0.7,A5s-A4s:0.5'),
    },
    BTN: v3('44+,33:0.5,22:0.5,A2s+,K6s+,Q8s+,J8s+,T8s+,97s+,86s+,76s,65s,54s:0.5,ATo+,A9o:0.3,KJo+,KTo:0.4,QJo,QTo:0.4,JTo:0.5',
      'QQ+,JJ:0.4,AKs,AQs:0.3,AKo,A5s-A3s:0.5,A2s:0.3,K9s:0.2,K8s:0.2,Q9s:0.2,AJo:0.2,KJo:0.2'),
    SB: v3('55+,44:0.5,A2s+,K8s+,Q9s+,J9s+,T8s+,98s,87s,76s:0.6,ATo+,KJo+,QJo:0.5',
      'QQ+,JJ:0.4,AKs,AQs:0.4,AKo,AQo:0.3,A5s-A3s:0.5,K9s:0.2,Q9s:0.2'),
  },
  40: { // 4-bet here is a jam
    EP: v3('TT+,99:0.5,AJs+,ATs:0.3,KQs,AQo+', 'QQ+,JJ:0.5,AKs,AQs:0.3,AKo'),
    MP: v3('88+,77:0.5,ATs+,KJs+,QJs:0.5,AJo+,KQo:0.4,A5s-A4s:0.5', 'JJ+,TT:0.5,AQs+,AKo,AQo:0.4,A5s:0.3'),
    CO: v3('66+,A8s+,A5s-A2s:0.6,KTs+,QTs+,JTs,T9s:0.5,ATo+,KQo,KJo:0.4', 'TT+,99:0.5,AJs+,ATs:0.5,AKo,AQo,AJo:0.3,KQs:0.5,A5s-A4s:0.4'),
    BTN: v3('44+,33:0.5,22:0.5,A2s+,K8s+,Q9s+,J9s+,T9s,98s,87s:0.5,A9o+,KTo+,QJo,QTo:0.3', '99+,88:0.5,ATs+,A9s:0.3,A5s-A3s:0.5,KJs+,AJo+,ATo:0.4,KQo:0.6'),
    SB: v3('55+,A2s+,K9s+,Q9s+,J9s+,T9s,A9o+,KTo+,QJo', '88+,A9s+,A5s-A3s:0.5,KJs+,ATo+,KQo'),
  },
  25: { // facing a 3-bet at 25bb you are usually facing (or making) an all-in
    EP: v3('TT+,99:0.5,AJs:0.4,AQs+,AKo,AQo:0.5', 'QQ+,JJ:0.6,AKs,AQs:0.4,AKo'),
    MP: v3('99+,88:0.5,AJs+,AQo+,KQs:0.5,AJo:0.3', 'JJ+,TT:0.6,AQs+,AKo,AQo:0.4'),
    CO: v3('77+,66:0.5,ATs+,A9s:0.4,KQs,KJs:0.5,AJo+,ATo:0.4,KQo:0.5', 'TT+,99:0.6,AJs+,ATs:0.4,AQo+'),
    BTN: v3('55+,44:0.5,A7s+,A5s:0.5,KTs+,QJs,ATo+,A9o:0.5,KJo+', '88+,77:0.5,ATs+,A9s:0.5,AJo+,KQs:0.6'),
    SB: v3('55+,44:0.5,A7s+,A5s:0.5,KTs+,QJs,ATo+,A9o:0.5,KJo+', '88+,77:0.5,ATs+,A9s:0.5,AJo+,KQs:0.6'),
  },
};

function buildVs3(t) {
  const out = {};
  for (const op of ORDER.slice(0, 7)) {
    const g = t[group(op)];
    out[op] = g.IP ? g : { IP: g, OOP: g };
  }
  return out;
}

/** VS_3BET[depth][openerPos] = { IP: { fourBet, call }, OOP: { fourBet, call } }. */
export const VS_3BET = { 100: buildVs3(V3_T[100]), 40: buildVs3(V3_T[40]), 25: buildVs3(V3_T[25]) };

/** VS_4BET[depth] = { jam, call }: the 3-bettor facing a 4-bet. If the 4-bet is already all-in, continue with jam + call. */
export const VS_4BET = {
  100: v4('QQ+,JJ:0.6,TT:0.3,AKs,AQs:0.5,AKo,AQo:0.2,KQs:0.2,A5s:0.3,A4s:0.2', 'KK+,QQ:0.3,AKs:0.7,AKo:0.4,A5s:0.15,A4s:0.1'),
  40: v4('TT+,99:0.5,AQs+,AJs:0.3,AKo,AQo:0.4', 'QQ+,JJ:0.5,AKs,AKo'),
  25: v4('88+,AJs+,ATs:0.3,KQs:0.3,AQo+,AJo:0.3', 'TT+,99:0.5,AQs+,AJs:0.5,AKo,AQo:0.5'),
};

// ---------------------------------------------------------------- push / fold (<= 20bb)
// Value = max effective stack (bb) at which the action is correct; 20 means "20+".
// Generated offline (chip EV, BB-ante of 1bb, blinds 0.5/1): iterated best response over a Monte Carlo
// 169x169 equity matrix, assuming at most one caller. The same solver reproduces the HoldemResources
// heads-up Nash charts to within ~0.5-1bb. Grids: rows/cols A..2; above the diagonal = suited,
// below = offsuit, diagonal = pairs.
// shortcut: single-caller approximation and no ICM; true multi-way Nash is slightly tighter for early callers.
const PF = {
  push: {
    UTG: `
20 20 20 20 16 12.25 10.75 10.25 9.25 9.75 9 8.5 8
20 20 20 16.25 15.75 7 6.25 6.25 5.75 5.5 5.5 5.5 5.25
20 12 20 15.25 15.25 6 5.5 5 5 5 4.75 4.75 4.5
17.25 8 6.5 20 12.5 5.75 5.25 5 4.5 4.5 4.25 4.25 4.25
13 6.75 5.75 5.5 20 6.75 5.25 4.75 4.5 4.25 4 4 3.75
10.25 6 5 5 4.75 20 5.25 4.75 4.5 4 3.75 3.75 3.5
9 5.5 4.75 4.5 4.5 4.25 20 5 4.5 4.25 3.75 3.5 3.5
8.5 5.25 4.5 4.25 4 4 4 18.25 4.75 4.25 3.75 3.5 3.25
7.5 5 4.5 4 3.75 3.75 3.75 3.75 15.25 4.25 4 3.5 3.25
7.5 5 4.5 4 3.75 3.5 3.5 3.5 3.5 13.25 4.25 3.75 3.25
7.25 5 4.25 4 3.5 3.25 3.25 3.25 3.25 3.25 11.25 3.5 3
6.75 4.75 4.25 3.75 3.5 3.25 2.75 2.75 2.75 2.75 2.75 10 3
6.5 4.75 4.25 3.75 3.5 3.25 2.75 2.5 2.5 2.5 2.25 2.25 8.75`,
    UTG1: `
20 20 20 20 18.75 14.25 12.75 11.75 10.75 11.5 10.25 9.5 9
20 20 20 19.75 20 11.75 6.75 6.25 6.25 5.75 5.5 5.5 5.25
20 16 20 18.25 18.25 6.75 5.5 5 5 5 4.75 4.75 4.5
20 9 7 20 17.5 12.5 5.25 5 4.5 4.5 4.25 4.25 4.25
14.75 7.25 6.25 5.5 20 12.75 5.5 4.75 4.5 4.25 4 4 3.75
11.5 6.25 5.25 5 4.75 20 5.25 4.75 4.5 4 3.75 3.75 3.5
10 5.75 4.75 4.5 4.5 4.25 20 5 4.5 4.25 3.75 3.5 3.5
9 5.5 4.5 4.25 4 4 4 20 4.75 4.25 3.75 3.5 3.25
8 5.25 4.5 4 3.75 3.75 3.75 3.75 17.5 4.25 4 3.5 3.25
8.25 5 4.5 4 3.75 3.5 3.5 3.5 3.5 15 4.25 3.75 3.25
7.5 5 4.25 4 3.5 3.25 3.25 3.25 3.25 3.25 13 3.5 3
7.25 5 4.25 3.75 3.5 3.25 2.75 2.75 2.75 2.75 2.75 11.5 3
7 4.75 4.25 3.75 3.5 3.25 2.75 2.5 2.5 2.5 2.25 2.25 10.5`,
    LJ: `
20 20 20 20 20 19.25 15.75 15 13.5 15 13.25 11.5 10.75
20 20 20 20 20 19.25 7.25 7 6.5 6.25 6 5.75 5.5
20 20 20 20 20 18.25 6 5.25 5.25 5 5 4.75 4.75
20 14.25 13.25 20 20 18.25 5.5 5 4.5 4.5 4.5 4.25 4.25
17.75 8.25 6.75 6 20 19 5.5 5 4.5 4.25 4 4 3.75
13.5 6.75 5.5 5 5 20 13.25 5 4.5 4 3.75 3.75 3.5
11.75 6 5 4.5 4.5 4.25 20 5.25 4.5 4.25 3.75 3.5 3.5
10.5 5.5 4.75 4.25 4.25 4 4 20 4.75 4.25 3.75 3.5 3.25
9 5.25 4.5 4 3.75 3.75 3.75 3.75 20 4.25 4 3.5 3.25
9.25 5.25 4.5 4 3.75 3.5 3.5 3.5 3.5 20 4.25 3.75 3.25
9 5 4.25 4 3.5 3.25 3.25 3.25 3.25 3.25 17 3.5 3
8 5 4.25 3.75 3.5 3.25 2.75 2.75 2.75 2.75 2.75 16.5 3
7.75 4.75 4.25 3.75 3.5 3.25 2.75 2.5 2.5 2.5 2.25 2.25 14`,
    HJ: `
20 20 20 20 20 20 20 19 18.25 19.5 17.75 16.25 14.5
20 20 20 20 20 20 9.25 9 8 7.25 7 6.5 6
20 20 20 20 20 20 7.5 5.75 5.5 5.25 5.25 5 4.75
20 19.5 19.5 20 20 20 16 5.25 4.75 4.5 4.5 4.25 4.25
20 11.5 9.25 13.5 20 20 17.75 5 4.5 4.25 4 4 3.75
17 7.75 6 5.25 5.25 20 19 5.25 4.5 4 3.75 3.75 3.5
14.5 6.5 5.25 4.75 4.5 4.5 20 15 4.5 4.25 3.75 3.5 3.5
13.5 6.25 4.75 4.5 4.25 4 4 20 5 4.25 3.75 3.5 3.25
11.75 5.75 4.75 4 4 3.75 3.75 3.75 20 4.25 4 3.5 3.25
12.25 5.5 4.5 4 3.75 3.5 3.5 3.5 3.5 20 4.25 3.75 3.25
11 5.25 4.5 4 3.5 3.25 3.25 3.25 3.25 3.25 20 3.5 3
10.25 5.25 4.25 3.75 3.5 3.25 2.75 2.75 2.75 2.75 2.75 20 3
9.25 5 4.25 3.75 3.5 3.25 2.75 2.5 2.5 2.5 2.25 2.25 19.75`,
    CO: `
20 20 20 20 20 20 20 20 20 20 20 20 20
20 20 20 20 20 20 19.75 12.5 11.25 9.75 9.25 8.5 7.75
20 20 20 20 20 20 19 7.5 7.5 6.5 5.75 5.25 5.25
20 20 20 20 20 20 20 8.25 5.25 5 4.75 4.5 4.25
20 18 18.5 20 20 20 20 10.5 4.75 4.25 4.25 4 4
20 9.75 7.5 6.5 6.5 20 20 12.25 4.75 4.25 3.75 3.75 3.75
19.75 8.25 5.75 5 4.75 4.5 20 20 9 4.25 3.75 3.5 3.5
19 7.75 5.25 4.5 4.25 4.25 4 20 12.25 4.25 3.75 3.5 3.25
16 7 5 4.25 4 3.75 3.75 3.75 20 4.25 3.75 3.5 3.25
17.5 6.5 4.75 4.25 3.75 3.5 3.5 3.5 3.5 20 4 3.75 3.25
15.75 6.25 4.5 4 3.75 3.25 3.25 3.25 3 3.25 20 3.5 3
14 5.75 4.5 4 3.5 3.25 2.75 2.75 2.75 2.75 2.5 20 3
13.25 5.5 4.25 3.75 3.5 3.25 2.75 2.5 2.5 2.5 2.25 2.25 20`,
    BTN: `
20 20 20 20 20 20 20 20 20 20 20 20 20
20 20 20 20 20 20 20 20 20 17.5 15.75 13.25 12
20 20 20 20 20 20 20 14 14.25 11.25 10.25 8.25 7.5
20 20 20 20 20 20 20 18.5 7.5 6.75 5.5 5 5
20 20 20 20 20 20 20 20 11 4.75 4.5 4.25 4.25
20 15.25 11.75 12.75 20 20 20 20 15.25 4.5 4 3.75 3.75
20 12 8.5 6.75 6.25 5.5 20 20 20 4.25 3.75 3.5 3.5
20 11.75 6.75 5.5 4.75 4.5 4.25 20 20 12.75 3.75 3.25 3
20 11 6.5 4.75 4.25 4.25 4 3.75 20 15.5 3.75 3.25 3
20 10 5.75 4.5 4 3.75 3.5 3.5 3.25 20 12 3.25 3
20 9.25 5.5 4.5 3.75 3.5 3.25 3 3 3 20 3 2.75
20 8.75 5.25 4.25 3.75 3.25 3 2.5 2.5 2.5 2.25 20 2.5
20 8 5 4.25 3.5 3 2.75 2 2 2 1.75 1.75 20`,
    SB: `
20 20 20 20 20 20 20 20 20 20 20 20 20
20 20 20 20 20 20 20 20 20 20 20 20 20
20 20 20 20 20 20 20 20 20 20 20 20 20
20 20 20 20 20 20 20 20 20 20 20 19.5 15.25
20 20 20 20 20 20 20 20 20 20 19.5 16.25 11.5
20 20 20 20 20 20 20 20 20 20 12.75 11.25 8.25
20 20 20 20 20 20 20 20 20 20 18.25 6.75 5
20 20 17.25 14.5 17.25 19.5 20 20 20 20 20 10.5 3.5
20 20 17 10.75 10.5 10.5 16.5 19.75 20 20 20 17 3.5
20 20 15.25 10.5 7.5 6.75 6.5 8.25 14 20 20 20 10.5
20 20 14 9.25 6.75 4.75 4.25 3.75 3.5 8.25 20 17.5 3.25
20 20 12.5 8.5 6.25 4.25 3.5 3 3 3 2.75 20 3
20 19.25 11.75 8 5.5 4 3.25 2.5 2.5 2.5 2.25 2.25 20`,
  },
  callBB: {
    UTG: `
20 20 20 20 20 15.75 13.5 12.25 11.25 11.5 11 10.25 9.75
20 20 18.75 14.75 12.75 9.75 8.75 8.25 8 7.5 7.25 7 6.75
20 13 20 12.25 11 9 8 7 7 6.75 6.25 6 5.75
20 10.25 9 20 11 9 8 7 6.25 6 5.75 5.75 5.5
16.25 9.25 8.25 8 20 9.25 8.25 7.25 6.5 5.75 5.5 5.25 5.25
12.25 7.75 7 6.75 7 20 8.25 7.5 6.75 5.75 5.25 5 5
11 7 6.25 6 6 6.25 20 8 7 6.25 5.5 5 4.75
10 6.75 5.75 5.5 5.5 5.5 6 20 7.25 6.5 5.75 5 4.5
9.25 6.5 5.5 5 5 5 5.25 5.5 20 6.75 6 5.25 4.75
9.25 6.25 5.5 5 4.75 4.75 4.75 5 5.25 16.5 6.25 5.5 5
8.75 6 5.25 4.75 4.5 4.25 4.25 4.5 4.75 5 13 5.25 4.75
8.5 5.75 5.25 4.75 4.5 4.25 4 4 4.25 4.5 4.25 11.75 4.75
8 5.75 5 4.5 4.25 4 4 3.75 3.75 4 4 3.75 10.25`,
    UTG1: `
20 20 20 20 20 16.5 14.25 13.25 12 12.25 11.25 10.75 10
20 20 19 15.5 13 10.25 8.75 8.5 8 7.5 7.25 7 6.75
20 13.75 20 12.25 11.25 9.25 8 7 7 6.75 6.5 6 6
20 11 9.25 20 11.25 9.25 8 7.25 6.25 6.25 5.75 5.75 5.5
17.25 9.5 8.5 8.25 20 9.5 8.25 7.25 6.5 5.75 5.5 5.25 5.25
13.25 8 7 6.75 7 20 8.5 7.5 6.75 5.75 5.25 5 5
11.5 7 6.25 6 6 6.25 20 8 7 6.25 5.5 5 4.75
10.5 6.75 5.75 5.5 5.5 5.5 5.75 20 7.5 6.5 5.75 5 4.5
9.5 6.5 5.5 5 5 5 5.25 5.5 20 6.75 6 5.25 4.75
9.5 6.25 5.5 5 4.75 4.75 4.75 5 5.25 16.5 6.25 5.5 5
9 6 5.25 4.75 4.5 4.25 4.25 4.5 4.75 5 14 5.25 4.75
8.75 6 5.25 4.75 4.5 4.25 4 4 4.25 4.5 4.25 12 4.75
8.25 5.75 5 4.5 4.25 4 4 3.75 3.75 4 4 3.75 10.75`,
    LJ: `
20 20 20 20 20 17.75 16 14.5 13 13.25 12.25 11.25 10.75
20 20 20 16 14 10.5 9 8.75 8.25 8 7.75 7.25 7
20 15.25 20 13 12 9.5 8.25 7.25 7 6.75 6.5 6.25 6
20 11.75 9.5 20 11.75 9.25 8.25 7.25 6.25 6.25 5.75 5.75 5.5
18.75 9.75 8.75 8.25 20 9.75 8.5 7.25 6.5 5.75 5.5 5.5 5.25
14.75 8 7 6.75 7 20 8.75 7.5 6.5 5.75 5.25 5 5
12.75 7.25 6.25 6 6 6.25 20 8.25 7 6.25 5.5 5 4.75
11.25 7 5.75 5.5 5.5 5.5 5.75 20 7.5 6.5 5.75 5 4.5
10.25 6.75 5.75 5 5 5 5.25 5.5 20 6.75 6 5.25 4.75
10.25 6.5 5.5 5 4.75 4.75 4.75 5 5.25 18 6.25 5.75 5
9.5 6.25 5.25 5 4.5 4.25 4.25 4.5 4.75 5 15 5.5 4.75
9 6 5.25 4.75 4.5 4.25 4 4 4.25 4.5 4.25 13 4.75
8.5 5.75 5 4.5 4.25 4 4 3.75 3.75 4 4 3.75 11.25`,
    HJ: `
20 20 20 20 20 20 18.75 17.25 15 15.25 14 13 12.25
20 20 20 18.75 16 11.75 9.75 9.5 9 8.5 8.25 7.75 7.25
20 18.25 20 14.75 12.75 10 8.5 7.5 7.25 7 6.75 6.5 6.25
20 13.25 10.5 20 12.25 9.75 8.5 7.25 6.5 6.25 6 5.75 5.5
20 10.75 9 8.5 20 10.25 8.5 7.25 6.5 5.75 5.75 5.5 5.25
17.5 8.75 7.25 7 7 20 8.75 7.5 6.75 5.75 5.25 5 5
14.75 7.75 6.5 6 6 6.25 20 8.25 7 6.25 5.5 5 4.75
13 7.5 5.75 5.5 5.5 5.5 5.75 20 7.5 6.5 5.75 5 4.5
11.5 7 5.75 5.25 5 5.25 5.25 5.5 20 6.75 6 5.25 4.75
11.25 6.75 5.5 5 4.75 4.75 4.75 5 5.25 20 6.5 5.75 5
10.75 6.5 5.5 5 4.5 4.25 4.25 4.5 4.75 5 18 5.5 4.75
10 6.25 5.25 4.75 4.5 4.25 4 4 4.25 4.5 4.25 15.25 4.75
9.5 6 5.25 4.75 4.25 4.25 4 3.75 3.75 4 4 3.75 12.5`,
    CO: `
20 20 20 20 20 20 20 20 18.25 19 17.25 16 15.25
20 20 20 20 19.75 14 11.75 11 10.25 9.5 9 8.5 8
20 20 20 18.25 15.25 11.25 9.25 8 7.75 7.5 7 6.75 6.5
20 17 12.5 20 13.5 10.25 8.75 7.5 6.5 6.5 6 6 5.75
20 13.25 10.25 9.25 20 10.25 8.75 7.5 6.5 6 5.75 5.5 5.25
20 10.25 8.25 7.25 7.25 20 8.75 7.75 6.75 6 5.25 5.25 5
18.75 8.75 6.75 6.25 6.5 6.25 20 8 7 6.25 5.5 5 4.75
16.25 8.25 6.25 5.75 5.75 5.75 6 20 7.5 6.5 5.75 5 4.5
14.25 7.75 6 5.25 5.25 5.25 5.5 5.75 20 7 6.25 5.5 4.75
14.25 7.25 5.75 5.25 4.75 4.75 4.75 5 5.25 20 6.5 5.75 5.25
13 7 5.75 5 4.75 4.25 4.25 4.5 4.75 5 20 5.5 5
12 6.75 5.5 4.75 4.5 4.25 4 4 4.25 4.5 4.25 18.5 4.75
11.25 6.5 5.25 4.75 4.5 4.25 4 3.75 3.75 4 4 3.75 15`,
    BTN: `
20 20 20 20 20 20 20 20 20 20 20 20 20
20 20 20 20 20 19 15.25 14 13 11.75 11.25 11 10
20 20 20 20 20 13.75 11.25 9.5 9.25 8.75 8 7.5 7.25
20 20 16 20 16.75 12.25 10 8.5 7.5 7.25 6.75 6.5 6
20 18.25 13.25 11.75 20 11.75 9.75 8 7.25 6.25 6 5.75 5.5
20 13.75 10.5 8.75 8.25 20 9.5 8.25 7.25 6.25 5.5 5.5 5.25
20 11.5 8.25 7 6.75 6.75 20 8.75 7.5 6.5 5.75 5 5
20 10.75 7 6.25 6 6 6 20 8 6.75 6 5.25 4.75
19.75 9.75 6.75 5.5 5.5 5.25 5.5 5.75 20 7.25 6.25 5.5 4.75
19.25 9 6.5 5.5 5 4.75 5 5 5.25 20 6.75 6 5.25
16.5 8.5 6.25 5.25 4.75 4.25 4.5 4.5 4.75 5.25 20 5.5 5
15.5 8 6 5 4.5 4.25 4 4.25 4.25 4.5 4.25 20 4.75
14.5 7.75 5.75 5 4.5 4.25 4 3.75 3.75 4 4 3.75 18.25`,
    SB: `
20 20 20 20 20 20 20 20 20 20 20 20 20
20 20 20 20 20 20 20 20 20 20 20 18.5 17.25
20 20 20 20 20 20 20 17 16.25 14.5 13.5 12.5 11.75
20 20 20 20 20 20 17.5 14.25 11.25 11 9.75 9.25 8.75
20 20 20 20 20 18.75 15.25 11.75 10 8.25 8 7.25 7
20 20 19.25 15.75 13.75 20 13.25 11.25 9 7.75 6.5 6.25 6
20 20 16 12.25 10.75 9.75 20 10.25 8.5 7.25 6.25 5.25 5.25
20 20 13.25 10.25 8.75 7.75 7.5 20 8.25 7 6 5.25 4.5
20 18 12 8.5 7.25 6.75 6.25 6 20 7 6.25 5.25 4.75
20 16.75 11 8 6.25 5.75 5.5 5.25 5.25 20 6.5 5.5 4.75
20 15 10 7.5 6 4.75 4.5 4.5 4.5 4.75 20 5.25 4.75
20 14.25 9.5 7 5.75 4.75 4 4 4 4.25 4 20 4.5
20 13 9 6.5 5.25 4.5 4 3.75 3.75 3.75 3.5 3.5 20`,
  },
  sbVsBtn: `
20 20 20 20 20 20 20 20 20 20 20 20 18.75
20 20 20 20 20 17 13.5 12.75 11.75 10.75 10 9.5 8.75
20 20 20 20 17.75 12.25 10 8 7.75 7.25 6.75 6.5 6.25
20 20 14.75 20 15 10.5 8.5 7 6 6 5.5 5.5 5.25
20 16.5 12 10.25 20 10 8 6.5 5.75 5.25 5 4.75 4.75
20 12.5 9 7.5 6.75 20 7.75 6.75 5.75 5 4.5 4.5 4.25
20 10.75 7 6 5.75 5.5 20 7 6 5.25 4.75 4.25 4
20 9.75 6.5 5.5 5 5 5 20 6.25 5.5 4.75 4.25 3.75
17.75 8.75 6 5 4.5 4.5 4.5 4.5 20 5.75 5.25 4.5 4
17.25 8 5.75 4.75 4.25 4.25 4.25 4.25 4.25 20 5.5 4.75 4.25
15 7.5 5.5 4.5 4.25 3.75 3.75 3.75 3.75 4.25 20 4.5 4
14.25 7.25 5.5 4.5 4 3.75 3.5 3.5 3.5 3.75 3.5 20 3.75
13 6.75 5.25 4.25 4 3.5 3.25 3 3 3.25 3 3 15.75`,
  other: `
20 20 20 20 20 16 14 12.25 10.75 10.75 10 9.5 8.75
20 20 17.75 12.75 10.75 8 7.25 6.75 6.5 6.25 6 5.75 5.5
20 11.75 20 9.75 9 6.75 6 5.25 5.25 5.25 5 4.75 4.75
20 9 7.25 20 8.25 6.25 5.5 5 4.75 4.5 4.5 4.5 4.25
17.25 8 6.5 6 20 6.5 5.5 5 4.5 4.25 4.25 4 4
13 6.75 5.5 5.25 5 20 5.5 5 4.5 4.25 3.75 3.75 3.75
11 6 5 4.75 4.5 4.5 20 5.25 4.75 4.25 3.75 3.5 3.5
9.75 5.75 4.75 4.5 4.25 4 4 20 4.75 4.25 3.75 3.5 3.25
8.5 5.5 4.75 4.25 4 3.75 3.75 3.75 19.5 4.5 4 3.5 3.25
8.5 5.25 4.5 4 3.75 3.5 3.5 3.5 3.5 16 4.25 3.75 3.25
8 5.25 4.5 4 3.5 3.25 3.25 3.25 3.25 3.25 13.5 3.5 3
7.75 5 4.25 3.75 3.5 3.25 2.75 2.75 2.75 2.75 2.75 11.5 3
7.25 5 4.25 3.75 3.5 3.25 2.75 2.5 2.5 2.5 2.25 2.25 9.25`, // a non-blind cold-caller (CO vs an LJ shove); use for any caller not covered above
};

function grid(txt) {
  const rows = txt.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const out = {};
  rows.forEach((row, i) => row.forEach((v, j) => {
    out[i === j ? name(i, i) : j > i ? name(i, j, 's') : name(j, i, 'o')] = v;
  }));
  return out;
}
const grids = (o) => Object.fromEntries(Object.entries(o).map(([k, t]) => [k, grid(t)]));

/** PUSH[pos][hand] = max effective stack (bb) to open-shove when folded to you. Cap 20. HU: BTN uses PUSH.SB. */
export const PUSH = grids(PF.push);

/** CALL_PUSH: call an all-in if effective stack (bb) <= value. BB keyed by shover; SB.BTN; other = anyone else. */
export const CALL_PUSH = { BB: grids(PF.callBB), SB: { BTN: grid(PF.sbVsBtn) }, other: grid(PF.other) };

// ---------------------------------------------------------------- heads-up (BTN = SB)
export const HU = {
  BTN_RFI: {
    100: P('22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,82s+,72s+,62s+,52s+,42s+,32s,A2o+,K2o+,Q2o+,J2o+,T3o+,T2o:0.5,94o+,85o+,74o:0.5,75o+,64o:0.5,65o,54o'),
    40: P('22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,82s+,72s+,62s+,52s+,42s+,32s,A2o+,K2o+,Q2o+,J3o+,T5o+,95o+,85o+,75o+,64o:0.5,65o,54o:0.5'),
    25: P('22+,A2s+,K2s+,Q2s+,J2s+,T3s+,94s+,84s+,74s+,63s+,53s+,43s,A2o+,K2o+,Q4o+,J6o+,T7o+,97o+,87o'),
  },
  BB_VS_BTN: {
    100: vs('22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,82s+,72s+,62s+,52s+,42s+,32s,A2o+,K2o+,Q3o+,Q2o:0.5,J5o+,J4o:0.5,T6o+,T5o:0.5,96o+,95o:0.3,86o+,85o:0.5,75o+,74o:0.3,65o,64o:0.5,54o,53o:0.3',
      '88+,77:0.5,A7s+,A5s-A2s:0.6,K9s+,K5s-K2s:0.3,QTs+,JTs,J9s:0.5,T9s:0.5,98s:0.4,87s:0.4,76s:0.4,A9o+,A5o:0.3,KTo+,K9o:0.3,QJo,QTo:0.3,JTo:0.3'),
    40: vs('22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,82s+,72s+,62s+,52s+,42s+,32s,A2o+,K2o+,Q3o+,J5o+,T6o+,96o+,86o+,75o+,65o,54o',
      '77+,66:0.5,A5s+,A4s-A2s:0.5,K9s+,QTs+,JTs,T9s:0.4,A8o+,A5o:0.3,KTo+,QJo:0.5'),
    25: vs('22+,A2s+,K2s+,Q2s+,J2s+,T2s+,93s+,84s+,73s+,63s+,52s+,42s+,32s,A2o+,K2o+,Q4o+,J6o+,T6o+,96o+,86o+,76o,65o',
      '55+,44:0.5,A2s+,K8s+,QTs+,A7o+,A5o,KJo+,QJo:0.5'),
  },
  BTN_VS_3BET: {
    100: v3('22+,A2s+,K5s+,Q7s+,J7s+,T7s+,97s+,86s+,75s+,65s,54s,A5o+,A4o-A2o:0.5,K9o+,QTo+,JTo,T9o:0.5',
      'QQ+,JJ:0.5,AKs,AQs:0.5,AKo,A5s-A3s:0.5,K9s:0.2,K5s:0.2,Q9s:0.2,A9o:0.2'),
  },
};

// ---------------------------------------------------------------- fixed limit (single depth)
const FL_BB_DEFEND = '22+,A2s+,K2s+,Q2s+,J4s+,T6s+,96s+,85s+,75s+,64s+,53s+,43s,A2o+,K5o+,Q7o+,J7o+,T7o+,97o+,87o,76o';
const FL_VS = {
  EP: vs('99+,88:0.3,AJs+,KQs,AQo+', 'TT+,99:0.5,AQs+,AJs:0.5,KQs:0.5,AKo,AQo:0.5'),
  MP: vs('77+,ATs+,KTs+,QJs,JTs:0.5,AJo+,KQo', '99+,88:0.5,ATs+,KJs+,QJs:0.5,AJo+,KQo:0.5'),
  BTN: vs('22+,A7s+,A5s-A2s,K9s+,Q9s+,J9s+,T9s,98s,87s:0.5,ATo+,KJo+,QJo', '77+,66:0.5,A9s+,A5s:0.5,KTs+,QTs+,JTs:0.5,ATo+,KJo+,QJo:0.3'),
  SB: vs('77+,A9s+,A5s:0.5,KTs+,QJs,ATo+,KQo,KJo:0.5', '88+,77:0.5,A9s+,A5s:0.5,KTs+,QJs,ATo+,KQo,KJo:0.5'),
  BB: vs(FL_BB_DEFEND, '99+,88:0.5,ATs+,A5s:0.3,KJs+,QJs:0.5,AJo+,KQo'),
};

/** Fixed-limit preflop. VS_RFI assumes a typical (middle/late) open; tighten vs early position. */
export const FL = {
  RFI: {
    UTG: P('77+,66:0.5,55:0.5,ATs+,A9s:0.5,A5s:0.5,KTs+,QTs+,JTs,AJo+,ATo:0.5,KQo,KJo:0.5'),
    UTG1: P('55+,A8s+,A5s-A4s,K9s+,QTs+,JTs,T9s:0.5,ATo+,KJo+,QJo:0.3'),
    LJ: P('44+,A2s+,K9s+,Q9s+,J9s+,T9s,ATo+,A9o:0.3,KTo+,QJo'),
    HJ: P('33+,A2s+,K7s+,Q9s+,J9s+,T9s,98s,A8o+,KTo+,QTo+,JTo'),
    CO: P('22+,A2s+,K5s+,Q8s+,J8s+,T8s+,98s,87s,A5o+,K9o+,Q9o+,J9o+,T9o'),
    BTN: P('22+,A2s+,K2s+,Q4s+,J6s+,T7s+,97s+,86s+,76s,65s,A2o+,K7o+,Q8o+,J8o+,T8o+,98o'),
    SB: P('22+,A2s+,K2s+,Q2s+,J4s+,T6s+,96s+,85s+,75s+,64s+,54s,A2o+,K5o+,Q7o+,J8o+,T8o+,98o,87o'),
  },
  VS_RFI: { UTG1: FL_VS.EP, LJ: FL_VS.EP, HJ: FL_VS.MP, CO: FL_VS.MP, BTN: FL_VS.BTN, SB: FL_VS.SB, BB: FL_VS.BB },
  BB_DEFEND: P(FL_BB_DEFEND),
};

// ---------------------------------------------------------------- sizing (in big blinds)
export const SIZING = {
  open: { 100: { default: 2.5, BTN: 2.5, SB: 3 }, 40: { default: 2.2, SB: 3 }, 25: { default: 2, SB: 3 } },
  threeBet: { IP: 3, OOP: 4 /* x the open; at <= 25bb effective, a 3-bet that would commit > ~40% of the stack should just be all-in */ },
  fourBet: { IP: 2.2, OOP: 2.5 /* x the 3-bet; at <= 40bb a 4-bet is all-in */ },
  isoRaise: { IP: 3, OOP: 4 /* raise to this + limpAdd per limper, e.g. 1 limper IP -> 4bb */ },
  limpAdd: 1, /* +1bb per limper */
};
