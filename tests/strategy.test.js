import test from 'node:test';
import assert from 'node:assert/strict';
import { equityVsRanges, equityVsRandom } from '../src/strategy/equity.js';
import { rangeOf } from '../src/strategy/rangeModel.js';
import { comboOf } from '../src/strategy/combos.js';
import { analyze } from '../src/strategy/policy.js';
import { createBot } from '../src/strategy/bot.js';
import { PERSONALITIES } from '../src/strategy/personalities.js';
import { adviseNow, reviewHand, describeHand, liveEquity } from '../src/strategy/coach.js';
import { Game, autoPlayHand } from '../src/engine/game.js';
import { runTable, BASELINES } from './strategySim.js';

const near = (x, want, tol, msg) => assert.ok(Math.abs(x - want) <= tol, `${msg}: ${x.toFixed(3)} not within ${tol} of ${want}`);

function isLegal(a, L) {
  if (!a || !L) return false;
  switch (a.type) {
    case 'fold': return L.canFold;
    case 'check': return L.canCheck;
    case 'call': return !L.canCheck && L.callAmount > 0;
    case 'bet': case 'raise':
      if (!(a.type === 'bet' ? L.canBet : L.canRaise) || !Number.isInteger(a.to)) return false;
      return a.to === L.allInTo || (a.to >= L.minTo && a.to <= L.maxTo);
    default: return false;
  }
}

test('equity sanity', () => {
  near(equityVsRanges(['Ah', 'As'], [], [[['Kd', 'Kc', 1]]], { iterations: 30000 }).equity, 0.82, 0.015, 'AA vs KK');
  near(equityVsRanges(['Ah', 'Kh'], [], [[['2d', '2c', 1]]], { iterations: 30000 }).equity, 0.50, 0.025, 'AKs vs 22');
  const fd = equityVsRanges(['Ah', 'Kh'], ['Qh', '7h', '2c'], [[['Qd', 'Jc', 1]]], { iterations: 30000 }).equity;
  assert.ok(fd >= 0.45 && fd <= 0.56, `flush draw + overs vs top pair: ${fd}`);
  near(equityVsRandom(['Ah', 'As'], [], 1, { iterations: 30000 }).equity, 0.85, 0.015, 'AA vs random');
  // exact river vs a Map range: AA loses to the set of kings, beats queens
  const r = equityVsRanges(['Ah', 'As'], ['2c', '3d', '9h', 'Td', 'Kc'], [new Map([['KhKs', 1], ['QdQc', 1]])]);
  assert.equal(r.equity, 0.5);
});

function viewAfter(actions, opts = {}) {
  // 6-max NL, everybody 200: hero = seat 0. Plays `actions` (each a function of the legal set) then returns hero's view.
  const g = new Game({ players: ['hero', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, name: id, isHuman: i === 0 })), betting: opts.betting || 'NL', smallBlind: 1, bigBlind: 2, startingStack: 200, firstButton: opts.button ?? 3, seed: 4 });
  g.startHand({ holeCards: { 0: opts.hero || ['Ah', 'Kd'] }, board: opts.board });
  for (const f of actions) g.act(f(g.legalActions()));
  return g;
}

