import { h } from './dom.js';
import { avatarEl } from './avatars.js';
import { PERSONALITIES, SHOWS, showOf } from '../strategy/personalities.js';
import { pickShow, levelSchedule, cap } from './settings.js';

const STRUCTURE = {
  cash: ['Cash game', 'Relaxed and endless. Blinds never change, and if you run out of chips you can rebuy.'],
  tournament: ['Tournament', 'Last one standing wins. Blinds go up every few hands and busted players are out.'],
};
const BETTING = {
  NL: ['No-limit', 'Bet any amount up to your whole stack, any time. The classic game.'],
  PL: ['Pot-limit', 'Bets and raises are capped at the size of the pot.'],
  FL: ['Fixed-limit', 'Fixed sizes: one small bet preflop and on the flop, double on turn and river; max four bets a street.'],
};
const BLINDS = [[1, 2], [2, 5], [5, 10], [25, 50]];
const STACKS = {
  20: ['Short', 'Short stacks mean lots of all-ins: fast and swingy.'],
  40: ['Medium', 'Room for a raise or two before someone is all-in.'],
  100: ['Standard', 'The usual cash-game amount: room to play every street.'],
  200: ['Deep', 'More room to outplay people, and bigger pots.'],
};
const ANTES = { none: 'None', player: 'Per player', bb: 'Big blind ante' };
const ANTE_EXPLAIN = {
  none: 'No antes. Only the blinds are posted.',
  player: 'Every player puts in a small ante each hand, so there is more to win before the flop.',
  bb: 'The big blind posts one ante for the whole table (a big blind’s worth).',
};

/** Segmented radio group. onPick(value) must redraw. */
export const seg = (options, value, onPick, label) =>
  h('div.seg', { role: 'radiogroup', 'aria-label': label }, Object.entries(options).map(([v, text]) =>
    h('button' + (String(value) === String(v) ? '.sel' : ''), {
      type: 'button', role: 'radio', 'aria-checked': String(String(value) === String(v)), onclick: () => onPick(v),
    }, text)));

export const field = (label, body, wide, right) =>
  h('div.field' + (wide ? '.wide' : ''), {}, h('div.label', {}, h('span', {}, label), right || null), body);

/**
 * The New game screen: who you play and the table rules.
 * opts: { inSession: bool, onStart(s), onBack() }
 */
