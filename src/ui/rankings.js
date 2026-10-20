import { h } from './dom.js';
import { miniCards } from './cards.js';

const HANDS = [
  ['Royal flush', 'As Ks Qs Js Ts'],
  ['Straight flush', '9h 8h 7h 6h 5h'],
  ['Four of a kind', 'Qc Qd Qh Qs 7d'],
  ['Full house', 'Jh Jc Js 4d 4s'],
  ['Flush', 'Ad Jd 8d 6d 2d'],
  ['Straight', 'Tc 9d 8s 7h 6c'],
  ['Three of a kind', '8c 8h 8d Ks 3c'],
  ['Two pair', 'Ah Ad 9c 9s 5h'],
  ['One pair', 'Kd Kc Jh 7s 4c'],
  ['High card', 'Ac Qd 9h 6s 3d'],
];

const POSITIONS = [
  ['UTG', 'Under the gun: first to act preflop. Play tightest here.'],
  ['UTG+1, LJ, HJ', 'Early to middle seats (lojack, hijack): open a bit wider each seat.'],
  ['CO', 'Cutoff: one before the button. A strong stealing seat.'],
  ['BTN', 'Button: acts last after the flop. The best seat.'],
  ['SB', 'Small blind: posts half a blind, acts first after the flop.'],
  ['BB', 'Big blind: posts a full blind, acts last preflop.'],
];

// Plain-English meanings of the words the table, bet buttons and coach use.
const TERMS = [
  ['Big blind (BB, bb)', 'The larger forced bet. Sizes like "3bb" mean 3 big blinds; stacks are often counted in big blinds.'],
  ['Suited / offsuit', 'Your two cards are the same suit (suited, "s") or not (offsuit, "o"). AKs = ace-king suited.'],
  ['Pocket pair', 'Two cards of the same rank in your hand, like two sevens.'],
  ['% to win (equity)', 'Your chance to win if the hand were played out against what opponents are likely to hold.'],
  ['Pot odds', 'The price of a call: what you must put in compared with the pot you could win. Call when your equity beats it.'],
  ['Outs', 'Cards still in the deck that would likely give you the best hand.'],
  ['Range', 'All the hands a player could have, given how they have played so far.'],
  ['Position', 'Where you sit relative to the dealer button. Acting later (in position) is an advantage.'],
  ['Open / limp', 'Open: the first raise before the flop. Limp: just calling the big blind instead of raising.'],
  ['3-bet / 4-bet', 'A re-raise of a raise, then a re-raise of that.'],
  ['C-bet', 'Continuation bet: the preflop raiser bets again on the flop.'],
  ['Value bet / bluff', 'Value: betting a strong hand to get called by worse. Bluff: betting a weak hand to make better hands fold.'],
  ['Semi-bluff', 'A bluff with a draw that can still improve to the best hand.'],
  ['Slowplay / check-raise', 'Playing a strong hand passively to trap; or checking, then raising after someone bets.'],
  ['Overbet', 'A bet bigger than the pot.'],
  ['SPR', 'Stack-to-pot ratio: chips behind divided by the pot. Low SPR means you are close to all-in.'],
  ['Side pot', 'When someone is all-in, extra bets between the others go into a separate pot they can’t win.'],
];

export function termsSheet() {
  return h('dl.terms', {}, TERMS.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

export function rankingsSheet(withTerms = true) {
  return [
    h('div.label', { style: { marginBottom: '8px' } }, 'Hands, best to worst'),
    HANDS.map(([name, cards], i) => h('div.rank-row', {},
      h('span.n', {}, i + 1), h('span.t', {}, name), h('span.ex', {}, miniCards(cards.split(' '), [20, 28])))),
    h('div.label', { style: { marginTop: '14px' } }, 'Positions'),
    h('div.posgrid', {}, POSITIONS.map(([k, v]) => [h('b', {}, k), h('span', {}, v)])),
    withTerms ? [h('div.label', { style: { marginTop: '14px' } }, 'Poker terms'), termsSheet()] : null,
  ];
}