test('range model: early opens are tighter than late opens, dead cards removed', () => {
  const openRange = (button, folds) => {
    const g = new Game({ players: ['hero', 'b', 'c', 'd', 'e', 'f'].map((id, i) => ({ id, name: id, isHuman: i === 0 })), smallBlind: 1, bigBlind: 2, startingStack: 200, firstButton: button, seed: 4 });
    g.startHand({ holeCards: { 0: ['Ah', 'Kd'] } });
    for (let i = 0; i < folds; i++) g.act({ type: 'fold' });
    const opener = g.state.toAct;
    g.act({ type: 'raise', to: 5 });
    const v = g.viewFor(opener === 0 ? 1 : 0);
    return { pos: v.seats[opener].position, r: rangeOf(v, opener), v };
  };
  const ep = openRange(1, 0); // first to act opens
  const late = openRange(1, 3); // folded to the button
  assert.equal(late.pos, 'BTN');
  assert.ok(late.r.pct > 0.3 && late.r.pct < 0.6, `BTN open ~45%: ${late.r.pct}`);
  assert.ok(ep.r.pct < late.r.pct * 0.6, `${ep.pos} open (${ep.r.pct}) tighter than BTN (${late.r.pct})`);
  // the viewer's own cards are dead in the villain range
  assert.equal(late.v.heroSeat, 0);
  assert.equal(late.r.weights[comboOf('Ah', 'As')], 0, 'combo with a dead card');
  assert.ok(late.r.weights[comboOf('Ac', 'As')] > 0);
  assert.match(late.r.desc, /% of hands/);
});
test('range cache: a new game with the same hand number and cards gets a fresh range', () => {
  // hero (button) opens in one game and limps in another; seat 1 reads hero's range in both
  const pctAfter = (a) => {
    const g = new Game({ players: ['hero', 'b', 'c'].map((id, i) => ({ id, name: id, isHuman: i === 0 })), smallBlind: 1, bigBlind: 2, startingStack: 200, firstButton: 0, seed: 1 });
    g.startHand({ holeCards: { 0: ['Ah', 'Kd'] } });
    g.act(a);
    return rangeOf(g.viewFor(1), 0).pct;
  };
  assert.notEqual(pctAfter({ type: 'raise', to: 6 }), pctAfter({ type: 'call' }));
});

test('coach: a fold with equity just above the price does not claim "only" that equity', () => {
  const g = new Game({ players: ['hero', 'v'].map((id, k) => ({ id, name: id, isHuman: k === 0 })), smallBlind: 1, bigBlind: 2, startingStack: 200, firstButton: 1, seed: 1 });
  g.startHand({ holeCards: { 0: ['2c', '8c'] }, board: ['Kh', '9s', '4c', '2d', '7h'] });
  g.act({ type: 'raise', to: 5 }); g.act({ type: 'call' }); g.act({ type: 'check' }); g.act({ type: 'bet', to: 3 });
  const v = g.viewFor(0), f = analyze(v).facts, adv = adviseNow(v); // equity ~20% vs 19% needed, out of position
  assert.equal(adv.action.type, 'fold');
  assert.equal(/only about/.test(adv.headline), f.equity < f.requiredEquity, adv.headline);
});

test('policy: every option is legal, frequencies sum to 1 (NL/PL/FL fuzz)', () => {
  for (const betting of ['NL', 'PL', 'FL']) {
    for (const structure of ['cash', 'tournament']) {
      const n = 3 + (betting.length % 4);
      const ids = Object.keys(PERSONALITIES).slice(0, n);
      const g = new Game({ players: ids.map((id) => ({ id, name: id })), betting, structure, smallBlind: 1, bigBlind: 2, startingStack: structure === 'cash' ? 200 : 40, seed: 99, tournament: { handsPerLevel: 4, levels: [{ sb: 1, bb: 2, ante: 0 }, { sb: 2, bb: 4, ante: 1 }, { sb: 4, bb: 8, ante: 1 }] } });
      for (let h = 0; h < 40 && !g.state.gameOver; h++) {
        autoPlayHand(g, (v) => {
          const a = analyze(v);
          const tot = a.options.reduce((s, o) => s + o.freq, 0);
          near(tot, 1, 1e-9, 'freq sum');
          for (const o of a.options) assert.ok(isLegal(o.action, v.legal), `${betting} illegal option ${JSON.stringify(o.action)} legal=${JSON.stringify(v.legal)}`);
          return a.options[0].action;
        });
      }
    }
  }
});

