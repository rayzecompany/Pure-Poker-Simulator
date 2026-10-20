import { h, spring } from './dom.js';
import { miniCards } from './cards.js';
import { adviseNow, reviewHand } from '../strategy/coach.js';

const pctOf = (v) => (v == null || !Number.isFinite(Number(v)) ? null : `${Math.round(Number(v) <= 1 ? Number(v) * 100 : Number(v))}%`);
const STREET = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' };

/**
 * Right-hand panel: Coach and History tabs, collapsible.
 * ctx: { fmt(n), onFill(action) }
 */
export function createPanel(wrap, ctx) {
  let tab = 'coach', view = null, open = true, token = 0;
  const body = h('div.panel-body');
  const tCoach = h('button.btn.ghost.sm.on', { type: 'button', onclick: () => setTab('coach') }, 'Coach');
  const tHist = h('button.btn.ghost.sm', { type: 'button', onclick: () => setTab('history') }, 'History');
  const ask = h('button.btn.primary', { type: 'button', disabled: true, onclick: () => advise() }, 'Ask coach', h('kbd', {}, 'A'));
  const askNote = h('p.explain', {}, 'Ask on your turn for a recommendation. Reviews appear after each hand.');
  const coachBox = h('div.coach-box');
  const coachPane = h('div', {}, h('section', {}, ask, askNote), coachBox);
  const histList = h('ul.hist');
  const histPane = h('div', {}, histList);
  const panel = h('aside.panel', { 'aria-label': 'Coach and history' }, h('div.tabs', {}, tCoach, tHist), body);
  wrap.replaceChildren(panel);
  body.append(coachPane);

  function setTab(t) {
    tab = t;
    tCoach.classList.toggle('on', t === 'coach');
    tHist.classList.toggle('on', t === 'history');
    body.replaceChildren(t === 'coach' ? coachPane : histPane);
    body.scrollTop = 0;
  }

  function setTurn(v) {
    view = v;
    ask.disabled = !v;
    askNote.textContent = v ? 'Your turn. The coach sees only what you can see.' : 'Ask on your turn for a recommendation. Reviews appear after each hand.';
  }

  function show(node, toCoach = true) {
    coachBox.replaceChildren(node);
    if (toCoach && tab !== 'coach') setTab('coach');
    spring(node, { opacity: [0, 1], y: [6, 0] }, { duration: 0.35 });
  }

  // Show a placeholder, then compute once it has painted. A newer request wins.
  function run(placeholder, build, toCoach) {
    const t = ++token;
    const note = (text) => h('section', {}, h('p.empty', {}, text));
    show(note(placeholder), toCoach);
    setTimeout(() => {
      if (t !== token) return;
      let node;
      try { node = build(); } catch (err) { console.error(err); node = note(`The coach hit an error: ${err.message}`); }
      show(node, toCoach);
    }, 30);
  }

  function advise() {
    const v = view;
    if (v) run('Thinking…', () => renderAdvice(adviseNow(v)));
  }

  function renderAdvice(a) {
    const n = a.numbers || {};
    const cells = [
      ['Equity', pctOf(n.equity)], ['Pot odds', pctOf(n.potOdds)], ['Outs', n.outs ?? null],
      ['SPR', n.spr != null ? Number(n.spr).toFixed(1) : null], ['Pot', n.potSize != null ? ctx.fmt(n.potSize) : null], ['To call', n.toCall ? ctx.fmt(n.toCall) : null],
    ].filter(([, v]) => v != null && v !== '');
    return h('div', {},
      h('section', {},
        h('span.label', {}, 'Coach says'),
        h('p.headline', { style: { marginTop: '8px' } }, a.headline || ''),
        h('div.rec', {},
          h('span.tag', {}, a.label || a.action?.type || ''),
          h('button.btn.secondary.sm', { type: 'button', title: 'Fills the action bar; you still confirm', onclick: () => ctx.onFill(a.action) }, 'Do it')),
        a.mix?.length > 1 ? h('div.mix', {}, a.mix.map((m) => h('div.row', {}, h('span', {}, m.label), h('b', {}, pctOf(m.freq)), h('div.bar', {}, h('span', { style: { width: pctOf(m.freq) } }))))) : null,
        a.reasons?.length ? h('ul.reasons', {}, a.reasons.map((r) => h('li', {}, r))) : null),
      cells.length || n.handName ? h('section', {},
        h('span.label', {}, n.handName ? `You have: ${n.handName}` : 'Numbers'),
        cells.length ? h('div.nums', {}, cells.map(([k, v]) => h('div', {}, h('span.label', {}, k), h('b', {}, v)))) : null) : null,
      n.villainRange ? h('section', {}, h('span.label', {}, 'Their likely range'), h('p.range', {}, n.villainRange)) : null,
      terms(a.terms));
  }

  function terms(list) {
    if (!list?.length) return null;
    return h('section', {}, h('span.label', { style: { marginBottom: '6px' } }, 'Terms'),
      list.map((t) => h('details.term', {}, h('summary', {}, t.term), h('p', {}, t.meaning))));
  }

  // an automatic review must not pull you off the History tab
  function review(record, auto) {
    run(`Reviewing hand ${record.handNumber}…`, () => renderReview(record, reviewHand(record)), !auto);
  }

  function renderReview(record, r) {
    const sc = r.score || {};
    return h('div', {},
      h('section', {},
        h('span.label', {}, `Hand ${record.handNumber} review`),
        h('p.headline', { style: { marginTop: '8px' } }, r.summary || ''),
        h('div.score', {},
          sc.good ? h('span.verdict.good', {}, `${sc.good} good`) : null,
          sc.okay ? h('span.verdict.okay', {}, `${sc.okay} okay`) : null,
          sc.mistake ? h('span.verdict.mistake', {}, `${sc.mistake} mistake${sc.mistake > 1 ? 's' : ''}`) : null)),
      h('section', {},
        r.decisions?.length ? r.decisions.map((d) => h('div.decision', {},
          h('div.top', {}, h('span.label', {}, STREET[d.street] || d.street), h('span.verdict.' + (d.verdict || 'okay'), {}, d.verdict || 'okay')),
          h('div.mini', {}, miniCards(d.heroCards), d.board?.length ? h('span', { style: { width: '8px' } }) : null, miniCards(d.board)),
          h('p', {}, h('b', {}, 'You: '), d.youDid, d.coachSays ? [h('br'), h('b', {}, 'Coach: '), d.coachSays] : null),
          d.explanation ? h('p.ex', {}, d.explanation) : null))
          : h('p.empty', {}, 'You had no decisions to make this hand.')),
      terms(r.terms));
  }

  function renderHistory(history, deltas) {
    const rows = [...history].reverse().map((rec) => {
      const d = deltas.get(rec.handNumber) ?? 0;
      const cls = d > 0 ? 'pos' : d < 0 ? 'neg' : 'zero';
      const info = rec.result?.showdown ? 'Showdown' : (rec.board?.length ? ['', '', '', 'Flop', 'Turn', 'River'][rec.board.length] : 'Preflop');
      return h('li', {}, h('button', { type: 'button', onclick: () => review(rec, false), title: 'Coach review of this hand' },
        h('span.no', {}, `#${rec.handNumber}`), h('span.cards', {}, miniCards(rec.heroCards, [20, 28])), h('span.info', {}, info),
        h('span.res.' + cls, {}, `${d > 0 ? '+' : d < 0 ? '−' : ''}${ctx.fmt(Math.abs(d))}`)));
    });
    histList.replaceChildren(...(rows.length ? rows : [h('p.empty', {}, 'No hands yet.')]));
  }

  function toggle() {
    open = !open;
    const w = open ? panel.offsetWidth : 0;
    spring(wrap, { width: open ? [wrap.offsetWidth, w] : 0 }, { duration: 0.4 }).then(() => { if (open) wrap.style.width = ''; });
    return open;
  }

  return { setTurn, advise, review, renderHistory, toggle, get isOpen() { return open; } };
}
