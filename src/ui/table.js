import { animate } from 'motion';
import { h, spring, reduced } from './dom.js';
import { cardEl } from './cards.js';
import { avatarEl } from './avatars.js';

const ACT_TEXT = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', 'post-sb': 'Small blind', 'post-bb': 'Big blind', 'post-ante': 'Ante' };

/** Seat centers in % of the felt, clockwise from hero at the bottom (seat order = action order). */
function seatSpots(n) {
  return Array.from({ length: n }, (_, i) => {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
    const c = Math.cos(a), s = Math.sin(a);
    return { x: 50 + 41 * c, y: 47 + 38 * s }; // around the oval rail
  });
}
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const pct = (el, p) => Object.assign(el.style, { left: `${p.x}%`, top: `${p.y}%` });

export function createTable(felt, ctx) {
  let seats = [];
  let spots = [];
  const board = h('div.board', {}, Array.from({ length: 5 }, () => h('div.slot')));
  const potAmt = h('span.pot-amt');
  const sidepots = h('div.sidepots');
  const resultLine = h('div.result-line', { 'aria-live': 'polite' });
  const narr = h('div.narr', { 'aria-live': 'polite' });
  let narrText = '';
  const meta = h('div.meta-line.label');
  const dealer = h('div.dealer', { title: 'Dealer button' }, 'D');
  const center = h('div.center', {}, meta, h('div.potline', {}, h('span.label', {}, 'Pot'), potAmt), board, sidepots, narr, resultLine);
  const live = h('div.live', { hidden: true },
    h('div.lrow', {}, h('span.hn'), h('b.eqv')), h('div.bar', {}, h('span')), h('div.draws'));
  let boardKey = '';
  let lastButton = null;

  // Hero's bet and the dealer button (when hero has it) sit beside hero's cards. The hero seat is
  // anchored to the bottom and grows when the live bar shows, so re-place them whenever it changes.
  function placeHero() {
    const i = seats.findIndex((v) => v.hero);
    const v = seats[i];
    if (!v) return;
    const cw = v.cards.offsetWidth || 130;
    const top = v.el.offsetTop + v.cards.offsetTop;
    Object.assign(v.bet.style, { top: `${top + 34}px`, left: `calc(50% + ${cw / 2 + 36}px)` });
    if (lastButton === i) Object.assign(dealer.style, { left: `${felt.clientWidth / 2 - cw / 2 - 18}px`, top: `${top + 24}px` });
  }

  function setup(state) {
    felt.replaceChildren(h('div.rail'), center, dealer);
    spots = seatSpots(state.seats.length);
    seats = state.seats.map((s, i) => {
      const hero = s.isHuman;
      const cards = h('div.seat-cards');
      const think = h('div.think', {}, h('span'));
      const nm = h('span'), pos = h('span.pos');
      const stk = h('div.stk');
      const plate = h('div.plate', {}, avatarEl(s.id, s.name), h('div.info', {}, h('div.nm', {}, nm, pos), stk), think);
      const act = h('div.act');
      const el = h('div.seat' + (hero ? '.hero' : ''), {}, cards, plate, hero ? live : null, act);
      const bet = h('div.bet', { hidden: true });
      felt.append(el, bet);
      const spot = spots[i];
      if (hero) Object.assign(el.style, { left: '50%', top: 'auto', bottom: '10px', transform: 'translateX(-50%)' });
      else pct(el, spot);
      pct(bet, hero ? { x: 50, y: 66 } : lerp(spot, { x: 50, y: 46 }, 0.3));
      nm.textContent = s.name;
      return { el, hero, cards, think, pos, stk, act, bet, cardKey: '', actTimer: 0, thinkAnim: null };
    });
    boardKey = '';
  }

  function render(state) {
    const res = state.street === 'complete' ? state.result : null;
    state.seats.forEach((s, i) => {
      const v = seats[i];
      if (!v) return;
      v.el.classList.toggle('folded', !!s.folded && !s.busted);
      v.el.classList.toggle('out', !!(s.busted || s.sittingOut) && !res?.revealed?.[i]);
      v.el.classList.toggle('active', state.toAct === i && !res);
      v.el.classList.toggle('winner', !!res && (res.payouts?.[i] ?? 0) > 0);
      v.stk.textContent = s.busted ? 'Out' : s.allIn && !res ? `All-in` : ctx.fmt(s.stack);
      const label = s.positionLabel || s.position || '';
      const blind = i === state.sbSeat ? 'SB' : i === state.bbSeat ? 'BB' : '';
      const shownLabel = s.busted ? '' : ctx.settings.positions ? label : blind;
      v.pos.textContent = shownLabel;
      v.pos.hidden = !shownLabel;
      // street bet in front of the seat
      v.bet.hidden = !(s.bet > 0) || !!res;
      if (s.bet > 0) v.bet.textContent = ctx.fmt(s.bet);
      renderCards(v, s, i, state);
    });
    // dealer button sits between the button seat and the middle
    const b = state.buttonSeat;
    lastButton = b;
    if (b != null && spots[b]) {
      dealer.hidden = false;
      if (!state.seats[b]?.isHuman) {
        const p = lerp(spots[b], { x: 50, y: 46 }, 0.26);
        pct(dealer, { x: p.x + (spots[b].x < 50 ? 6 : -6), y: p.y });
      }
    }
    placeHero();
    // board
    const key = state.board.join('');
    if (key !== boardKey) {
      const prev = boardKey.length / 2;
      if (!key.startsWith(boardKey)) {
        board.replaceChildren(...Array.from({ length: 5 }, () => h('div.slot')));
      }
      const css = getComputedStyle(felt);
      const size = [parseFloat(css.getPropertyValue('--board-w')) || 58, parseFloat(css.getPropertyValue('--board-h')) || 82];
      state.board.forEach((c, i) => {
        if (i < prev && key.startsWith(boardKey)) return;
        const el = cardEl(c, size);
        board.children[i].replaceWith(el);
        spring(el, { opacity: [0, 1], y: [-14, 0], scale: [0.96, 1] }, { delay: (i - prev) * 0.08 });
      });
      boardKey = key;
    }
    // pot + side pots
    potAmt.textContent = ctx.fmt(res ? (res.pots || []).reduce((a, p) => a + p.amount, 0) : state.pot);
    const pots = state.pots || [];
    sidepots.replaceChildren(...(pots.length > 1 ? pots.map((p, i) => h('span', {}, `${i ? `Side ${i}` : 'Main'} ${ctx.fmt(p.amount)}`)) : []));
    // meta line
    const bits = [`Hand ${state.handNumber}`, `Blinds ${state.smallBlind}/${state.bigBlind}${state.ante ? ` · ante ${state.ante}` : ''}`];
    if (state.structure === 'tournament') {
      bits.push(`Level ${(state.level ?? 0) + 1}`);
      const per = ctx.handsPerLevel;
      if (per) bits.push(`${per - ((state.handNumber - 1) % per)} hands to next`);
    }
    meta.replaceChildren(...bits.map((t) => h('span', {}, t)));
    // result
    const heroTurn = !res && state.toAct != null && state.seats[state.toAct]?.isHuman;
    narr.textContent = res ? '' : heroTurn ? (narrText ? `${narrText}. Your move.` : 'Your move.') : narrText;
    if (res) {
      const parts = (res.pots || []).map((p) => {
        const names = p.winners.map((w) => (state.seats[w].isHuman ? 'You' : state.seats[w].name)).join(' & ');
        const verb = p.winners.length > 1 ? 'split' : state.seats[p.winners[0]]?.isHuman ? 'win' : 'wins';
        return `${names} ${verb} ${ctx.fmt(p.amount)}${p.handName ? ` · ${p.handName}` : ''}`;
      });
      resultLine.textContent = parts.join('   ');
      for (const [seat, amt] of Object.entries(res.payouts || {})) {
        if (amt > 0 && seats[seat]) {
          const name = res.pots?.find((p) => p.winners.includes(Number(seat)))?.handName;
          setAction(Number(seat), `+${ctx.fmt(amt)}${name ? ` · ${name}` : ''}`, true);
        }
      }
    } else resultLine.textContent = '';
  }

  function renderCards(v, s, i, state) {
    const hero = s.isHuman;
    // Only hero's own cards, or cards turned face up for everyone, are ever drawn face up.
    const rev = state.street === 'complete' ? state.result?.revealed?.[i] : null;
    let cards = null, key = '';
    if (rev) { cards = rev; key = rev.join(''); }
    else if (s.holeCards && (hero || s.shown)) { cards = s.holeCards; key = cards.join('') + (hero && s.folded ? '-f' : ''); }
    else if (s.holeCards && !s.folded && !s.busted) key = 'back';
    if (key === v.cardKey) return;
    const was = v.cardKey;
    v.cardKey = key;
    const size = hero ? ctx.heroCardSize() : [36, 50];
    if (!key) {
      const old = [...v.cards.children];
      if (!old.length) return;
      Promise.all(old.map((c) => spring(c, { opacity: 0, y: -8 }, { duration: 0.3 }))).then(() => { if (!v.cardKey) v.cards.replaceChildren(); });
      return;
    }
    const els = key === 'back' ? [cardEl(null, size), cardEl(null, size)] : cards.map((c) => cardEl(c, size, !hero));
    if (hero && s.folded) els.forEach((e) => e.classList.add('dim'));
    v.cards.replaceChildren(...els);
    if (was === '') {
      els.forEach((e, k) => spring(e, { opacity: [0, 1], y: [-16, 0] }, { delay: i * 0.04 + k * 0.12 }));
    } else if (was === 'back') {
      // turned face up: a quick flip
      els.forEach((e) => (reduced() ? spring(e, { opacity: [0.4, 1] }) : animate(e, { scaleX: [0, 1] }, { type: 'spring', bounce: 0, duration: 0.3 })));
    }
  }

  function setAction(i, text, win = false) {
    const v = seats[i];
    if (!v) return;
    clearTimeout(v.actTimer);
    v.act.textContent = text;
    v.act.classList.toggle('win', win);
    v.act.classList.remove('old');
    if (!win) v.actTimer = setTimeout(() => v.act.classList.add('old'), 2200);
  }
  // Seat tag for the action, plus one plain sentence for it so the hand is easy to follow.
  const VERB = { fold: 'folds', check: 'checks', call: 'calls', bet: 'bets', raise: 'raises to', 'post-sb': 'posts the small blind', 'post-bb': 'posts the big blind' };
  function logAction(rec, state) {
    const amt = rec.type === 'bet' || rec.type === 'raise' ? rec.to : rec.amount;
    const quiet = rec.type === 'fold' || rec.type === 'check';
    setAction(rec.seat, quiet ? ACT_TEXT[rec.type] : `${ACT_TEXT[rec.type] || rec.type} ${ctx.fmt(amt)}${rec.allIn ? ' · all-in' : ''}`);
    if (!VERB[rec.type]) return;
    const s = state.seats[rec.seat];
    const verb = s.isHuman ? VERB[rec.type].replace(/s( to)?$/, '$1').replace('posts', 'post') : VERB[rec.type];
    const shown = rec.type === 'bet' || rec.type === 'raise' || rec.type === 'call' ? ' ' + ctx.fmt(amt) : '';
    narrText = `${s.isHuman ? 'You' : s.name} ${verb}${shown}${rec.allIn ? ', all-in' : ''}`;
  }
  function clearActions() { narrText = ''; narr.textContent = ''; seats.forEach((v) => { clearTimeout(v.actTimer); v.act.textContent = ''; v.act.classList.remove('win', 'old'); }); }
  function fadeActions() { narrText = ''; seats.forEach((v) => { if (v.act.textContent && !v.act.classList.contains('win')) v.act.classList.add('old'); }); }

  function showThink(i, ms) {
    const v = seats[i];
    if (!v) return;
    v.thinkAnim?.stop();
    v.thinkAnim = animate(v.think.firstChild, { scaleX: [0, 1] }, { duration: ms / 1000, ease: 'linear' });
  }
  function clearThink() {
    seats.forEach((v) => { v.thinkAnim?.stop(); v.thinkAnim = null; v.think.firstChild.style.transform = 'scaleX(0)'; });
  }

  function setLive(info) {
    const was = live.hidden;
    live.hidden = !info;
    if (was !== live.hidden) placeHero();
    if (!info) return;
    const eq = info.equity;
    live.querySelector('.hn').textContent = info.name || '—';
    live.querySelector('.eqv').textContent = eq == null ? '…' : `${Math.round(eq * 100)}% to win`;
    live.title = `Your chance to win if the hand were played out against what opponents are likely to hold${info.vs ? ` (${info.vs})` : ''}.`;
    live.querySelector('.bar span').style.transform = `scaleX(${eq ?? 0})`;
    live.querySelector('.draws').textContent = [...(info.draws || []), info.outs ? `${info.outs} outs` : ''].filter(Boolean).join(' · ');
  }

  return { setup, render, logAction, clearActions, fadeActions, showThink, clearThink, setLive };
}
