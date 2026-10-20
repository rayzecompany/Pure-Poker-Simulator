// Texas Hold'em rules engine (NL / PL / FL, cash / tournament). No DOM.
// Simplification: tournaments use a simple moving button (no dead-button rule): the button
// always moves to the next seat that still has chips.
import { newDeck, shuffle, makeRng, secureRng } from './cards.js';
import { evaluate } from './evaluator.js';
import { positionsFor, displayLabel } from './positions.js';

const HISTORY_MAX = 200;

export class Game {
  constructor(config) {
    const c = { betting: 'NL', structure: 'cash', smallBlind: 1, bigBlind: 2, ante: 0, bigBlindAnte: false, startingStack: 200, ...config };
    c.cash = { autoRebuyBots: true, rebuyTo: c.startingStack, ...(config.cash || {}) };
    c.tournament = { handsPerLevel: 10, levels: [], ...(config.tournament || {}) };
    if (!Array.isArray(c.players) || c.players.length < 2 || c.players.length > 8) throw new Error('Need 2 to 8 players');
    if (new Set(c.players.map((p) => p.id)).size !== c.players.length) throw new Error('Player ids must be unique');
    if (!['NL', 'PL', 'FL'].includes(c.betting)) throw new Error(`Unknown betting: ${c.betting}`);
    this.config = c;
    this.rng = c.seed !== undefined && c.seed !== null ? makeRng(c.seed) : secureRng; // unseeded = cryptographic
    this.history = [];
    this._listeners = {};
    const L0 = this._levels()[0];
    this._s = {
      handNumber: 0, level: 0,
      smallBlind: L0 ? L0.sb : c.smallBlind, bigBlind: L0 ? L0.bb : c.bigBlind, ante: L0 ? L0.ante || 0 : c.ante,
      betting: c.betting, structure: c.structure,
      buttonSeat: null, sbSeat: null, bbSeat: null,
      seats: c.players.map((p) => ({
        id: p.id, name: p.name ?? p.id, isHuman: !!p.isHuman, stack: p.stack ?? c.startingStack,
        bet: 0, totalBet: 0, holeCards: null, folded: false, allIn: false, busted: false, sittingOut: false,
        inHand: false, position: null, positionLabel: null, lastAction: null, shown: false,
      })),
      street: 'complete', board: [], pot: 0, pots: [], toAct: null, currentBet: 0, lastRaiseSize: 0,
      actions: [], result: null, returned: [], gameOver: false,
    };
  }

  get state() { return this._s; }

  on(ev, fn) { (this._listeners[ev] ||= []).push(fn); return this; }
  _emit(ev, ...args) {
    for (const fn of this._listeners[ev] || []) {
      try { fn(...args); } catch (e) { console.error(`Game listener '${ev}' threw`, e); }
    }
  }

  _levels() { return this.config.structure === 'tournament' ? this.config.tournament.levels || [] : []; }

