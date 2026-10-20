// Home, Settings and How to play screens.
import { h } from './dom.js';
import { cardEl } from './cards.js';
import { rankingsSheet, termsSheet } from './rankings.js';
import { PERSONALITIES, showOf } from '../strategy/personalities.js';
import { seg, field } from './setup.js';

const STRUCT = { cash: 'cash game', tournament: 'tournament' };
const BET = { NL: 'No-limit', PL: 'Pot-limit', FL: 'Fixed-limit' };

const list = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** What "Play" will deal, in one line. */
function tableSummary(s) {
  const names = s.opponents.map((id) => PERSONALITIES[id]?.name || id);
  return `${BET[s.betting]} ${STRUCT[s.structure]} vs ${list(names)} (${showOf(s.show).name})`;
}

/**
 * opts: { resumable, firstVisit, onPlay(), onNewGame(), onHowTo(), onSettings() }
 */
export function renderHome(root, settings, opts) {
  const fan = h('div.home-fan', { 'aria-hidden': 'true' }, cardEl('As', [74, 104]), cardEl('Kh', [74, 104]));
  const play = h('button.btn.primary.xl', { type: 'button', onclick: opts.onPlay }, opts.resumable ? 'Resume game' : 'Play');
  root.replaceChildren(h('div.home', {},
    fan,
    h('p.presents', {}, 'The Rayze Company presents'),
    h('h1', {}, 'Pure Poker Sim'),
    h('p.tagline', {}, 'Texas Hold’em against characters from your favorite comedies, with a coach that explains every decision.'),
    h('div.home-actions', {},
      play,
      h('p.home-sub', {}, opts.resumable ? 'Pick up the hand you left.' : tableSummary(settings)),
      h('div.home-row', {},
        h('button.btn.secondary', { type: 'button', onclick: opts.onNewGame }, 'New game'),
        h('button.btn.secondary', { type: 'button', onclick: opts.onHowTo }, 'How to play'),
        h('button.btn.secondary', { type: 'button', onclick: opts.onSettings }, 'Settings'))),
    opts.firstVisit ? h('p.home-hint', {}, 'New to poker? Start with How to play. It takes two minutes.') : null,
  ));
}

const SPEEDS = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };

/**
 * Display and helper settings. They apply as you change them.
 * opts: { onChange(key, value), onDone(), doneLabel }
 */
export function renderSettings(root, settings, opts) {
  const set = (k, v) => { opts.onChange(k, v); draw(); };
  const sw = (key, title, sub) => h('label.switch-row', {},
    h('span', {}, title, sub ? h('small', {}, sub) : null),
    h('input', { type: 'checkbox', role: 'switch', checked: !!settings[key], onchange: (e) => set(key, e.target.checked) }));

  function draw() {
    root.replaceChildren(h('div.setup-card.grain', {},
      h('div.setup-head', {}, h('div', {},
        h('h1', {}, 'Settings'),
        h('p', {}, 'Changes apply right away. To change opponents or rules, start a New game.'))),
      h('div.setup-grid', {},
        field('Game speed', [seg(SPEEDS, settings.speed, (v) => set('speed', v), 'Game speed'), h('p.explain', {}, 'How long opponents take to act.')]),
        field('Show amounts in', [seg({ chips: 'Chips', bb: 'Big blinds' }, settings.units, (v) => set('units', v), 'Units'),
          h('p.explain', {}, settings.units === 'bb' ? 'Amounts show as multiples of the big blind (e.g. 12.5 BB), the way pros talk about stacks.' : 'Amounts show as chip counts. Big blinds shows them as multiples of the big blind (the larger forced bet).')]),
        field('Helpers', [h('div.switches', {},
          sw('equity', 'Win chance under your cards', 'What you hold and your odds to win right now'),
          sw('autoReview', 'Coach review after each hand', 'A short note on each decision you made'),
          sw('positions', 'Seat position labels', 'Shows BTN, SB, BB… next to names'),
          sw('rankings', 'Hand rankings button', 'Top bar shortcut to the hand list'))], true),
        field('Table', [h('div.switches', {},
          sw('fourColor', 'Four-color deck', 'Diamonds blue, clubs green: easier to spot flushes'),
          sw('autoDeal', 'Deal the next hand automatically', 'Otherwise press Next hand (N)'))], true),
      ),
      h('div.setup-foot', {}, h('button.btn.primary.lg', { type: 'button', onclick: opts.onDone }, opts.doneLabel || 'Done'))));
  }
  draw();
}

const KEYS = [
  ['F', 'Fold'], ['C', 'Check or call'], ['R', 'Choose a bet or raise size'], ['Enter', 'Confirm a bet'],
  ['A', 'Ask the coach'], ['N', 'Next hand'],
];

/** opts: { onBack(), onPlay() } */
export function renderHowTo(root, opts) {
  const step = (n, title, ...body) => h('li.step', {}, h('span.n', {}, n), h('div', {}, h('h3', {}, title), ...body));
  root.replaceChildren(h('div.setup-card.grain.howto', {},
    h('div.setup-head', {}, h('div', {},
      h('h1', {}, 'How to play'),
      h('p', {}, 'Texas Hold’em in two minutes. You can open the hand rankings and the coach any time during a game.'))),
    h('div.howto-grid', {},
      h('section', {},
        h('h2', {}, 'The goal'),
        h('p', {}, 'Win chips. You win a hand by having the best five-card hand at the end, or by betting so that everyone else folds.'),
        h('h2', {}, 'How a hand goes'),
        h('ol.steps', {},
          step(1, 'Blinds', h('p', {}, 'Two players post small forced bets (the small and big blind) so there is something to win.')),
          step(2, 'Two cards each', h('p', {}, 'You get two private cards. A round of betting follows.')),
          step(3, 'The flop, turn and river', h('p', {}, 'Five shared cards are dealt face up: three, then one, then one. There is a betting round after each.')),
          step(4, 'Showdown', h('p', {}, 'If two or more players are left, the best five cards from your two plus the five shared cards win the pot.'))),
        h('h2', {}, 'Your options'),
        h('dl.opts', {},
          h('dt', {}, 'Fold'), h('dd', {}, 'Give up this hand. You lose only what you already put in.'),
          h('dt', {}, 'Check'), h('dd', {}, 'Pass without betting, when nobody has bet yet.'),
          h('dt', {}, 'Call'), h('dd', {}, 'Match the current bet to stay in.'),
          h('dt', {}, 'Bet / Raise'), h('dd', {}, 'Put in chips (or more than the current bet). Others must match it or fold.')),
        h('h2', {}, 'Keyboard'),
        h('div.keys', {}, KEYS.map(([k, v]) => h('div', {}, h('kbd', {}, k), h('span', {}, v)))),
        h('h2', {}, 'Getting help'),
        h('p', {}, 'The bar under your cards shows what you hold and your chance to win. Press Ask coach (A) on your turn for a recommendation; after each hand the coach reviews your decisions. To bet, press Bet / Raise, pick a size (the small buttons are in big blinds, “bb”, or a share of the pot) or drag the slider, then confirm.'),
        h('h2', {}, 'Poker terms'),
        h('p', {}, 'Words the coach uses. This list is also under Hand rankings in the top bar during a game.'),
        termsSheet()),
      h('section.howto-ranks', {}, h('h2', {}, 'Hand rankings'), rankingsSheet(false))),
    h('div.setup-foot', {},
      h('button.btn.secondary', { type: 'button', onclick: opts.onBack }, 'Back'),
      h('button.btn.primary.lg', { type: 'button', onclick: opts.onPlay }, opts.playLabel || 'Play'))));
}