test('bots never act illegally across thousands of hands (all formats, 2-8 players)', () => {
  const ids = Object.keys(PERSONALITIES);
  let hands = 0;
  for (const betting of ['NL', 'PL', 'FL']) {
    for (const [n, structure] of [[2, 'cash'], [6, 'cash'], [8, 'tournament'], [3, 'tournament']]) {
      const players = Array.from({ length: n }, (_, i) => ({ id: `${ids[i % 7]}${i}`, name: ids[i % 7], bot: createBot(ids[i % 7]) }));
      const g = new Game({ players, betting, structure, smallBlind: 1, bigBlind: 2, ante: 0, startingStack: structure === 'cash' ? 200 : 60, seed: 7 + n, tournament: { handsPerLevel: 6, levels: [{ sb: 1, bb: 2, ante: 0 }, { sb: 2, bb: 4, ante: 0 }, { sb: 3, bb: 6, ante: 1 }, { sb: 5, bb: 10, ante: 1 }, { sb: 10, bb: 20, ante: 2 }] } });
      for (let h = 0; h < 300 && !g.state.gameOver; h++) {
        autoPlayHand(g, (v) => {
          const a = players[v.heroSeat].bot.decide(v);
          assert.ok(isLegal(a, v.legal), `illegal ${JSON.stringify(a)} for ${JSON.stringify(v.legal)}`);
          return a;
        });
        hands++;
      }
    }
  }
  assert.ok(hands >= 1500, `played ${hands}`);
});

test('bot thinkMs is human-ish', () => {
  const g = viewAfter([]);
  const b = createBot('jeff');
  const v = g.viewFor(g.state.toAct);
  for (let i = 0; i < 20; i++) { const ms = b.thinkMs(v); assert.ok(ms >= 600 && ms <= 2500); }
});

test('coach: advice, review and live aids have the contract shape', () => {
  const g = new Game({ players: ['hero', 'jeff', 'abed'].map((id, i) => ({ id, name: id, isHuman: i === 0 })), smallBlind: 1, bigBlind: 2, startingStack: 200, seed: 12 });
  const bots = { jeff: createBot('jeff'), abed: createBot('abed'), hero: createBot('annie') };
  let advised = 0;
  for (let h = 0; h < 25; h++) {
    autoPlayHand(g, (v) => {
      if (v.heroId === 'hero') {
        const t = performance.now();
        const adv = adviseNow(v);
        assert.ok(performance.now() - t < 300);
        assert.ok(isLegal(adv.action, v.legal));
        assert.equal(typeof adv.label, 'string');
        assert.equal(typeof adv.headline, 'string');
        assert.ok(Array.isArray(adv.reasons) && adv.reasons.length >= 1 && adv.reasons.length <= 4);
        assert.doesNotMatch(adv.reasons.join(' '), /You have [^.]*[A-Z]/, 'hand name reads as plain lower-case text');
        assert.equal(adv.numbers.potSize, v.legal.pot);
        assert.ok(Array.isArray(adv.terms));
        const t2 = performance.now();
        const le = liveEquity(v);
        assert.ok(performance.now() - t2 < 50, 'liveEquity < 50ms');
        assert.ok(le.equity >= 0 && le.equity <= 1 && ['estimated ranges', 'random hands'].includes(le.vs));
        assert.equal(le.equity, adv.numbers.equity, 'live aid and coach show the same equity');
        advised++;
      }
      return bots[v.heroId].decide(v);
    });
  }
  assert.ok(advised > 10);
  for (const rec of g.history) {
    const r = reviewHand(rec);
    assert.equal(typeof r.summary, 'string');
    assert.equal(r.decisions.length, rec.heroDecisions.length);
    assert.equal(r.score.good + r.score.okay + r.score.mistake, r.decisions.length);
    for (const d of r.decisions) {
      assert.ok(['good', 'okay', 'mistake'].includes(d.verdict));
      assert.ok(d.youDid && d.coachSays && d.explanation);
    }
  }
  // the coach grading its own baseline: almost everything should be good
  const own = g.history.flatMap((rec) => reviewHand(rec).decisions);
  assert.ok(own.filter((d) => d.verdict === 'mistake').length <= own.length * 0.1);
  const dh = describeHand(['Ah', 'Kh'], ['Qh', '7h', '2c']);
  assert.equal(dh.name, 'High Card, Ace high');
  assert.ok(dh.draws.includes('Flush draw') && dh.outs === 9);
  assert.equal(describeHand(['Ah', 'Ad'], []).name, 'Pocket Aces');
});

