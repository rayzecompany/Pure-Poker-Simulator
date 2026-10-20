import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, autoPlayHand } from '../src/engine/game.js';
import { positionsFor, displayLabel } from '../src/engine/positions.js';
import { makeRng } from '../src/engine/cards.js';

const h = (s) => s.split(' ');
function mk(n, o = {}) {
  const players = Array.from({ length: n }, (_, i) => ({ id: i === 0 ? 'hero' : `p${i}`, name: `P${i}`, isHuman: i === 0, stack: o.stacks?.[i] }));
  return new Game({
    players, betting: o.betting || 'NL', structure: o.structure || 'cash',
    smallBlind: o.sb ?? 1, bigBlind: o.bb ?? 2, ante: o.ante || 0, bigBlindAnte: !!o.bba,
    startingStack: o.start ?? 200, firstButton: o.button ?? 0, seed: o.seed ?? 1,
    cash: { autoRebuyBots: !!o.autoRebuy, rebuyTo: 200 }, tournament: o.tournament,
  });
}
const st = (g) => g.state;
const stacks = (g) => g.state.seats.map((p) => p.stack);
const A = (type, to) => (to === undefined ? { type } : { type, to });

test('positions', () => {
  assert.deepEqual(positionsFor(2), ['BTN', 'BB']);
  assert.deepEqual(positionsFor(6), ['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  assert.deepEqual(positionsFor(8), ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
  assert.equal(displayLabel('BTN', 2), 'BTN/SB');
  assert.equal(displayLabel('LJ', 6), 'UTG');
  assert.equal(displayLabel('UTG1', 8), 'UTG+1');
  assert.equal(displayLabel('CO', 4), 'CO');
});

test('heads-up: button posts SB, acts first preflop, last postflop', () => {
  const g = mk(2);
  g.startHand();
  const s = st(g);
  assert.equal(s.buttonSeat, 0); assert.equal(s.sbSeat, 0); assert.equal(s.bbSeat, 1);
  assert.equal(s.seats[0].position, 'BTN'); assert.equal(s.seats[0].positionLabel, 'BTN/SB');
  assert.equal(s.seats[0].bet, 1); assert.equal(s.seats[1].bet, 2);
  assert.equal(s.toAct, 0);
  g.act(A('call'));
  assert.equal(s.toAct, 1); // BB option
  assert.ok(g.legalActions().canRaise);
  g.act(A('check'));
  assert.equal(s.street, 'flop'); assert.equal(s.board.length, 3);
  assert.equal(s.toAct, 1);
  g.act(A('check')); assert.equal(s.toAct, 0); g.act(A('check'));
  assert.equal(s.street, 'turn'); assert.equal(s.toAct, 1);
  // next hand: button moves
  g.act(A('bet', 2)); g.act(A('fold'));
  g.startHand();
  assert.equal(s.buttonSeat, 1); assert.equal(s.toAct, 1);
});

test('4-handed: order preflop and postflop, button movement skips sitting-out players', () => {
  const g = mk(4);
  g.startHand();
  const s = st(g);
  assert.deepEqual([s.buttonSeat, s.sbSeat, s.bbSeat, s.toAct], [0, 1, 2, 3]);
  assert.deepEqual(s.seats.map((p) => p.position), ['BTN', 'SB', 'BB', 'CO']);
  g.act(A('call')); g.act(A('call')); g.act(A('call'));
  assert.equal(s.toAct, 2); g.act(A('check'));
  assert.equal(s.street, 'flop'); assert.equal(s.toAct, 1);
  g.act(A('check')); g.act(A('check')); g.act(A('check')); g.act(A('bet', 10));
  assert.equal(s.toAct, 1);
  g.act(A('fold')); g.act(A('fold')); g.act(A('fold'));
  assert.equal(s.street, 'complete');
  assert.equal(s.result.payouts[0], 8); // uncalled 10 returned separately
  assert.deepEqual(s.result.returned, [{ seat: 0, amount: 10, street: 'flop' }]);
  s.seats[1].stack = 0; // seat 1 sits out (cash, no auto rebuy)
  g.startHand();
  assert.equal(s.seats[1].inHand, false); assert.equal(s.seats[1].folded, true);
  assert.deepEqual([s.buttonSeat, s.sbSeat, s.bbSeat, s.toAct], [2, 3, 0, 2]);
});

test('3-way all-in side pots with different stacks; uncalled excess returned', () => {
  const g = mk(3, { stacks: [50, 100, 200] });
  g.startHand({ holeCards: { 0: h('Ah Ad'), 1: h('Kh Kd'), 2: h('Qh Qd') }, board: h('2c 5d 9h Js 3c') });
  const s = st(g);
  assert.equal(s.toAct, 0);
  g.act(A('raise', 50));
  assert.equal(g.legalActions().minTo, 98);
  g.act(A('call'));
  assert.equal(g.legalActions().minTo, 98);
  g.act(A('raise', 200));
  g.act(A('call')); // seat 1 all-in for 100 total
  assert.equal(s.street, 'complete');
  const r = s.result;
  assert.equal(r.showdown, true);
  assert.deepEqual(r.returned, [{ seat: 2, amount: 100, street: 'preflop' }]);
  assert.deepEqual(r.pots.map((p) => [p.amount, p.winners, p.eligible]), [[150, [0], [0, 1, 2]], [100, [1], [1, 2]]]);
  assert.equal(r.pots[0].handName, 'Pair of Aces');
  assert.deepEqual(stacks(g), [150, 100, 100]);
  assert.deepEqual(Object.keys(r.revealed).sort(), ['0', '1', '2']); // all-in: everyone face up
  assert.equal(s.seats[0].busted, false);

  // when everyone else is all-in, the last player may only call or fold
  const g2 = mk(3, { stacks: [50, 100, 200] });
  g2.startHand();
  g2.act(A('raise', 50)); g2.act(A('raise', 100));
  const L = g2.legalActions();
  assert.equal(L.seat, 2); assert.equal(L.canRaise, false); assert.equal(L.callAmount, 98);
});

test('3-way split of 7 chips: 3/2/2 in clockwise order from the button', () => {
  const g = mk(4, { button: 0 });
  // seat 3 (UTG) calls, BTN calls, SB folds, BB checks; pot = 2*3 + 1 = 7
  g.startHand({ holeCards: { 0: h('2c 3d'), 1: h('6c 7d'), 2: h('4c 5d'), 3: h('2h 3h') }, board: h('As Ks Qs Js Ts') });
  g.act(A('call')); g.act(A('call')); g.act(A('fold')); g.act(A('check'));
  while (st(g).toAct !== null) g.act(A('check'));
  const r = st(g).result;
  assert.deepEqual(r.pots[0].winners, [2, 3, 0]);
  assert.deepEqual(r.payouts, { 2: 3, 3: 2, 0: 2 });
});

test('NL incomplete all-in raise does not reopen action', () => {
  const g = mk(4, { stacks: [30, 200, 200, 200] });
  g.startHand();
  const s = st(g);
  assert.equal(s.toAct, 3);
  g.act(A('raise', 20)); // increment 18
  g.act(A('raise', 30)); // seat 0 all-in, +10 < 18: incomplete
  assert.equal(s.lastRaiseSize, 18);
  g.act(A('fold'));
  let L = g.legalActions(); // BB has not acted yet: may raise
  assert.equal(L.seat, 2); assert.equal(L.canRaise, true); assert.equal(L.minTo, 48);
  g.act(A('call'));
  L = g.legalActions();
  assert.equal(L.seat, 3);
  assert.equal(L.canRaise, false);
  assert.equal(L.callAmount, 10);
  assert.throws(() => g.act(A('raise', 200)));
  g.act(A('call'));
  assert.equal(s.street, 'flop');
});

test('NL two incomplete all-ins adding up to a full raise do reopen', () => {
  const g = mk(4, { stacks: [30, 40, 200, 200] });
  g.startHand();
  g.act(A('raise', 20)); g.act(A('raise', 30)); g.act(A('raise', 40)); g.act(A('call'));
  const L = g.legalActions();
  assert.equal(L.seat, 3);
  assert.equal(L.canRaise, true); // faces +20 >= 18
  assert.equal(L.minTo, 58);
});

test('NL min-raise and min-bet', () => {
  const g = mk(3);
  g.startHand();
  let L = g.legalActions();
  assert.deepEqual([L.minTo, L.maxTo, L.allInTo, L.callAmount], [4, 200, 200, 2]);
  g.act(A('raise', 7)); // +5
  L = g.legalActions();
  assert.equal(L.minTo, 12);
  assert.throws(() => g.act(A('raise', 11)));
  g.act(A('call')); g.act(A('call'));
  L = g.legalActions();
  assert.equal(L.canBet, true); assert.equal(L.minTo, 2); assert.equal(L.canCheck, true);
});

test('PL max raise math', () => {
  const g = mk(4, { betting: 'PL' });
  g.startHand();
  let L = g.legalActions(); // UTG: pot 3, call 2 -> raise to 2 + 5 = 7
  assert.equal(L.maxTo, 7);
  g.act(A('call')); // pot 5
  L = g.legalActions(); // BTN: 2 + (5 + 2) = 9
  assert.equal(L.maxTo, 9); assert.equal(L.minTo, 4);
  assert.throws(() => g.act(A('raise', 10)));
  assert.throws(() => g.act(A('raise', L.allInTo))); // all-in over the pot is not allowed in PL
  g.act(A('raise', 9)); // pot 14
  L = g.legalActions(); // SB has 1 in: call 8 -> pot 22 -> raise to 9 + 22 = 31
  assert.equal(L.maxTo, 31); assert.equal(L.minTo, 16);
  g.act(A('call')); g.act(A('call')); g.act(A('call')); // pot 36
  L = g.legalActions();
  assert.equal(st(g).street, 'flop'); assert.equal(st(g).pot, 36);
  assert.equal(L.maxTo, 36); assert.equal(L.minTo, 2);
  g.act(A('bet', 10)); // pot 46; next: call 10 -> 56 -> raise to 10 + 56 = 66
  assert.equal(g.legalActions().maxTo, 66);
});

test('FL fixed sizes and 4-bet cap', () => {
  const g = mk(4, { betting: 'FL' });
  g.startHand();
  let L = g.legalActions();
  assert.deepEqual([L.minTo, L.maxTo], [4, 4]);
  g.act(A('raise', 4)); g.act(A('raise', 6)); g.act(A('raise', 8));
  L = g.legalActions();
  assert.equal(L.seat, 2); assert.equal(L.canRaise, false); assert.equal(L.callAmount, 6);
  g.act(A('call')); g.act(A('call')); g.act(A('call'));
  assert.equal(st(g).street, 'flop');
  L = g.legalActions(); assert.deepEqual([L.minTo, L.maxTo], [2, 2]);
  g.act(A('bet', 2)); g.act(A('fold')); g.act(A('fold')); g.act(A('call'));
  assert.equal(st(g).street, 'turn');
  L = g.legalActions(); assert.deepEqual([L.minTo, L.maxTo], [4, 4]);
  assert.throws(() => g.act(A('bet', L.allInTo))); // no shoving in limit
});

test('FL all-in of half a bet or more reopens; less does not', () => {
  // blinds 5/10; seat 2 has 16 (or 14) left on the flop where the bet is 10
  for (const [bbStack, reopens, cMin] of [[26, true, 26], [24, false, 20]]) {
    const g = mk(3, { betting: 'FL', sb: 5, bb: 10, stacks: [200, 200, bbStack] });
    g.startHand();
    g.act(A('call')); g.act(A('call')); g.act(A('check'));
    assert.equal(st(g).street, 'flop'); assert.equal(st(g).toAct, 1);
    g.act(A('bet', 10));
    g.act(A('raise', bbStack - 10)); // all-in
    const C = g.legalActions();
    assert.equal(C.seat, 0); assert.equal(C.minTo, cMin); assert.equal(C.maxTo, cMin);
    g.act(A('call'));
    const L = g.legalActions();
    assert.equal(L.seat, 1); assert.equal(L.canRaise, reopens);
  }
});

test('everyone folds: winner does not show, gets uncalled raise back', () => {
  const g = mk(3);
  g.startHand();
  g.act(A('raise', 6)); g.act(A('fold')); g.act(A('fold'));
  const r = st(g).result;
  assert.equal(r.showdown, false); assert.deepEqual(r.revealed, {});
  assert.deepEqual(r.payouts, { 0: 5 });
  assert.deepEqual(stacks(g), [203, 199, 198]);
  assert.equal(g.viewFor('p1').seats[0].holeCards, null);
});

test('antes are dead money; BB-ante; short blinds', () => {
  let g = mk(4, { ante: 1, betting: 'PL' });
  g.startHand();
  let s = st(g);
  assert.equal(s.pot, 7);
  assert.equal(s.actions.filter((a) => a.type === 'post-ante').length, 4);
  let L = g.legalActions();
  assert.equal(L.callAmount, 2);
  assert.equal(L.maxTo, 2 + 7 + 2);

  g = mk(4, { bba: true });
  g.startHand();
  s = st(g);
  assert.equal(s.pot, 5);
  assert.equal(s.seats[2].stack, 196);
  assert.equal(s.seats[2].bet, 2);

  g = mk(4, { bba: true, stacks: [200, 200, 3, 200] });
  g.startHand();
  s = st(g);
  // short BB with BB-ante: ante (2) first, then the blind with what's left (1)
  assert.equal(s.seats[2].bet, 1); assert.equal(s.seats[2].totalBet, 3); assert.equal(s.seats[2].allIn, true);
  assert.deepEqual(s.actions.filter((a) => a.seat === 2).map((a) => [a.type, a.amount]), [['post-ante', 2], ['post-bb', 1]]);
  assert.equal(s.currentBet, 2);

  g = mk(3, { stacks: [200, 200, 1] }); // BB short: others still owe the full blind
  g.startHand();
  s = st(g);
  assert.equal(s.seats[2].bet, 1); assert.equal(s.seats[2].allIn, true);
  assert.equal(s.currentBet, 2); assert.equal(g.legalActions().callAmount, 2);
});

test('BB-ante is dead money: never refunded; a short BB wins only the main pot', () => {
  let g = mk(4, { bba: true });
  g.startHand();
  g.act(A('call')); g.act(A('call')); g.act(A('call')); g.act(A('check'));
  assert.equal(st(g).street, 'flop'); assert.equal(st(g).pot, 10); assert.deepEqual(st(g).returned, []);

  g = mk(4, { bba: true, stacks: [200, 200, 3, 200] }); // BB: ante 2, then 1 of the blind
  g.startHand();
  g.act(A('call')); g.act(A('call')); g.act(A('call'));
  assert.equal(st(g).street, 'flop'); assert.deepEqual(st(g).returned, []);
  assert.deepEqual(st(g).pots, [{ amount: 6, eligible: [0, 1, 2, 3] }, { amount: 3, eligible: [0, 1, 3] }]);
});

test('blind all-in leaves no one to act: board runs out', () => {
  const g = mk(2, { stacks: [200, 2] });
  const streets = [];
  g.on('street', (st) => streets.push(st));
  g.startHand({ holeCards: { 0: h('2c 7d'), 1: h('Ah Ad') }, board: h('Kc Qd 9h 4s 3c') });
  assert.equal(g.legalActions().seat, 0); // SB must still call or fold
  g.act(A('call'));
  assert.deepEqual(streets, ['flop', 'turn', 'river']);
  assert.deepEqual(stacks(g), [198, 4]);
});

test('showdown order and mucking', () => {
  const g = mk(3);
  g.startHand({ holeCards: { 0: h('Ah Ad'), 1: h('7c 2d'), 2: h('Kh Kd') }, board: h('2c 5d 9h Js 3c') });
  g.act(A('call')); g.act(A('call')); g.act(A('check'));
  for (let i = 0; i < 6; i++) g.act(A('check'));
  // river: SB (seat 1) checks, BB bets, BTN calls, SB calls -> BB shows first, BTN beats it, SB mucks
  g.act(A('check')); g.act(A('bet', 4)); g.act(A('call')); g.act(A('call'));
  const r = st(g).result;
  assert.deepEqual(Object.keys(r.revealed).sort(), ['0', '2']);
  assert.deepEqual(r.pots[0].winners, [0]);
  const v = g.viewFor('p2');
  assert.equal(v.seats[1].holeCards, null); // mucked stays hidden
  assert.deepEqual(v.seats[0].holeCards, h('Ah Ad'));

  // checked down: first left of the button shows first
  const g2 = mk(3);
  g2.startHand({ holeCards: { 0: h('Ah Ad'), 1: h('Kh Kd'), 2: h('7c 2d') }, board: h('2c 5d 9h Js 3c') });
  g2.act(A('call')); g2.act(A('call')); g2.act(A('check'));
  while (st(g2).toAct !== null) g2.act(A('check'));
  // order 1 (KK shows), 2 (pair of 2s, beaten -> mucks), 0 (AA shows)
  assert.deepEqual(Object.keys(st(g2).result.revealed).sort(), ['0', '1']);

  // TDA 16: a river all-in that is called tables every hand, so the loser can't muck
  const g3 = mk(2, { stacks: [200, 50] });
  g3.startHand({ holeCards: { 0: h('7c 2d'), 1: h('Ah Ad') }, board: h('Kc Qd 9h 4s 3c') });
  g3.act(A('call')); g3.act(A('check'));
  for (let i = 0; i < 4; i++) g3.act(A('check'));
  g3.act(A('bet', 48)); g3.act(A('call'));
  assert.deepEqual(Object.keys(st(g3).result.revealed).sort(), ['0', '1']);
});

test('viewFor hides cards and is a deep copy; heroDecisions snapshots', () => {
  const g = mk(3);
  g.startHand();
  const v = g.viewFor('p1');
  assert.equal(v.seats[0].holeCards, null);
  assert.equal(v.seats[2].holeCards, null);
  assert.equal(v.seats[1].holeCards.length, 2);
  assert.equal(v.heroSeat, 1); assert.equal(v.heroId, 'p1'); assert.equal(v.legal, null);
  assert.equal(v.numActive, 3); assert.equal(v.bigBlind, 2);
  v.seats[1].stack = 0; v.seats[1].holeCards.push('XX'); v.board.push('As');
  assert.equal(st(g).seats[1].stack, 199); assert.equal(st(g).seats[1].holeCards.length, 2); assert.equal(st(g).board.length, 0);
  const hv = g.viewFor('hero');
  assert.equal(hv.legal.seat, 0);
  g.act(A('raise', 6)); g.act(A('fold')); g.act(A('fold'));
  const rec = g.history.at(-1);
  assert.equal(rec.heroDecisions.length, 1);
  assert.deepEqual(rec.heroDecisions[0].action, { type: 'raise', to: 6 });
  assert.equal(rec.heroDecisions[0].view.legal.minTo, 4);
  assert.equal(rec.heroDecisions[0].view.seats[1].holeCards, null);
  assert.equal(rec.heroCards.length, 2);
  assert.equal(rec.seats[0].stack, 200);
});

test('tournament: level up, busting, game over', () => {
  const levels = [{ sb: 1, bb: 2, ante: 0 }, { sb: 2, bb: 4, ante: 1 }];
  const g = mk(3, { structure: 'tournament', tournament: { handsPerLevel: 2, levels }, stacks: [100, 100, 10] });
  const ups = [], busts = [];
  g.on('levelUp', (l) => ups.push(l)); g.on('busted', (i) => busts.push(i));
  const foldAll = (v) => (v.legal.canCheck ? A('check') : A('fold'));
  autoPlayHand(g, foldAll); autoPlayHand(g, foldAll);
  assert.equal(st(g).bigBlind, 2);
  g.startHand({ holeCards: { 0: h('Ah Ad'), 1: h('Kh Kd'), 2: h('7c 2d') }, board: h('2c 5d 9h Js 3c') });
  assert.deepEqual(ups, [1]);
  assert.equal(st(g).bigBlind, 4); assert.equal(st(g).ante, 1);
  while (st(g).toAct !== null) {
    const L = g.legalActions();
    g.act(L.seat === 2 ? A('raise', L.allInTo) : A('call'));
  }
  assert.ok(busts.includes(2));
  assert.equal(st(g).seats[2].busted, true);
  assert.equal(st(g).gameOver, false);
  g.startHand();
  assert.equal(st(g).seats[2].inHand, false);
  assert.equal(st(g).seats.filter((p) => p.inHand).length, 2);
  assert.equal(st(g).sbSeat, st(g).buttonSeat); // heads-up now
  const total = st(g).seats.reduce((a, p) => a + p.stack + p.totalBet, 0);
  assert.equal(total, 210);
  while (st(g).toAct !== null) g.act(g.legalActions().canRaise ? A('raise', g.legalActions().allInTo) : A('call'));
  assert.equal(st(g).gameOver, true);
  assert.throws(() => g.startHand());
});

test('cash: bots auto-rebuy, hero rebuy()', () => {
  const g = mk(3, { autoRebuy: true });
  g.startHand();
  assert.throws(() => g.rebuy('hero', 100));
  while (st(g).toAct !== null) g.act(A('fold'));
  st(g).seats[1].stack = 0; st(g).seats[0].stack = 0;
  g.rebuy('hero');
  assert.equal(st(g).seats[0].stack, 200);
  g.startHand();
  assert.equal(st(g).seats[1].stack + st(g).seats[1].totalBet, 200);
});

function randomDecide(rng) {
  return (v) => {
    const L = v.legal, x = rng(), me = v.seats[v.heroSeat];
    assert.equal(L.seat, v.heroSeat);
    assert.ok(!me.folded && !me.allIn && me.stack > 0);
    assert.ok(L.callAmount <= me.stack && L.allInTo === me.bet + me.stack);
    if (L.canBet || L.canRaise) assert.ok(L.minTo > v.currentBet && L.minTo <= L.maxTo && L.maxTo <= L.allInTo);
    if (v.betting === 'FL' && (L.canBet || L.canRaise) && L.allInTo > L.maxTo) assert.equal(L.minTo, L.maxTo);
    if (L.callAmount > 0 && x < 0.2) return A('fold');
    if ((L.canBet || L.canRaise) && x > 0.65) {
      const type = L.canBet ? 'bet' : 'raise';
      const y = rng();
      if (y < 0.25) return A(type, L.maxTo);
      return A(type, L.minTo + Math.floor(rng() * (L.maxTo - L.minTo + 1)));
    }
    return L.canCheck ? A('check') : A('call');
  };
}

test('fuzz: chip conservation, no negative stacks, every hand completes', () => {
  const rng = makeRng(2024);
  const decide = randomDecide(rng);
  let hands = 0, sidePots = 0, showdowns = 0;
  for (let game = 0; game < 300; game++) {
    const n = 2 + (game % 7);
    const betting = ['NL', 'PL', 'FL'][game % 3];
    const structure = game % 2 ? 'tournament' : 'cash';
    const stacksArr = Array.from({ length: n }, () => 1 + Math.floor(rng() * 300));
    const g = mk(n, {
      betting, structure, seed: game, stacks: stacksArr, autoRebuy: true,
      ante: game % 5 === 0 ? 1 : 0, bba: game % 5 === 1, button: Math.floor(rng() * n),
      tournament: { handsPerLevel: 5, levels: [{ sb: 1, bb: 2, ante: 0 }, { sb: 2, bb: 4, ante: 1 }, { sb: 5, bb: 10, ante: 2 }, { sb: 10, bb: 20, ante: 5 }] },
    });
    let startTotal = 0;
    const tourTotal = stacksArr.reduce((a, b) => a + b, 0);
    const sum = () => g.state.seats.reduce((a, p) => a + p.stack, 0);
    g.on('handStart', (s) => { startTotal = sum() + s.pot; });
    g.on('action', (rec, s) => {
      assert.equal(sum() + s.pot, startTotal);
      assert.equal(s.pot, s.seats.reduce((a, p) => a + p.totalBet, 0));
      for (const p of s.seats) assert.ok(p.stack >= 0);
    });
    g.on('handEnd', (r, s) => {
      if (r.pots.length > 1) sidePots++;
      if (r.showdown) showdowns++;
      assert.equal(sum(), startTotal);
      const potTotal = r.pots.reduce((a, p) => a + p.amount, 0);
      assert.equal(Object.values(r.payouts).reduce((a, b) => a + b, 0), potTotal);
      for (const p of r.pots) for (const w of p.winners) assert.ok(p.eligible.includes(w));
      if (structure === 'tournament') assert.equal(sum(), tourTotal);
    });
    for (let k = 0; k < 40; k++) {
      if (g.state.gameOver) break;
      if (structure === 'cash' && g.state.seats[0].stack === 0) g.rebuy('hero');
      autoPlayHand(g, decide);
      hands++;
      for (const p of g.state.seats) assert.ok(p.stack >= 0 && Number.isInteger(p.stack));
    }
  }
  console.log(`fuzz: ${hands} hands, ${showdowns} showdowns, ${sidePots} with side pots`);
  assert.ok(hands > 5000 && sidePots > 200, `played ${hands}, side pots ${sidePots}`);
});

test('rule check 1: FL cap in cash stays once reached multiway; heads-up before the cap is uncapped', () => {
  let g = mk(3, { betting: 'FL' });
  g.startHand();
  g.act(A('raise', 4)); g.act(A('raise', 6)); g.act(A('raise', 8)); // capped with 3 players
  g.act(A('fold'));
  let L = g.legalActions();
  assert.equal(L.seat, 1); assert.equal(L.canRaise, false); assert.equal(L.callAmount, 2);

  g = mk(3, { betting: 'FL' });
  g.startHand();
  g.act(A('fold')); // heads-up before the cap
  for (const to of [4, 6, 8, 10, 12]) { L = g.legalActions(); assert.equal(L.canRaise, true, `to ${to}`); g.act(A('raise', to)); }
});

test('rule check 1: FL tournament cap applies heads-up until only two players remain in the event', () => {
  const t = { handsPerLevel: 100, levels: [{ sb: 1, bb: 2, ante: 0 }] };
  let g = mk(3, { betting: 'FL', structure: 'tournament', tournament: t });
  g.startHand();
  g.act(A('fold'));
  g.act(A('raise', 4)); g.act(A('raise', 6)); g.act(A('raise', 8));
  let L = g.legalActions();
  assert.equal(L.canRaise, false); assert.equal(L.callAmount, 2);

  g = mk(2, { betting: 'FL', structure: 'tournament', tournament: t });
  g.startHand();
  for (const to of [4, 6, 8, 10, 12]) { L = g.legalActions(); assert.equal(L.canRaise, true, `to ${to}`); g.act(A('raise', to)); }
});

test('rule check 4: PL preflop pot counts a short BB as a full blind', () => {
  const g = mk(3, { betting: 'PL', stacks: [200, 200, 1] });
  g.startHand();
  const L = g.legalActions();
  assert.equal(st(g).pot, 2);
  assert.equal(L.callAmount, 2);
  assert.equal(L.minTo, 4);
  assert.equal(L.maxTo, 7); // 2 + (1 + 2 as if posted) + 2
});

test('rule check 6: postflop first to act skips all-in players', () => {
  const g = mk(3, { stacks: [200, 10, 200] });
  g.startHand();
  g.act(A('call')); g.act(A('raise', 10)); g.act(A('call')); g.act(A('call'));
  assert.equal(st(g).street, 'flop');
  assert.equal(st(g).seats[1].allIn, true);
  assert.equal(st(g).toAct, 2);
});

test('odd chip goes to the first winner left of the button', () => {
  const g = mk(3);
  g.startHand({ holeCards: { 0: h('2c 3d'), 1: h('6c 7d'), 2: h('4c 5d') }, board: h('As Ks Qs Js Ts') });
  g.act(A('call')); g.act(A('fold')); g.act(A('check'));
  for (let i = 0; i < 6; i++) g.act(A('check'));
  const r = st(g).result;
  assert.deepEqual(r.pots[0].winners, [2, 0]);
  assert.deepEqual(r.payouts, { 0: 2, 2: 3 });
  assert.deepEqual(stacks(g), [200, 199, 201]);
  assert.equal(r.pots[0].handName, 'Royal Flush');
});

test('uncalled bet returned heads-up all-in', () => {
  const g = mk(2, { stacks: [200, 50] });
  g.startHand({ holeCards: { 0: h('2c 7d'), 1: h('Ah Ad') }, board: h('Kc Qd 9h 4s 3c') });
  g.act(A('raise', 200)); g.act(A('call'));
  const r = st(g).result;
  assert.deepEqual(r.returned, [{ seat: 0, amount: 150, street: 'preflop' }]);
  assert.deepEqual(r.pots.map((p) => p.amount), [100]);
  assert.deepEqual(stacks(g), [150, 100]);
});

test('FL: preflop cap is BB + 3 raises (max 4 BB); unlimited raising once heads-up in cash', () => {
  const g = mk(5, { betting: 'FL' });
  g.startHand();
  g.act(A('raise', 4)); g.act(A('raise', 6));
  let L = g.legalActions();
  assert.deepEqual([L.minTo, L.maxTo], [8, 8]);
  g.act(A('raise', 8));
  L = g.legalActions();
  assert.equal(L.canRaise, false); assert.equal(L.callAmount, 7); // SB has 1 in

  const hu = mk(2, { betting: 'FL' });
  hu.startHand();
  for (let to = 4; to <= 20; to += 2) {
    assert.equal(hu.legalActions().minTo, to, `raise to ${to}`);
    hu.act(A('raise', to));
  }
});

test('PL: cumulative short all-ins reopen the betting', () => {
  const g = mk(4, { betting: 'PL', stacks: [8, 11, 200, 200] });
  g.startHand();
  g.act(A('raise', 6)); // UTG, increment 4: reopening needs facing >= 10
  g.act(A('raise', 8)); // +2 short
  assert.equal(st(g).lastRaiseSize, 4);
  g.act(A('raise', 11)); // +3 short, but +5 in total over UTG's 6
  g.act(A('call'));
  const L = g.legalActions();
  assert.equal(L.seat, 3); assert.equal(L.canRaise, true); assert.equal(L.minTo, 15);
});