  _next(from, pred) {
    const n = this._s.seats.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (pred(this._s.seats[i], i)) return i;
    }
    return null;
  }

  _inPlay(i) { const p = this._s.seats[i]; return p.inHand && !p.folded; }

  rebuy(playerId, amount) {
    const s = this._s;
    if (s.structure !== 'cash') throw new Error('Rebuys are cash-game only');
    if (s.street !== 'complete') throw new Error('Rebuy between hands only');
    const seat = s.seats.find((p) => p.id === playerId);
    if (!seat) throw new Error(`No player ${playerId}`);
    const add = amount ?? this.config.cash.rebuyTo - seat.stack;
    if (add > 0) seat.stack += add;
    seat.sittingOut = seat.stack === 0;
  }

  // opts (tests / drills): { holeCards: { [seat]: [c1, c2] }, board: string[] } preset cards; rest is shuffled.
  startHand(opts = {}) {
    const s = this._s, c = this.config;
    if (s.street !== 'complete') throw new Error('Hand in progress');
    if (s.gameOver) throw new Error('Game over');
    if (s.structure === 'cash' && c.cash.autoRebuyBots) {
      for (const p of s.seats) if (p.stack === 0 && !p.isHuman) p.stack = c.cash.rebuyTo;
    }
    for (const p of s.seats) p.sittingOut = !p.busted && p.stack === 0;
    const dealt = s.seats.map((p, i) => (!p.busted && p.stack > 0 ? i : -1)).filter((i) => i >= 0);
    if (dealt.length < 2) throw new Error('Not enough players with chips');

    s.handNumber++;
    const levels = this._levels();
    if (levels.length) {
      const lvl = Math.min(Math.floor((s.handNumber - 1) / c.tournament.handsPerLevel), levels.length - 1);
      const L = levels[lvl];
      s.smallBlind = L.sb; s.bigBlind = L.bb; s.ante = L.ante || 0;
      if (lvl !== s.level) { s.level = lvl; this._emit('levelUp', lvl); }
    } else {
      s.smallBlind = c.smallBlind; s.bigBlind = c.bigBlind;
      s.ante = c.bigBlindAnte ? c.ante || c.bigBlind : c.ante;
    }

    for (const p of s.seats) {
      Object.assign(p, { bet: 0, totalBet: 0, holeCards: null, allIn: false, lastAction: null, shown: false, position: null, positionLabel: null });
      p.inHand = !p.busted && p.stack > 0;
      p.folded = !p.inHand;
    }
    Object.assign(s, { street: 'preflop', board: [], pot: 0, pots: [], toAct: null, currentBet: 0, lastRaiseSize: s.bigBlind, actions: [], result: null, returned: [] });

    const inHand = (p) => p.inHand;
    const n = dealt.length;
    s.buttonSeat = s.buttonSeat === null
      ? (c.firstButton != null && s.seats[c.firstButton]?.inHand ? c.firstButton : dealt[Math.floor(this.rng() * n)])
      : this._next(s.buttonSeat, inHand);
    s.sbSeat = n === 2 ? s.buttonSeat : this._next(s.buttonSeat, inHand);
    s.bbSeat = this._next(s.sbSeat, inHand);
    const keys = positionsFor(n);
    let idx = s.bbSeat;
    for (const k of keys) {
      idx = this._next(idx, inHand);
      s.seats[idx].position = k;
      s.seats[idx].positionLabel = displayLabel(k, n);
    }

    // Deal: one card at a time starting left of the button.
    const preset = opts.holeCards || {};
    const used = new Set([...(opts.board || []), ...Object.values(preset).flat()]);
    this._deck = shuffle(newDeck().filter((x) => !used.has(x)), this.rng);
    this._boardPlan = [...(opts.board || [])];
    const order = [];
    for (let k = 0, i = s.buttonSeat; k < n; k++) { i = this._next(i, inHand); order.push(i); }
    for (const i of order) s.seats[i].holeCards = preset[i] ? [...preset[i]] : [];
    for (let r = 0; r < 2; r++) for (const i of order) if (!preset[i]) s.seats[i].holeCards.push(this._deck.pop());

    this._seatsAtStart = s.seats.map((p, i) => ({ seat: i, id: p.id, name: p.name, stack: p.stack, inHand: p.inHand, position: p.position, positionLabel: p.positionLabel }));
    this._heroDecisions = [];

    // Antes (dead), then blinds. BB-ante: a short BB posts the ante first (TDA 2019+), then the blind.
    if (s.ante > 0 && !c.bigBlindAnte) for (const i of order) this._post(i, s.ante, 'post-ante');
    this._deadAnte = s.ante > 0 && c.bigBlindAnte ? this._post(s.bbSeat, s.ante, 'post-ante') : 0;
    const sbPosted = this._post(s.sbSeat, s.smallBlind, 'post-sb');
    const bbPosted = this._post(s.bbSeat, s.bigBlind, 'post-bb');

    this._startRound();
    s.currentBet = s.bigBlind; // a short all-in BB still means others must call the full blind
    this._flBets = 1; // the big blind is the first FL "bet"
    this._flLevel = s.bigBlind;
    // PL: preflop pot is sized as if full blinds were posted (TDA 56-B)
    this._plDeficit = s.smallBlind - sbPosted + s.bigBlind - bbPosted;
    this._emit('handStart', s);
    s.toAct = this._nextToAct(s.bbSeat);
    if (s.toAct === null) this._endRound();
  }

  _post(i, want, type) {
    const s = this._s, p = s.seats[i];
    const amount = Math.min(want, p.stack);
    if (amount <= 0) return 0;
    p.stack -= amount; p.totalBet += amount; s.pot += amount;
    if (type !== 'post-ante') p.bet += amount; // antes are dead money
    p.allIn = p.stack === 0;
    p.lastAction = { type, amount };
    s.actions.push({ street: 'preflop', seat: i, playerId: p.id, type, amount, to: p.bet, allIn: p.allIn, potAfter: s.pot });
    return amount;
  }

  _startRound() {
    const s = this._s;
    s.currentBet = 0; s.lastRaiseSize = s.bigBlind;
    this._acted = s.seats.map(() => false);
    this._reopenAt = s.seats.map(() => 0);
    this._streetAggressor = null;
    this._flBets = 0; this._flLevel = 0; this._cappedMultiway = false; this._plDeficit = 0;
  }

  _betUnit() { const s = this._s; return s.street === 'turn' || s.street === 'river' ? 2 * s.bigBlind : s.bigBlind; }

  _canAct(p) { return p.inHand && !p.folded && !p.allIn; }

  _needsAction(i) {
    const s = this._s, p = s.seats[i];
    if (!this._canAct(p)) return false;
    if (p.bet < s.currentBet) return true;
    return !this._acted[i] && s.seats.some((q, j) => j !== i && this._canAct(q));
  }

  _nextToAct(from) { return this._next(from, (_, i) => this._needsAction(i)); }

  legalActions() {
    const s = this._s;
    if (s.toAct === null) return null;
    const i = s.toAct, p = s.seats[i];
    const owed = Math.max(0, s.currentBet - p.bet);
    const callAmount = Math.min(owed, p.stack);
    const allInTo = p.bet + p.stack;
    const others = s.seats.some((q, j) => j !== i && this._canAct(q));
    const reopened = !this._acted[i] || s.currentBet >= this._reopenAt[i];
    // FL cap (bet + 3 raises). TDA 45: in tournaments it applies even heads-up until only two players
    // remain in the event. Cash: unlimited once heads-up (<= 2 not all-in), unless already capped multiway.
    const uncapped = s.structure === 'tournament'
      ? s.seats.filter((q) => !q.busted).length === 2
      : s.seats.filter((q) => this._canAct(q)).length <= 2 && !this._cappedMultiway;
    const capOk = s.betting !== 'FL' || this._flBets < 4 || uncapped;
    const canAgg = others && reopened && capOk && allInTo > s.currentBet;
    let minTo = 0, maxTo = 0;
    if (canAgg) {
      if (s.betting === 'FL') {
        minTo = maxTo = this._flLevel + this._betUnit();
      } else {
        minTo = s.currentBet + s.lastRaiseSize;
        maxTo = s.betting === 'PL' ? s.currentBet + s.pot + this._plDeficit + owed : allInTo;
      }
      minTo = Math.min(minTo, allInTo);
      maxTo = Math.max(minTo, Math.min(maxTo, allInTo));
    }
    return {
      seat: i, playerId: p.id,
      canFold: true, canCheck: owed === 0, callAmount,
      canBet: canAgg && s.currentBet === 0, canRaise: canAgg && s.currentBet > 0,
      minTo, maxTo, allInTo, pot: s.pot, toCall: callAmount,
    };
  }

  act(action) {
    const s = this._s;
    const legal = this.legalActions();
    if (!legal) throw new Error('No one to act');
    const i = legal.seat, p = s.seats[i];
    let type = action?.type;
    if (type === 'call' && legal.canCheck) type = 'check';
    if (type === 'bet' && s.currentBet > 0) type = 'raise';
    if (type === 'raise' && s.currentBet === 0) type = 'bet';
    let to = p.bet;
    if (type === 'check') {
      if (!legal.canCheck) throw new Error('Cannot check facing a bet');
    } else if (type === 'call') {
      to = p.bet + legal.callAmount;
    } else if (type === 'bet' || type === 'raise') {
      if (!(type === 'bet' ? legal.canBet : legal.canRaise)) throw new Error(`Cannot ${type} now`);
      to = Number(action.to);
      if (!Number.isInteger(to)) throw new Error(`Invalid ${type} amount: ${action.to}`);
      if (to < legal.minTo || to > legal.maxTo) { // a short all-in is already inside [minTo, maxTo]
        throw new Error(`${type} to ${to} not allowed (min ${legal.minTo}, max ${legal.maxTo}, all-in ${legal.allInTo})`);
      }
    } else if (type !== 'fold') {
      throw new Error(`Unknown action: ${action?.type}`);
    }
    const heroView = p.isHuman ? this.viewFor(i) : null;

    const amount = to - p.bet;
    p.stack -= amount; p.bet = to; p.totalBet += amount; s.pot += amount;
    p.allIn = p.stack === 0;
    if (type === 'fold') p.folded = true;
    if (type === 'bet' || type === 'raise') {
      const inc = to - s.currentBet;
      if (s.betting === 'FL') {
        if (inc * 2 >= this._betUnit()) { this._flLevel = to; this._flBets++; } // >= half a bet counts as a raise
        if (this._flBets >= 4 && s.seats.filter((q) => this._canAct(q)).length > 2) this._cappedMultiway = true;
      } else if (inc >= s.lastRaiseSize) {
        s.lastRaiseSize = inc; // incomplete all-in raises keep the previous increment
      }
      s.currentBet = to;
      this._streetAggressor = i;
    }
    this._acted[i] = true;
    this._reopenAt[i] = s.currentBet + (s.betting === 'FL' ? this._betUnit() / 2 : s.lastRaiseSize);
    p.lastAction = { type, amount: type === 'call' ? amount : to };
    const rec = { street: s.street, seat: i, playerId: p.id, type, amount, to, allIn: p.allIn, potAfter: s.pot };
    s.actions.push(rec);
    if (heroView) this._heroDecisions.push({ view: heroView, action: { ...action, type, ...(type === 'bet' || type === 'raise' ? { to } : {}) } });

    const live = s.seats.filter((q) => q.inHand && !q.folded);
    if (live.length === 1) {
      s.toAct = null;
      this._emit('action', rec, s);
      return this._finishByFold();
    }
    s.toAct = this._nextToAct(i);
    this._emit('action', rec, s);
    if (s.toAct === null) this._endRound();
  }

  // Chips a seat has bet this hand. A BB-ante is dead money (TDA): it goes to the main pot but is
  // never a bet that others must match, so it is never "uncalled" and never caps a side pot.
  _bets(i) { const p = this._s.seats[i]; return i === this._s.bbSeat ? p.totalBet - this._deadAnte : p.totalBet; }

  // End of a betting round: return the uncalled part of the top bet, build pots, clear street bets.
  _settle() {
    const s = this._s;
    const inHand = s.seats.map((_, i) => i).filter((i) => s.seats[i].inHand);
    const [hi, second] = [...inHand].sort((a, b) => this._bets(b) - this._bets(a));
    const top = s.seats[hi], diff = this._bets(hi) - this._bets(second);
    if (diff > 0) {
      top.stack += diff; top.totalBet -= diff; s.pot -= diff;
      if (top.stack > 0) top.allIn = false;
      s.returned.push({ seat: hi, amount: diff, street: s.street });
    }
    for (const p of s.seats) p.bet = 0;

    const live = inHand.filter((i) => !s.seats[i].folded);
    const caps = [...new Set(live.map((i) => this._bets(i)))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0, amount = this._deadAnte;
    for (const cap of caps) {
      for (const i of inHand) { const t = this._bets(i); amount += Math.min(t, cap) - Math.min(t, prev); }
      if (amount > 0) pots.push({ amount, eligible: live.filter((i) => this._bets(i) >= cap) });
      prev = cap; amount = 0;
    }
    let extra = 0; // folded money above every live player's total; can't happen, but never lose chips
    for (const i of inHand) extra += Math.max(0, this._bets(i) - prev);
    if (extra && pots.length) pots[pots.length - 1].amount += extra;
    s.pots = pots;
    return pots;
  }

  _endRound() {
    const s = this._s;
    this._settle();
    const allIn = s.seats.filter((p) => this._canAct(p)).length <= 1;
    if (allIn || s.street === 'river') {
      // TDA 16: once someone is all-in and betting is over, every hand is tabled.
      if (allIn) for (const p of s.seats) if (p.inHand && !p.folded) p.shown = true;
      while (s.street !== 'river') {
        this._dealStreet();
        this._emit('street', s.street, s.board, s);
      }
      return this._showdown();
    }
    this._dealStreet();
    this._startRound();
    s.toAct = this._nextToAct(s.buttonSeat);
    this._emit('street', s.street, s.board, s);
  }

  _dealStreet() {
    const s = this._s;
    const next = { preflop: 'flop', flop: 'turn', turn: 'river' }[s.street];
    const count = next === 'flop' ? 3 : 1;
    if (this._boardPlan.length < count) this._deck.pop(); // burn
    for (let k = 0; k < count; k++) s.board.push(this._boardPlan.length ? this._boardPlan.shift() : this._deck.pop());
    s.street = next;
    for (const p of s.seats) p.lastAction = null;
  }

  _clockwiseFromButton(seats) {
    const s = this._s, n = s.seats.length;
    return [...seats].sort((a, b) => ((a - s.buttonSeat - 1 + n) % n) - ((b - s.buttonSeat - 1 + n) % n));
  }

  _showdown() {
    const s = this._s, n = s.seats.length;
    s.street = 'showdown'; s.toAct = null;
    const pots = s.pots;
    const live = s.seats.map((_, i) => i).filter((i) => this._inPlay(i));
    const score = {}, names = {};
    for (const i of live) {
      const r = evaluate([...s.seats[i].holeCards, ...s.board]);
      score[i] = r.score; names[i] = r.name;
    }
    // Showing order: river aggressor first, else first live player left of the button.
    const first = this._streetAggressor !== null && this._inPlay(this._streetAggressor) ? this._streetAggressor : this._clockwiseFromButton(live)[0];
    const order = [];
    for (let k = 0, i = first; k < n; k++, i = (i + 1) % n) if (this._inPlay(i)) order.push(i);
    const contested = pots.filter((pt) => pt.eligible.length > 1);
    const best = contested.map(() => -1);
    for (const i of order) {
      const p = s.seats[i];
      const show = p.shown || contested.some((pt, k) => pt.eligible.includes(i) && score[i] >= best[k]);
      if (show) {
        p.shown = true;
        contested.forEach((pt, k) => { if (pt.eligible.includes(i)) best[k] = Math.max(best[k], score[i]); });
      }
    }
    const resultPots = pots.map((pt) => {
      const top = Math.max(...pt.eligible.map((i) => score[i]));
      const winners = this._clockwiseFromButton(pt.eligible.filter((i) => score[i] === top));
      return { amount: pt.amount, winners, handName: pt.eligible.length > 1 ? names[winners[0]] : null, eligible: pt.eligible };
    });
    const revealed = {};
    for (const i of live) if (s.seats[i].shown) revealed[i] = [...s.seats[i].holeCards];
    this._award(resultPots, true, revealed);
    this._complete();
  }

  _finishByFold() {
    const s = this._s;
    const w = s.seats.findIndex((p) => p.inHand && !p.folded);
    const amount = this._settle().reduce((a, pt) => a + pt.amount, 0);
    this._award([{ amount, winners: [w], handName: null, eligible: [w] }], false, {});
    this._complete();
  }

  _award(pots, showdown, revealed) {
    const s = this._s;
    const payouts = {};
    for (const pt of pots) {
      const k = pt.winners.length, share = Math.floor(pt.amount / k);
      let odd = pt.amount - share * k; // odd chips: one each from the first winner left of the button
      for (const w of pt.winners) {
        const win = share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd--;
        payouts[w] = (payouts[w] || 0) + win;
        s.seats[w].stack += win;
      }
    }
    s.pot = 0;
    s.result = { pots, payouts, showdown, revealed, returned: [...s.returned] };
  }

  _complete() {
    const s = this._s;
    s.street = 'complete'; s.toAct = null;
    const busted = [];
    for (let i = 0; i < s.seats.length; i++) {
      const p = s.seats[i];
      if (p.inHand && p.stack === 0) {
        busted.push(i);
        if (s.structure === 'tournament') p.busted = true; else p.sittingOut = true;
      }
    }
    if (s.structure === 'tournament' && s.seats.filter((p) => !p.busted).length <= 1) s.gameOver = true;
    const hero = s.seats.findIndex((p) => p.isHuman);
    this.history.push({
      handNumber: s.handNumber,
      config: { betting: s.betting, structure: s.structure, smallBlind: s.smallBlind, bigBlind: s.bigBlind, ante: s.ante, bigBlindAnte: !!this.config.bigBlindAnte },
      seats: this._seatsAtStart, buttonSeat: s.buttonSeat, heroSeat: hero,
      heroCards: hero >= 0 && s.seats[hero].holeCards ? [...s.seats[hero].holeCards] : null,
      board: [...s.board], actions: structuredClone(s.actions), result: structuredClone(s.result),
      heroDecisions: this._heroDecisions,
    });
    if (this.history.length > HISTORY_MAX) this.history.shift();
    this._emit('handEnd', s.result, s);
    for (const i of busted) this._emit('busted', i);
  }

  viewFor(playerId) {
    const s = this._s;
    const heroSeat = typeof playerId === 'number' ? playerId : s.seats.findIndex((p) => p.id === playerId);
    if (heroSeat < 0 || heroSeat >= s.seats.length) throw new Error(`No player ${playerId}`);
    const v = structuredClone(s);
    v.seats.forEach((p, i) => { if (i !== heroSeat && !p.shown) p.holeCards = null; });
    v.heroSeat = heroSeat;
    v.heroId = s.seats[heroSeat].id;
    v.legal = s.toAct === heroSeat ? this.legalActions() : null;
    v.numActive = s.seats.filter((p) => p.inHand && !p.folded).length;
    v.bigBlind = s.bigBlind;
    return v;
  }
}

// Test helper: plays one hand (starting it if needed), asking decideFn(view, game) for every action.
export function autoPlayHand(game, decideFn) {
  if (game.state.street === 'complete') game.startHand();
  let guard = 0;
  while (game.state.toAct !== null) {
    if (++guard > 2000) throw new Error('Hand stalled');
    const seat = game.state.seats[game.state.toAct];
    game.act(decideFn(game.viewFor(seat.id), game));
  }
  if (game.state.street !== 'complete') throw new Error(`Hand ended in street ${game.state.street}`);
  return game.state.result;
}