test('coach: clear spots get the obvious advice', () => {
  // hero AA on the BTN facing nothing: open. Button seat 0.
  const g = new Game({ players: ['hero', 'b', 'c'].map((id, i) => ({ id, name: id, isHuman: i === 0 })), smallBlind: 1, bigBlind: 2, startingStack: 200, firstButton: 0, seed: 1 });
  g.startHand({ holeCards: { 0: ['Ah', 'Ad'] } });
  assert.equal(adviseNow(g.viewFor(0)).action.type, 'raise');
  // hero 72o facing a 3-bet: fold
  const g2 = new Game({ players: ['hero', 'b', 'c'].map((id, i) => ({ id, name: id, isHuman: i === 0 })), smallBlind: 1, bigBlind: 2, startingStack: 200, firstButton: 0, seed: 1 });
  g2.startHand({ holeCards: { 0: ['7h', '2d'] } });
  g2.act({ type: 'raise', to: 5 }); g2.act({ type: 'raise', to: 18 }); g2.act({ type: 'fold' });
  assert.equal(adviseNow(g2.viewFor(0)).action.type, 'fold');
  // river nuts: bet or raise, never fold
  const g3 = new Game({ players: ['hero', 'b'].map((id, i) => ({ id, name: id, isHuman: i === 0 })), smallBlind: 1, bigBlind: 2, startingStack: 200, firstButton: 1, seed: 1 });
  g3.startHand({ holeCards: { 0: ['Ah', 'Kh'] }, board: ['Qh', 'Jh', 'Th', '3c', '4d'] });
  g3.act({ type: 'raise', to: 5 }); g3.act({ type: 'call' });
  while (g3.state.street !== 'river') g3.act({ type: 'check' });
  if (g3.state.toAct !== 0) g3.act({ type: 'bet', to: 6 });
  const adv = adviseNow(g3.viewFor(0));
  assert.ok(['bet', 'raise'].includes(adv.action.type), JSON.stringify(adv.action));
});

test('coach explains a fold that beats the raw pot odds (ATo vs UTG open)', () => {
  const g = new Game({ players: ['hero', 'a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, i) => ({ id, name: id, isHuman: i === 0 })), smallBlind: 1, bigBlind: 2, startingStack: 200, firstButton: 0, seed: 2 });
  g.startHand({ holeCards: { 0: ['Ah', 'Td'] } });
  g.act({ type: 'raise', to: 5 });
  for (let i = 0; i < 4; i++) g.act({ type: 'fold' });
  const adv = adviseNow(g.viewFor(0));
  assert.equal(adv.action.type, 'fold');
  assert.doesNotMatch(adv.headline, /\([^)]*\(/, 'no nested parentheses');
  if (adv.numbers.equity > adv.numbers.potOdds) {
    assert.ok(adv.reasons.some((r) => /realiz/.test(r)), adv.reasons.join(' | '));
    assert.ok(adv.terms.some((t) => t.term === 'equity realization'));
  }
  near(adv.numbers.potOdds, 5 / 13, 1e-9, 'pot odds = toCall / (pot + toCall)');
});

test('strength smoke: bots beat a calling station and keep decisions fast', () => {
  const bot = (id) => { const b = createBot(id); return { id, isBot: true, decide: (v) => b.decide(v) }; };
  const st = (n) => ({ id: `station${n}`, decide: BASELINES.station });
  const r = runTable({ players: [bot('abed'), st(1), bot('annie'), st(2)], hands: 300, seed: 3 });
  assert.ok(r.bb100.abed + r.bb100.annie > 0, JSON.stringify(r.bb100));
  assert.ok(r.median < 25, `median decision ${r.median}ms`);
});