export function renderSetup(root, settings, opts) {
  const s = structuredClone(settings);
  let customBlinds = !BLINDS.some(([a, b]) => a === s.sb && b === s.bb);
  let customStack = !STACKS[s.stackBB];
  let moreOpen = false;

  const pick = (options, value, onPick, label) => seg(options, value, (v) => { onPick(v); draw(); }, label);

  const num = (value, onSet, label, min = 0) => h('input.num', {
    type: 'number', min, step: 1, value, 'aria-label': label,
    onchange: (e) => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n)) onSet(Math.max(min, n)); draw(); },
  });

  const sw = (key, title) => h('label.switch-row', {},
    h('span', {}, title),
    h('input', { type: 'checkbox', role: 'switch', checked: !!s[key], onchange: (e) => { s[key] = e.target.checked; } }));

  function draw() {
    const scroll = root.scrollTop;
    const show = showOf(s.show);
    const selected = s.opponents.length;
    const chips = s.stackBB * s.bb;

    const showPicker = h('label.show-pick', {},
      h('span', {}, 'Show'),
      h('select', {
        'aria-label': 'TV show',
        onchange: (e) => { pickShow(s, e.target.value); draw(); },
      }, SHOWS.map((x) => h('option', { value: x.id, selected: x.id === show.id }, x.name))));

    const opps = h('div.opps', {}, show.cast.map((id) => {
      const p = PERSONALITIES[id] || {};
      const on = s.opponents.includes(id);
      return h('button.opp' + (on ? '.sel' : ''), {
        type: 'button', 'aria-pressed': String(on),
        onclick: () => {
          if (on && s.opponents.length === 1) return; // keep at least one
          s.opponents = on ? s.opponents.filter((x) => x !== id) : show.cast.filter((x) => x === id || s.opponents.includes(x));
          draw();
        },
      },
      avatarEl(id, p.name || cap(id)),
      h('span.who', { title: p.blurb || '' }, h('b', {}, p.name || cap(id), p.style ? h('em', {}, p.style) : null), h('small', {}, p.blurb || ' ')),
      h('span.tick'));
    }));

    const stackOpts = Object.fromEntries(Object.entries(STACKS).map(([n, [name]]) => [n, name]));
    stackOpts.custom = 'Custom';

    const blindOpts = Object.fromEntries(BLINDS.map(([a, b]) => [`${a}/${b}`, `${a}/${b}`]));
    blindOpts.custom = 'Custom';
    const sched = levelSchedule(s).slice(0, 5).map((l) => `${l.sb}/${l.bb}`).join(', ');

    const more = h('details.more', { open: moreOpen, ontoggle: (e) => { moreOpen = e.target.open; } },
      h('summary', {}, h('span', {}, 'More rules'), h('small', {}, `${BETTING[s.betting][0]} · blinds ${s.sb}/${s.bb}${s.anteMode !== 'none' ? ' · antes' : ''}`)),
      h('div.setup-grid', {},
        field('Betting', [pick(Object.fromEntries(Object.entries(BETTING).map(([k, v]) => [k, v[0]])), s.betting, (v) => (s.betting = v), 'Betting'), h('p.explain', {}, BETTING[s.betting][1])]),
        field('Blinds', [
          pick(blindOpts, customBlinds ? 'custom' : `${s.sb}/${s.bb}`, (v) => {
            if (v === 'custom') { customBlinds = true; return; }
            customBlinds = false; [s.sb, s.bb] = v.split('/').map(Number);
          }, 'Blinds'),
          customBlinds ? h('div.inline', {},
            'Small', num(s.sb, (n) => (s.sb = Math.max(1, Math.min(n, s.bb))), 'Small blind', 1),
            'Big', num(s.bb, (n) => { s.bb = Math.max(2, n); s.sb = Math.min(s.sb, s.bb); }, 'Big blind', 2)) : null,
          h('p.explain', {}, `The two players left of the dealer post forced bets of ${s.sb} and ${s.bb} chips each hand, so there is always something to win.`),
        ]),
        field('Ante', [
          pick(ANTES, s.anteMode, (v) => { s.anteMode = v; if (v === 'player' && !s.ante) s.ante = Math.max(1, Math.round(s.bb / 8)); }, 'Ante'),
          s.anteMode === 'player' ? h('div.inline', {}, 'Ante per player', num(s.ante, (n) => (s.ante = Math.max(1, n)), 'Ante', 1), 'chips') : null,
          h('p.explain', {}, ANTE_EXPLAIN[s.anteMode]),
        ]),
        s.structure === 'tournament'
          ? field('Blinds go up every', [
            pick({ 5: '5 hands', 10: '10 hands', 15: '15 hands', 20: '20 hands' }, s.handsPerLevel, (v) => (s.handsPerLevel = Number(v)), 'Blind level length'),
            h('p.explain', {}, `Blinds rise every ${s.handsPerLevel} hands: ${sched}…`),
          ])
          : field('Rebuys', [h('div.switches', { style: { gridTemplateColumns: '1fr' } }, sw('autoRebuy', 'Opponents rebuy when they run out')),
            h('p.explain', {}, 'You can always rebuy yourself if you run out.')]),
      ));

    const card = h('div.setup-card.grain', {},
      h('div.setup-head', {},
        h('div', {},
          h('h1', {}, 'New game'),
          h('p', {}, 'Pick a show, choose who sits down, and deal. Every opponent plays strong poker; each has a slightly different style.'))),
      h('div.setup-grid', {},
        field('Opponents', [opps, h('p.explain', {}, selected === 1
          ? 'Heads-up: just you and one opponent.'
          : `${selected + 1} players at the table: you and ${selected} opponents. Tap a card to add or remove someone.`)], true, showPicker),
        field('Game type', [pick(Object.fromEntries(Object.entries(STRUCTURE).map(([k, v]) => [k, v[0]])), s.structure, (v) => (s.structure = v), 'Game type'), h('p.explain', {}, STRUCTURE[s.structure][1])]),
        field('Starting chips', [
          pick(stackOpts, customStack ? 'custom' : s.stackBB, (v) => {
            if (v === 'custom') { customStack = true; return; }
            customStack = false; s.stackBB = Number(v);
          }, 'Starting chips'),
          customStack ? h('div.inline', {}, num(s.stackBB, (n) => (s.stackBB = Math.min(1000, Math.max(10, n))), 'Starting chips in big blinds', 10), 'big blinds (10 to 1,000)') : null,
          h('p.explain.stack', {},
            h('b', {}, `Everyone starts with ${chips.toLocaleString()} chips`),
            ` (${s.stackBB.toLocaleString()} big blinds). ${customStack ? 'Poker players count stacks in big blinds because it shows how many hands you can afford to play.' : STACKS[s.stackBB][1]}`),
        ]),
      ),
      more,
      h('div.setup-foot', {},
        h('button.btn.secondary', { type: 'button', onclick: () => opts.onBack() }, 'Back'),
        h('button.btn.primary.lg', { type: 'button', onclick: () => opts.onStart(s) }, opts.inSession ? 'Start new game' : 'Deal me in')),
    );
    root.replaceChildren(card);
    root.scrollTop = scroll;
  }
  draw();
}
