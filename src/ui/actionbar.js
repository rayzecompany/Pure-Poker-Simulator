import { h } from './dom.js';

const PRESETS = [['⅓', 1 / 3], ['½', 1 / 2], ['⅔', 2 / 3], ['Pot', 1]];

// Preflop sizes are spoken in big blinds (opens) or multiples of the raise (3-bets), not pot fractions.
function presetSizes(st, l) {
  const pot = l.pot ?? st.pot;
  const toCall = l.toCall ?? l.callAmount ?? 0;
  const cur = st.currentBet || 0;
  const potTo = cur === 0 ? pot : cur + pot + toCall;
  if (st.street === 'preflop') {
    const bb = st.bigBlind;
    if (cur <= bb) return [['2.5bb', 2.5 * bb], ['3bb', 3 * bb], ['4bb', 4 * bb], ['Pot', potTo]];
    return [['3x', 3 * cur], ['4x', 4 * cur], ['Pot', potTo]];
  }
  return PRESETS.map(([lab, f]) => [lab, cur === 0 ? f * pot : cur + f * (pot + toCall)]);
}

/**
 * Bottom action bar. Only live on hero's turn; every action it can send comes from legalActions().
 * ctx: { fmt(n), units(), onAct(action) }
 */
export function createActionBar(root, ctx) {
  let legal = null, state = null, value = 0, lo = 0, hi = 0;

  const foldLabel = h('span', {}, 'Fold');
  let foldArmed = false;
  // Folding when you could check for free is almost always a slip: ask once before doing it.
  const fold = h('button.btn.secondary', { type: 'button', onclick: () => {
    if (legal?.canCheck && !foldArmed) { foldArmed = true; foldLabel.textContent = 'Fold? Check is free'; return; }
    send({ type: 'fold' });
  } }, foldLabel, h('kbd', {}, 'F'));
  const callLabel = h('span');
  const call = h('button.btn.secondary', { type: 'button', onclick: () => send(legal.canCheck ? { type: 'check' } : { type: 'call' }) }, callLabel, h('kbd', {}, 'C'));
  const raiseLabel = h('span');
  const raise = h('button.btn.primary', { type: 'button', onclick: () => sendRaise() }, raiseLabel, h('kbd', {}, '↵'));
  const presets = h('div.presets');
  const range = h('input', { type: 'range', 'aria-label': 'Bet size', oninput: (e) => set(Number(e.target.value)) });
  const input = h('input.num', {
    type: 'number', 'aria-label': 'Bet size',
    onchange: (e) => set(fromUnits(Number(e.target.value))),
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); set(fromUnits(Number(e.target.value))); sendRaise(); } },
  });
  const sizer = h('div.sizer', {}, presets, range, input);
  const msg = h('div.msg');

  const bb = () => state?.bigBlind || 1;
  const toUnits = (n) => (ctx.units() === 'bb' ? Math.round((n / bb()) * 10) / 10 : n);
  const fromUnits = (n) => (ctx.units() === 'bb' ? Math.round(n * bb()) : Math.round(n));

  function send(action) {
    if (!legal) return;
    const l = legal;
    // last line of defense: never hand the engine something legalActions() ruled out
    if (action.type === 'fold' && !l.canFold) return;
    if (action.type === 'check' && !l.canCheck) return;
    if (action.type === 'call' && (l.canCheck || !(l.callAmount > 0))) return;
    legal = null;
    ctx.onAct(action);
  }
  function sendRaise() {
    if (!legal || !(legal.canBet || legal.canRaise)) return;
    const to = clamp(value);
    send({ type: legal.canBet ? 'bet' : 'raise', to });
  }
  // legal sizes: [minTo, maxTo], or exactly all-in when the stack is short of a full raise
  function clamp(v) {
    if (!Number.isFinite(v)) v = lo;
    v = Math.round(Math.min(hi, Math.max(lo, v)));
    if (v < legal.minTo && v !== legal.allInTo) v = Math.min(legal.minTo, legal.allInTo);
    return v;
  }
  function set(v) {
    if (!legal) return;
    value = clamp(v);
    range.value = value;
    input.value = toUnits(value);
    const allIn = value === legal.allInTo;
    raiseLabel.textContent = `${allIn ? 'All-in' : legal.canBet ? 'Bet' : 'Raise to'} ${ctx.fmt(value)}`;
    [...presets.children].forEach((b) => b.classList.toggle('sel', Number(b.dataset.to) === value));
  }
  function nudge(dir, big) {
    if (!legal || !(legal.canBet || legal.canRaise) || lo === hi) return;
    set(value + dir * bb() * (big ? 5 : 1));
  }

  function turn(l, st) {
    legal = l; state = st;
    foldArmed = false; foldLabel.textContent = 'Fold';
    root.replaceChildren();
    const canSize = l.canBet || l.canRaise;
    fold.disabled = !l.canFold;
    raise.disabled = false;
    const stack = st.seats[l.seat]?.stack ?? Infinity;
    callLabel.textContent = l.canCheck ? 'Check' : l.callAmount >= stack ? `Call all-in ${ctx.fmt(l.callAmount)}` : `Call ${ctx.fmt(l.callAmount)}`;
    call.disabled = !l.canCheck && !(l.callAmount > 0);
    root.append(fold, call);
    if (canSize) {
      lo = Math.min(l.minTo, l.allInTo);
      hi = Math.min(l.maxTo, l.allInTo);
      const fixed = lo === hi || st.betting === 'FL';
      if (!fixed) {
        const opts = presetSizes(st, l).map(([lab, to]) => [lab, Math.round(to)]);
        opts.push([hi === l.allInTo ? 'All-in' : 'Max', hi]);
        presets.replaceChildren(...opts.map(([lab, to]) => {
          const t = clamp(to);
          return h('button', { type: 'button', 'data-to': t, title: `${lab}: ${ctx.fmt(t)}`, onclick: () => set(t) }, lab, h('small', {}, ctx.fmt(t)));
        }));
        Object.assign(range, { min: lo, max: hi, step: 1 });
        Object.assign(input, { min: toUnits(lo), max: toUnits(hi), step: ctx.units() === 'bb' ? 0.5 : 1 });
        root.append(sizer);
      } else root.append(h('div.msg'));
      set(lo);
      root.append(raise);
    } else root.append(h('div.msg'));
    root.classList.add('turn');
  }

  function wait(text) {
    legal = null;
    foldArmed = false; foldLabel.textContent = 'Fold';
    root.classList.remove('turn');
    msg.textContent = text || '';
    fold.disabled = call.disabled = raise.disabled = true;
    callLabel.textContent = 'Check / Call';
    raiseLabel.textContent = 'Bet / Raise';
    root.replaceChildren(fold, call, msg, raise);
    clearHint();
  }

  function custom(...nodes) {
    legal = null;
    root.classList.remove('turn');
    root.replaceChildren(...nodes);
  }

  // Coach "Do it": fill the bar, never act. Advice left on screen after your turn is stale, so ignore it then.
  function fill(action) {
    if (!legal || !action) return;
    clearHint();
    let target = call;
    if (action.type === 'fold') target = fold;
    else if (action.type === 'bet' || action.type === 'raise') { if (legal.canBet || legal.canRaise) { set(action.to); target = raise; } }
    target.classList.add('hint-pulse');
    target.focus();
  }
  function clearHint() { [fold, call, raise].forEach((b) => b.classList.remove('hint-pulse')); }

  function key(e) {
    if (!legal) return false;
    const t = e.target;
    const inNum = t instanceof HTMLInputElement && t.type === 'number';
    const inRange = t === range;
    const k = e.key.toLowerCase();
    if (inNum) return false; // the number field handles its own Enter
    if (k === 'f') { fold.click(); return true; }
    if (k === 'c') { call.click(); return true; }
    if (k === 'r' && (legal.canBet || legal.canRaise)) { if (sizer.isConnected) { input.focus(); input.select(); } else raise.focus(); return true; }
    if (k === 'enter') {
      if (t instanceof HTMLButtonElement && root.contains(t)) return false; // native button activation
      const hinted = [fold, call, raise].find((b) => b.classList.contains('hint-pulse'));
      if (hinted) { hinted.click(); return true; }
      if (sizer.contains(t) && (legal.canBet || legal.canRaise)) { raise.click(); return true; } // confirm a size being set
      return false;
    }
    if (inRange) return false; // native slider arrows
    if (k === 'arrowup' || k === 'arrowright') { nudge(1, e.shiftKey); return true; }
    if (k === 'arrowdown' || k === 'arrowleft') { nudge(-1, e.shiftKey); return true; }
    return false;
  }

  wait('');
  return { turn, wait, custom, fill, key, get live() { return !!legal; } };
}
