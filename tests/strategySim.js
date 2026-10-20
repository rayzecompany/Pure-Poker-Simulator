// Strength check (not part of `npm test`): node tests/strategySim.js [hands]
// Bots vs exploitable baselines and bots vs each other; prints bb/100 per seat and decision times.
import { Game, autoPlayHand } from '../src/engine/game.js';
import { createBot } from '../src/strategy/bot.js';
import { chen, handClassOf } from '../src/strategy/combos.js';
import { evaluate } from '../src/engine/evaluator.js';

export const BASELINES = {
  station: (v) => (v.legal.canCheck ? { type: 'check' } : { type: 'call' }),
  random: (v, rng = Math.random) => {
    const L = v.legal, r = rng();
    if ((L.canBet || L.canRaise) && r < 0.25) {
      const to = Math.round(L.minTo + rng() * Math.min(L.maxTo - L.minTo, L.pot * 1.5));
      return { type: L.canBet ? 'bet' : 'raise', to: Math.min(to, L.maxTo) };
    }
    if (!L.canCheck && r < 0.55) return { type: 'fold' };
    return L.canCheck ? { type: 'check' } : { type: 'call' };
  },
  tightPassive: (v) => {
    const L = v.legal, me = v.seats[v.heroSeat];
    let ok;
    if (v.street === 'preflop') ok = chen(handClassOf(me.holeCards[0], me.holeCards[1])) >= 9;
    else ok = evaluate([...me.holeCards, ...v.board]).category >= 1 && (L.callAmount <= L.pot * 0.7 || evaluate([...me.holeCards, ...v.board]).category >= 2);
    if (L.canCheck) return { type: 'check' };
    return ok ? { type: 'call' } : { type: 'fold' };
  },
};

export function runTable({ players, hands = 1000, betting = 'NL', seed = 1, startingStack = 200 }) {
  const g = new Game({ players: players.map((p) => ({ id: p.id, name: p.id })), betting, structure: 'cash', smallBlind: 1, bigBlind: 2, startingStack, seed, cash: { autoRebuyBots: true, rebuyTo: startingStack } });
  const net = Object.fromEntries(players.map((p) => [p.id, 0]));
  const times = [];
  for (let h = 0; h < hands; h++) {
    for (const s of g.state.seats) if (s.stack < startingStack) s.stack = startingStack; // top up every hand: fixed depth
    const before = g.state.seats.map((s) => s.stack);
    autoPlayHand(g, (v) => {
      const p = players.find((x) => x.id === v.heroId);
      const t = performance.now();
      const a = p.decide(v);
      if (p.isBot) times.push(performance.now() - t);
      return a;
    });
    g.state.seats.forEach((s, i) => { net[s.id] += s.stack - before[i]; });
  }
  const bb100 = Object.fromEntries(Object.entries(net).map(([id, n]) => [id, Math.round((n / 2 / hands) * 100 * 10) / 10]));
  times.sort((a, b) => a - b);
  return { bb100, median: times[times.length >> 1], p99: times[Math.floor(times.length * 0.99)], max: times[times.length - 1] };
}

const bot = (id, name = id) => { const b = createBot(id); return { id: name, isBot: true, decide: (v) => b.decide(v) }; };
const base = (kind, n) => ({ id: `${kind}${n}`, decide: (v) => BASELINES[kind](v) });

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('strategySim.js')) {
  const hands = Number(process.argv[2]) || 2000;
  for (const kind of ['station', 'random', 'tightPassive']) {
    for (const betting of ['NL']) {
      const r = runTable({ players: [bot('abed'), base(kind, 1), bot('jeff'), base(kind, 2), bot('annie'), base(kind, 3)], hands, betting, seed: 11 });
      console.log(`${betting} vs ${kind}: ${JSON.stringify(r.bb100)} | decision ms median ${r.median.toFixed(2)} p99 ${r.p99.toFixed(1)} max ${r.max.toFixed(1)}`);
    }
  }
  for (const betting of ['NL', 'PL', 'FL']) {
    const r = runTable({ players: ['jeff', 'annie', 'britta', 'pierce', 'abed', 'troy', 'shirley'].map((id) => bot(id)), hands, betting, seed: 5 });
    console.log(`${betting} bots only: ${JSON.stringify(r.bb100)} | median ${r.median.toFixed(2)}ms max ${r.max.toFixed(1)}ms`);
  }
}
