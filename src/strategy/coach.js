// Coach: plain-English advice from the same baseline policy the bots use. Hero's information only.
// Framing, glossary and beginner-mistake list follow docs/THEORY.md (sections 1, 6, 7, 8.3).
import { analyze, BASE_PARAMS, preflopName, heroEquity, RANK_NAME } from './policy.js';
import { RANKS, cardIdx, drawInfo, drawNames, handClassOf } from './combos.js';
import { posName } from './preflop.js';
import { evaluate } from '../engine/evaluator.js';

const pc = (x) => `${Math.round(x * 100)}%`;
const bbs = (chips, bb) => { const v = chips / bb; return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}bb`; };
const informed = (f) => (f.villains || []).filter((v) => v.pct < 0.85 || f.street !== 'preflop');

// ---------- glossary (THEORY 7) ----------
const GLOSSARY = {
  equity: 'Your share of the pot if all the cards were dealt out now with no more betting: win % plus half of ties.',
  'pot odds': 'The price of a call: what you must put in divided by the pot after you call. Call when your equity beats it (ignoring future betting).',
  'implied odds': 'Extra chips you expect to win on later streets when you hit, which can make a draw worth calling without direct odds.',
  'reverse implied odds': 'Extra chips you lose when you hit but are still behind, typical of dominated hands like a weak ace.',
  'equity realization': 'How much of your raw equity you actually turn into winnings. Out of position, or with a dominated hand, you realize less because you face bets and fold before showdown.',
  dominated: 'A hand that shares a card with a better hand in the opponent\'s range (AT vs AK or AQ): when both hit, you usually lose a big pot.',
  outs: 'Unseen cards that improve you to (probably) the best hand.',
  SPR: 'Stack-to-pot ratio: the smaller stack behind divided by the pot. Below about 2, top pair is worth all your chips; above 10, one pair should keep the pot small.',
  MDF: 'Minimum defense frequency: how often you must continue against a bet so pure bluffs do not automatically profit, 1 / (1 + bet/pot).',
  alpha: 'How often a bluff must work to break even: bet / (pot + bet).',
  range: 'All the hands a player could have given their actions, with frequencies.',
  'range advantage': 'More equity overall than the opponent\'s range on this board, which lets you bet often and small.',
  'nut advantage': 'More of the very best hands than the opponent, which lets you bet big.',
  polarized: 'A range of very strong hands and bluffs, with few medium hands. Goes with big bets.',
  capped: 'A range that rarely contains the strongest hands, because those would have raised earlier.',
  'value bet': 'A bet hoping worse hands call.',
  'thin value': 'A value bet with a hand only slightly ahead of the hands that call.',
  bluff: 'A bet with a hand that wins mainly when they fold.',
  'semi-bluff': 'A bluff with a draw: it can win now if they fold, or improve if they call.',
  'bluff catcher': 'A hand that beats only bluffs. You call with it, you rarely bet it.',
  'pot control': 'Checking a medium hand to keep the pot small, since it does not want to face a big raise.',
  protection: 'Betting so draws and overcards must pay to see the next card.',
  'free card': 'Checking with a draw to see the next card without paying.',
  'c-bet': 'Continuation bet: the preflop raiser bets again on the flop.',
  'donk bet': 'Leading out into the player who was the aggressor on the previous street. Rare in good strategies.',
  'check-raise': 'Checking, then raising when the opponent bets.',
  slowplay: 'Playing a strong hand passively to trap.',
  overbet: 'A bet larger than the pot.',
  blockers: 'Cards in your hand that make some opponent hands impossible or less likely (holding the ace of spades blocks the nut spade flush).',
  'open raise': 'The first raise before the flop when everyone before you folded (RFI, raise first in).',
  '3-bet': 'The first re-raise before the flop (the big blind counts as the first bet, the open as the second).',
  '4-bet': 'A re-raise of a 3-bet.',
  squeeze: 'A 3-bet after an open and one or more callers.',
  'iso-raise': 'Raising over a limper to play heads-up against them.',
  'push/fold': 'Short-stack strategy (about 15 big blinds or fewer): go all-in or fold, no small raises.',
  'effective stack': 'The smaller of the two stacks in a confrontation: what is actually at risk.',
  position: 'Acting last (in position) lets you see what the opponent does first. Out of position you act first, which costs equity.',
  'fold equity': 'The extra value of a bet or raise from the times the opponent folds.',
  'showdown value': 'A hand that can win without betting.',
  'results-oriented thinking': 'Judging a decision by how the cards fell instead of by the information and odds you had. A trap.',
};
function terms(list) {
  const seen = new Set();
  return list.filter((t) => GLOSSARY[t] && !seen.has(t) && seen.add(t)).map((term) => ({ term, meaning: GLOSSARY[term] }));
}
const WHY_TERMS = {
  chart: ['range', 'open raise'], 'push-fold': ['push/fold', 'effective stack'], 'pot-odds': ['pot odds', 'equity'], 'value-shove': ['equity'],
  value: ['value bet', 'equity'], 'polar-value': ['overbet', 'capped', 'nut advantage', 'polarized'], 'thin-value': ['thin value'],
  'semi-bluff': ['semi-bluff', 'outs', 'fold equity'], bluff: ['bluff', 'blockers', 'alpha'], 'range-bet': ['range advantage', 'c-bet'],
  protection: ['protection', 'c-bet'], commit: ['SPR'], trap: ['slowplay', 'check-raise'], balance: ['range'], 'check-to-raiser': ['donk bet', 'check-raise'],
  'give-up': ['bluff'], 'free-card': ['free card', 'outs'], 'pot-control': ['pot control', 'showdown value'],
  'value-raise': ['value bet', 'check-raise'], 'value-call': ['equity', 'pot odds'], 'bluff-catch': ['bluff catcher', 'pot odds'],
  'mdf-defend': ['MDF', 'bluff catcher'], 'draw-odds': ['outs', 'pot odds'], 'implied-odds': ['implied odds', 'outs'], 'river-raise': ['polarized', 'bluff catcher'],
};

// ---------- phrasing ----------
function actionText(o, view) {
  const bb = view.bigBlind, legal = view.legal, a = o.action;
  if (a.type === 'bet' || a.type === 'raise') {
    if (a.to === legal.allInTo) return `Move all-in (${a.to}, ${bbs(a.to, bb)})`;
    const frac = o.pf ? `, ${potFrac(o.pf)} pot` : '';
    return `${a.type === 'bet' ? 'Bet' : 'Raise to'} ${a.to} (${bbs(a.to, bb)}${frac})`;
  }
  if (a.type === 'call') return `Call ${legal.callAmount}${legal.callAmount >= view.seats[view.heroSeat].stack ? ' (all-in)' : ''}`;
  return a.type === 'check' ? 'Check' : 'Fold';
}
function potFrac(f) {
  const opts = [[0.33, 'about ⅓'], [0.5, 'about ½'], [0.66, 'about ⅔'], [0.75, 'about ¾'], [1, 'about the'], [1.25, 'about 1¼×'], [1.5, 'about 1½×']];
  let best = opts[0];
  for (const o of opts) if (Math.abs(o[0] - f) < Math.abs(best[0] - f)) best = o;
  return best[1];
}
const TIGHT = { UTG: ', the tightest position at the table', UTG1: ', one of the tightest positions', LJ: ', an early position' };
const raiserPhrase = (f) => (f.openerPos ? `a raise from ${posName(f.openerPos)}${TIGHT[f.openerPos] || ''}` : 'the raise');

function preflopSentence(o, f) {
  const hand = f.handName, k = f.spotKind, pos = posName(f.heroPos);
  if (o.kind === 'fold') {
    const what = { rfi: `open from ${pos}`, push: `shove from ${pos} with about ${Math.round(f.effStackBB)} big blinds`, vsOpen: `call ${raiserPhrase(f)}`,
      vs3bet: 'continue against a 3-bet', cold3bet: 'continue against a raise and a 3-bet', vs4bet: 'continue against a 4-bet', vs5bet: 'continue against this many raises',
      limped: 'play behind the limpers', callPush: 'call this all-in' }[k] || 'play here';
    return `${hand} is too weak to ${what}.`;
  }
  if (o.kind === 'check') return `${hand} is not worth raising, so take the free flop.`;
  if (o.kind === 'call') {
    if (k === 'vsOpen') return `${hand} plays well enough to call ${raiserPhrase(f)}${f.ipVsRaiser ? ', and you will have position after the flop' : ''}.`;
    if (k === 'vs3bet') return `${hand} is good enough to call the 3-bet${f.ipVsRaiser ? ' in position' : ''}, but not to 4-bet.`;
    if (k === 'callPush') return `${hand} is ahead of enough of their shoving range to call.`;
    if (k === 'rfi' || k === 'limped') return `${hand} is a hand the charts sometimes complete or limp from here.`;
    return `${hand} is strong enough to continue here.`;
  }
  const what = { rfi: `a standard open from ${pos}`, vsOpen: `strong enough to 3-bet ${raiserPhrase(f)}`, vs3bet: 'strong enough to 4-bet',
    cold3bet: 'strong enough to 4-bet', vs4bet: 'strong enough to go all-in against a 4-bet', limped: 'strong enough to raise the limpers (iso-raise)',
    bbVsLimp: 'strong enough to raise from the big blind' }[k] || 'strong enough to raise';
  return `${hand} is ${what}.`;
}

/** One plain sentence on why option `o` is played ('' if there is nothing specific to say). */
function whyText(o, f) {
  const need = f.requiredEquity ?? f.potOdds;
  switch (o.why) {
    case 'chart': return preflopSentence(o, f);
    case 'push-fold': return `With about ${Math.round(f.effStackBB)} big blinds it's push or fold, and ${f.handName} is a profitable shove from ${posName(f.heroPos)}.`;
    case 'pot-odds':
      if (o.kind !== 'fold') return `You need ${pc(need)} equity and have about ${pc(f.equity)}, so calling makes money.`;
      return f.equity < need ? `You need ${pc(need)} equity to call and have only about ${pc(f.equity)}.`
        : `You have about ${pc(f.equity)} equity against ${pc(need)} needed, too thin an edge once the rest of the hand is played.`;
    case 'value-shove': return 'You are well ahead of their range, so get the money in.';
    case 'value': return 'You are ahead of most hands that will call, so bet for value.';
    case 'polar-value': return 'Their range is capped and you often have the nuts, so a big bet gets the most value.';
    case 'thin-value': return 'A small bet for thin value: worse hands still call a small bet.';
    case 'semi-bluff': return `A semi-bluff: they may fold now, and if not you still have ${f.outs} outs.`;
    case 'bluff': return 'Your hand can\'t win at showdown, and a bet here tells a believable story.';
    case 'range-bet': return 'Your whole range is ahead on this board, so a small bet with most of it works.';
    case 'protection': return 'Your hand is probably best but vulnerable, so make the draws and overcards pay.';
    case 'commit': return `With a stack-to-pot ratio of ${f.spr.toFixed(1)}, this hand is strong enough to get all the chips in.`;
    case 'trap': return 'Checking a strong hand now and then keeps your checks from looking weak. You can still check-raise or call.';
    case 'balance': return 'Checking some good hands here keeps your strategy hard to read.';
    case 'check-to-raiser': return 'Let the last bettor keep betting. You can call or check-raise next.';
    case 'give-up': return 'This hand is better as a check than as a bluff.';
    case 'free-card': return 'With a draw, taking a free card is fine.';
    case 'pot-control': return 'A medium hand wants a small pot (pot control).';
    case 'value-raise': return 'You are well ahead of the hands that will keep playing, so raise for value.';
    case 'value-call': return 'You are ahead of a lot of their betting range.';
    case 'bluff-catch': return `Your hand beats their bluffs, and ${pc(f.potOdds)} pot odds is a good enough price.`;
    case 'mdf-defend': return 'If you fold a hand this good, they can bluff you with anything.';
    case 'draw-odds': return 'Your draw has enough equity for the price.';
    case 'implied-odds': return 'Your draw plus what you can win when it hits (implied odds) makes this call pay.';
    case 'river-raise': return 'River raises are mostly strong hands, and yours mainly beats bluffs.';
    default: return '';
  }
}
function headlineFor(o, f, view) {
  const t = whyText(o, f);
  return `${actionText(o, view)}.${t ? ' ' + t : ''}`;
}

/** Explain when the advice seems to contradict raw equity vs pot odds (coordinator note, THEORY 1). */
function contradiction(top, f) {
  if (!(f.toCall > 0) || f.equity == null) return null;
  if (f.street === 'preflop' && ['rfi', 'push', 'limped', 'bbVsLimp', 'bbOption'].includes(f.spotKind)) return null; // equity vs random hands; fold equity drives these
  const eq = f.equity, odds = f.potOdds;
  const k = top.kind;
  if (k === 'fold' && eq >= odds) {
    const why = [];
    const termsUsed = ['equity realization'];
    if (f.street === 'preflop') {
      const h = f.handClass || '';
      const domin = /^[AKQJ][2-9TJQ]o$/.test(h) && !/^AK|^AQ/.test(h);
      if (domin) { why.push(`${f.handName} is often dominated by the hands that raise here (better aces and kings), so you lose the big pots`); termsUsed.push('dominated', 'reverse implied odds'); }
      if (f.behind > 0) { why.push(`${f.behind} player${f.behind > 1 ? 's are' : ' is'} still to act behind you and can 3-bet (squeeze) or wake up with a big hand`); termsUsed.push('squeeze'); }
      if (f.ipVsRaiser === false) { why.push('you would play the rest of the hand out of position'); termsUsed.push('position'); }
    } else {
      if (!f.ip) { why.push('you are out of position, so you will face more bets and fold before showdown'); termsUsed.push('position'); }
      if (f.street !== 'river') why.push('more betting is coming, and the hands that keep betting are the ones that beat you');
      if (f.facingRaise) why.push('a raise is a strong, value-heavy line');
    }
    if (!why.length) why.push('this equity is against their whole estimated range, but the hands that bet this way are stronger than average');
    return { text: `Your raw equity (${pc(eq)}) beats the pot odds (${pc(odds)}), but you won't realize it all (equity realization): ${why.join('; ')}.`, terms: termsUsed };
  }
  if (k === 'call' && eq < odds) {
    if (top.why === 'implied-odds') return { text: `Your equity (${pc(eq)}) is a bit below the pot odds (${pc(odds)}), but with deep stacks you win extra when the draw hits: implied odds.`, terms: ['implied odds'] };
    if (top.why === 'mdf-defend') return { text: `Your equity (${pc(eq)}) is slightly below the pot odds (${pc(odds)}) against their estimated range, but that estimate assumes they rarely bluff. Folding this often would let them bluff profitably with any two cards (MDF).`, terms: ['MDF'] };
    return { text: `Your equity (${pc(eq)}) is close to the pot odds (${pc(odds)}); this call is near break-even.`, terms: ['pot odds'] };
  }
  if ((k === 'raise' || k === 'bet') && eq < odds) {
    return { text: `Raising with ${pc(eq)} equity works because of fold equity: they fold often enough that the raise wins even when your hand is behind.`, terms: ['fold equity'] };
  }
  return null;
}

function chartLine(f, view) {
  if (!f.chart) return null;
  const parts = [];
  const act = (x) => (view.legal.canCheck && x === 'call' ? 'check' : x);
  if (f.chart.raise > 0.005) parts.push(`${f.spotKind === 'push' ? 'shove' : 'raise'} ${pc(f.chart.raise)}`);
  if (f.chart.call > 0.005) parts.push(`${act('call')} ${pc(f.chart.call)}`);
  if (f.chart.fold > 0.005 && !view.legal.canCheck) parts.push(`fold ${pc(f.chart.fold)}`);
  const src = f.betting === 'FL' ? 'Standard limit charts' : f.spotKind === 'push' || f.spotKind === 'callPush' ? 'Push/fold charts' : `Standard ${f.depth}bb charts`;
  const one = parts.length === 1 ? parts[0].replace(/ 100%$/, '') : null;
  return one ? `${src} ${one} ${f.handClass} here every time.` : `${src} mix with ${f.handClass} here: ${parts.join(', ')}.`;
}

function outsLine(f) {
  if (!(f.outs >= 4) || f.street === 'river') return null;
  const o = f.outs;
  if (f.street === 'flop') {
    const next = o / 47, both = 1 - ((47 - o) * (46 - o)) / (47 * 46);
    return `${o} outs: about ${pc(next)} to hit on the turn, ${pc(both)} by the river if you see both cards.`;
  }
  return `${o} outs: about ${pc(o / 46)} to hit on the river.`;
}

function equityLine(f) {
  const vs = (f.equityVs || []).length;
  let s = `Equity about ${pc(f.equity)} ${vs > 1 ? `against all ${vs} opponents' estimated ranges` : vs === 1 ? `against ${f.equityVs[0]}'s estimated range` : ''}`;
  if (f.equityHU && vs > 1) s += ` (heads-up vs ${f.equityHU.name}: ${pc(f.equityHU.equity)})`;
  if (f.toCall > 0) s += `. Calling ${f.toCall} into a pot of ${f.pot} gives pot odds of ${f.toCall} / ${f.pot + f.toCall} = ${pc(f.potOdds)}`;
  return s + '.';
}

function reasonsFor(top, f, view) {
  const r = [];
  const c = contradiction(top, f);
  if (c) r.push(c.text);
  if (f.street === 'preflop') {
    if (f.toCall > 0 && (f.spotKind !== 'rfi' && f.spotKind !== 'push' || top.why === 'pot-odds')) r.push(equityLine(f));
    const cl = chartLine(f, view);
    if (cl && top.why !== 'pot-odds') r.push(cl);
    if (f.effStackBB < 20) r.push(`Effective stack: about ${Math.round(f.effStackBB)} big blinds.`);
  } else {
    const name = heroHandName(f, view);
    const draws = f.draws.map((d) => d.replace(/^(?!two )/, 'a '));
    r.push(`You have ${name.toLowerCase()}${draws.length ? ', plus ' + draws.join(' and ') : ''}. ${equityLine(f)}`);
    for (const n of (f.notes || []).slice(0, 1)) r.push(n);
    const ol = outsLine(f);
    if (ol) r.push(ol);
    if (f.texture) r.push(`Board: ${f.texture.desc}. Stack-to-pot ratio ${f.spr.toFixed(1)}; you are ${f.ip ? 'in position' : 'out of position'}.`);
  }
  return { reasons: r.slice(0, 4), terms: c ? c.terms : [] };
}

/** The key numbers block shared by advice and review (villain ranges live here, not in the reasons). */
const numbersOf = (f, view) => ({
  equity: f.equity, potOdds: f.toCall > 0 ? f.potOdds : undefined, outs: f.outs, spr: f.street === 'preflop' ? undefined : f.spr,
  potSize: f.pot, toCall: f.toCall, handName: heroHandName(f, view),
  villainRange: informed(f).map((v) => `${v.name}'s range here: ${v.desc}`).join(' · ') || undefined,
});

export function adviseNow(view) {
  const a = analyze(view, BASE_PARAMS);
  if (!a) return null;
  const f = a.facts;
  const top = a.options[0];
  let headline = headlineFor(top, f, view);
  const meaningful = a.options.filter((o) => o.freq >= 0.1);
  let mix;
  if (meaningful.length > 1) {
    mix = a.options.filter((o) => o.freq >= 0.03).map((o) => ({ label: o.label, freq: Math.round(o.freq * 100) / 100 }));
    headline += ` Mixed spot: ${shortLabel(top)} about ${pc(top.freq)} of the time, ${shortLabel(meaningful[1])} otherwise. Both are fine.`;
  }
  const { reasons, terms: extra } = reasonsFor(top, f, view);
  const termList = [...extra, ...(WHY_TERMS[top.why] || []), ...(f.street !== 'preflop' ? ['equity', 'SPR'] : []), ...(f.toCall > 0 ? ['pot odds'] : []),
    ...(f.outs >= 4 ? ['outs'] : []), ...(f.mdf != null ? ['MDF'] : []), 'range'];
  if (f.spotKind === 'vsOpen') termList.push('3-bet'); if (f.spotKind === 'vs3bet') termList.push('4-bet'); if (f.spotKind === 'limped') termList.push('iso-raise');
  return {
    action: top.action,
    label: top.label,
    mix,
    headline,
    reasons,
    numbers: numbersOf(f, view),
    terms: terms(termList),
  };
}
const shortLabel = (o) => (o.action.type === 'check' ? 'check' : o.action.type === 'fold' ? 'fold' : o.action.type === 'call' ? 'call' : o.action.type === 'bet' ? `bet ${o.action.to}` : `raise to ${o.action.to}`);

// ---------- review ----------
const MISTAKES = {
  limp: ['Open-limping', 'Raising wins the blinds often, takes the initiative and builds a pot you are ahead in. Only the small blind in tournaments mixes in limps.'],
  early: ['Playing too many hands from early position', 'With up to seven players behind, under the gun opens only about 13% of hands.'],
  oopCall: ['Calling too much out of position before the flop', 'From the small blind, 3-bet or fold: flatting out of position with weaker hands loses.'],
  weakAce: ['Overvaluing weak aces, KJo or QJo against a raise', 'These hands are dominated by the raiser\'s AK, AQ and KQ: when you hit, you often lose a big pot.'],
  bbFold: ['Not defending the big blind enough', 'You already have 1bb in and close the action: defend about 60% or more against a button open.'],
  bbOver: ['Over-defending against an early-position open', 'An under-the-gun range is strong: the big blind defends only about 23% against it at 100bb.'],
  allIn: ['Calling all-ins as wide as you would shove', 'Calling needs more equity than shoving, because the caller gets no fold equity.'],
  autoCbet: ['Auto c-betting every flop', 'Whether to c-bet depends on who the board favors. Check more on middling connected boards and multiway.'],
  mwBluff: ['Bluffing into several players', 'Every opponent has to fold for a bluff to work. Value-bet thinner instead.'],
  chase: ['Chasing a draw without the odds', 'Compare your equity to the pot odds: a 9-out draw on the turn is about 20%.'],
  slowWet: ['Slowplaying on a wet board', 'Checking a strong hand here gives free cards to draws. Bet for value and protection.'],
  tiny: ['Betting too small with a strong hand', 'Size by what worse hands will call: usually half to three-quarters of the pot.'],
  riverCall: ['Calling a river raise or overbet with one pair', 'Those lines are polarized and value-heavy. Check what they represent before calling.'],
};

function describeAction(action, legal) {
  if (action.type === 'call') return legal.canCheck ? 'Checked' : `Called ${legal.callAmount}`;
  if (action.type === 'bet') return `Bet ${action.to}`;
  if (action.type === 'raise') return `Raised to ${action.to}`;
  return action.type === 'check' ? 'Checked' : 'Folded';
}

function matchOption(options, action, legal) {
  let type = action.type;
  if (type === 'call' && legal.canCheck) type = 'check';
  if (type === 'bet' || type === 'raise') {
    const same = options.filter((o) => o.action.type === 'bet' || o.action.type === 'raise');
    if (!same.length) return { freq: 0, opt: null, sizeOff: false };
    const freq = same.reduce((a, o) => a + o.freq, 0);
    const near = same.reduce((b, o) => (Math.abs(o.action.to - action.to) < Math.abs(b.action.to - action.to) ? o : b));
    const sizeOff = Math.abs(near.action.to - action.to) > Math.max(0.4 * legal.pot, 0.35 * near.action.to) && action.to !== legal.allInTo && near.action.to !== legal.allInTo;
    return { freq, opt: near, sizeOff };
  }
  const o = options.find((x) => x.action.type === type);
  return { freq: o ? o.freq : 0, opt: o || null, sizeOff: false };
}

function kindOf(action, legal) {
  if (action.type === 'call' && legal.canCheck) return 'check';
  return action.type === 'bet' || action.type === 'raise' ? 'raise' : action.type;
}

function spotMistake(view, f, action, a) {
  const legal = view.legal, kind = kindOf(action, legal);
  const freqOf = (k) => a.options.filter((o) => (k === 'raise' ? o.action.type === 'bet' || o.action.type === 'raise' : o.action.type === k)).reduce((s, o) => s + o.freq, 0);
  if (f.street === 'preflop') {
    const h = f.handClass, chartPlay = f.chart ? f.chart.raise + f.chart.call : 1;
    if (f.spotKind === 'rfi' && kind === 'call' && f.heroPos !== 'SB') return 'limp';
    if (f.spotKind === 'rfi' && kind === 'raise' && f.chart?.raise === 0 && ['UTG', 'UTG1', 'LJ'].includes(f.heroPos)) return 'early';
    if (f.spotKind === 'vsOpen' && f.heroPos === 'SB' && kind === 'call' && (f.chart?.call ?? 0) < 0.2) return 'oopCall';
    if ((f.spotKind === 'vsOpen' || f.spotKind === 'vs3bet') && kind !== 'fold' && chartPlay === 0 && /^(A[2-9T]o|A[2-8]s|KJo|QJo|KTo|QTo|JTo)$/.test(h)) return 'weakAce';
    if (f.spotKind === 'vsOpen' && f.heroPos === 'BB' && kind === 'fold' && chartPlay >= 0.7) return 'bbFold';
    if (f.spotKind === 'vsOpen' && f.heroPos === 'BB' && kind !== 'fold' && chartPlay === 0 && ['UTG', 'UTG1'].includes(f.openerPos)) return 'bbOver';
    if (a.options.some((o) => o.why === 'pot-odds') && kind === 'call' && freqOf('fold') >= 0.8) return 'allIn';
    return null;
  }
  const tier = f.plan?.tier;
  const req = f.requiredEquity ?? f.potOdds;
  if (kind === 'raise' && legal.canBet && f.street === 'flop' && f.plan?.hadInit && freqOf('raise') < 0.2 && f.plan.F != null && f.plan.F < 0.5) return 'autoCbet';
  if (kind === 'raise' && (f.villains || []).length >= 2 && f.strength < 0.35 && !(f.outs >= 8)) return 'mwBluff';
  if (kind === 'call' && f.outs >= 4 && f.equity < req - 0.05) return 'chase';
  if (kind === 'check' && tier === 'value' && f.texture?.wet >= 2 && freqOf('raise') >= 0.7) return 'slowWet';
  if (kind === 'raise' && legal.canBet && tier === 'value' && action.to - (view.seats[view.heroSeat].bet || 0) < 0.25 * legal.pot && action.to !== legal.allInTo) return 'tiny';
  if (kind === 'call' && f.street === 'river' && (f.facingRaise || f.toCall >= f.pot - f.toCall) && f.category <= 1 && freqOf('fold') >= 0.6) return 'riverCall';
  return null;
}

export function reviewHand(record) {
  const decisions = [];
  const score = { good: 0, okay: 0, mistake: 0 };
  const patterns = [];
  for (const dec of record.heroDecisions || []) {
    const view = dec.view;
    const a = analyze(view, BASE_PARAMS);
    if (!a) continue;
    const f = a.facts, top = a.options[0];
    const legal = view.legal;
    const { freq, opt, sizeOff } = matchOption(a.options, dec.action, legal);
    const kind = kindOf(dec.action, legal);
    const req = f.requiredEquity ?? f.potOdds;
    const best = Math.max(...a.options.map((o) => (o.ev != null ? o.ev : -Infinity)));
    const close = opt?.ev != null && Number.isFinite(best) && best - opt.ev <= Math.max(view.bigBlind, 0.08 * legal.pot);
    let verdict, explanation;
    // THEORY 8.3
    if (freq >= 0.15 && !sizeOff) { verdict = 'good'; explanation = freq >= 0.6 ? `Good play. ${whyText(opt, f)}`.trim() : `Fine: a mixed spot, and this play is used about ${pc(freq)} of the time.`; }
    else if (freq >= 0.15) { verdict = 'okay'; explanation = `Right idea, but the size is off: ${top.label.toLowerCase()} does the job better.`; }
    else if (f.street === 'preflop' && !a.options.some((o) => o.why === 'pot-odds')) {
      const other = Math.max(...a.options.filter((o) => kindOf(o.action, legal) !== kind).map((o) => o.freq), 0);
      if (freq === 0 && other >= 0.7) { verdict = 'mistake'; explanation = 'The charts never play this hand that way here.'; }
      else { verdict = 'okay'; explanation = `A rare choice here (about ${pc(freq)}); ${top.label.toLowerCase()} is the main line.`; }
    } else if (kind === 'call' && f.toCall > 0) {
      if (f.equity < req - 0.05) { verdict = 'mistake'; explanation = `You called needing ${pc(req)} equity with only about ${pc(f.equity)}.`; }
      else { verdict = 'okay'; explanation = `A close call: about ${pc(f.equity)} equity against ${pc(req)} needed.`; }
    } else if (kind === 'fold' && f.toCall > 0) {
      if (f.equity > req + 0.1 && !f.facingRaise) { verdict = 'mistake'; explanation = `You folded about ${pc(f.equity)} equity when you only needed ${pc(req)}.`; }
      else { verdict = 'okay'; explanation = 'A slightly tight fold, but not a big error.'; }
    } else if (freq >= 0.03 || close) { verdict = 'okay'; explanation = freq >= 0.03 ? `A low-frequency option (about ${pc(freq)}); ${top.label.toLowerCase()} is the main line.` : 'Close in expected value to the best play.'; }
    else { verdict = 'mistake'; explanation = 'Strong players almost never play it this way here.'; }
    const pat = verdict === 'good' ? null : spotMistake(view, f, dec.action, a); // a pattern inside a mixed spot is fine
    if (pat) { if (verdict === 'okay' && ['mwBluff', 'chase', 'limp', 'allIn'].includes(pat)) verdict = 'mistake'; explanation += ` Common beginner mistake: ${MISTAKES[pat][0].toLowerCase()}. ${MISTAKES[pat][1]}`; patterns.push(MISTAKES[pat][0]); }
    if (!(verdict === 'good' && freq >= 0.6)) explanation += ` Coach's line: ${headlineFor(top, f, view)}`; // a clear good play already explained itself
    const c = verdict !== 'good' ? contradiction(top, f) : null;
    if (c) explanation += ` ${c.text}`;
    score[verdict]++;
    decisions.push({
      street: view.street, board: [...view.board], heroCards: [...view.seats[view.heroSeat].holeCards],
      youDid: describeAction(dec.action, legal),
      coachSays: top.label + (a.options[1] && a.options[1].freq >= 0.1 ? ` (or ${shortLabel(a.options[1])} ${pc(a.options[1].freq)})` : ''),
      verdict, explanation, pattern: pat ? MISTAKES[pat][0] : undefined,
      numbers: numbersOf(f, view),
    });
  }
  const hs = record.heroSeat ?? 0;
  const invested = (record.actions || []).filter((x) => x.seat === hs).reduce((s, x) => s + (x.amount || 0), 0);
  const returned = (record.result?.returned || []).filter((x) => x.seat === hs).reduce((s, x) => s + x.amount, 0);
  const net = (record.result?.payouts?.[hs] || 0) + returned - invested;
  const n = decisions.length;
  let summary;
  if (!n) summary = 'You had no decisions this hand.';
  else {
    summary = `${score.good} good, ${score.okay} okay, ${score.mistake} mistake${score.mistake === 1 ? '' : 's'} across ${n} decision${n === 1 ? '' : 's'}.`;
    if (patterns.length) summary += ` Watch for: ${[...new Set(patterns)].join('; ').toLowerCase()}.`;
    if (net < 0 && score.mistake === 0 && record.result?.showdown) summary += ' You lost chips, but your decisions were sound: that part was variance.';
    else if (net > 0 && score.mistake > 0) summary += ' You won the pot, but judge the decisions, not the result (results-oriented thinking is a trap).';
    else if (score.mistake === 0) summary += ' Well played.';
  }
  const shown = Object.entries(record.result?.revealed || {}).filter(([s]) => Number(s) !== hs);
  if (shown.length) summary += ' Shown at showdown: ' + shown.map(([s, cards]) => `${record.seats?.[s]?.name ?? 'Seat ' + s} ${cards.join(' ')}`).join(', ') + '.';
  return { summary, decisions, score };
}

// ---------- live aids ----------
export function describeHand(heroCards, board) {
  if (!heroCards || heroCards.length < 2) return { name: '', category: 0, draws: [], outs: 0 };
  if (!board || board.length < 3) {
    const h = handClassOf(heroCards[0], heroCards[1]);
    return { name: preflopName(h), category: h.length === 2 ? 1 : 0, draws: [], outs: 0 };
  }
  const ev = evaluate([...heroCards, ...board]);
  const d = board.length < 5 ? drawInfo(cardIdx(heroCards[0]), cardIdx(heroCards[1]), board.map(cardIdx)) : { outs: 0 };
  const draws = board.length < 5 ? drawNames(d).map((s) => s[0].toUpperCase() + s.slice(1)) : [];
  return { name: boardPlays(heroCards, board, ev) || ev.name, category: ev.category, draws, outs: d.outs };
}

// When the made hand lives entirely on the board (e.g. A-J on 9-7-9), every player has it: say so.
function boardPlays(heroCards, board, ev) {
  if (board.length === 5 && evaluate(board).score === ev.score) return `${ev.name} (playing the board)`;
  const counts = {};
  for (const c of board) counts[c[0]] = (counts[c[0]] || 0) + 1;
  const n = Object.values(counts).sort((a, b) => b - a);
  const boardCat = n[0] === 4 ? 7 : n[0] === 3 && n[1] >= 2 ? 6 : n[0] === 3 ? 3 : n[0] === 2 && n[1] === 2 ? 2 : n[0] === 2 ? 1 : 0;
  if (!boardCat || ev.category !== boardCat) return null;
  if (heroCards.some((c) => counts[c[0]])) return null; // a hole card pairs the board, so the hand is really ours
  // a pocket pair can make the same category as the board but better (99 on 8-8-5-5-2 is nines and eights)
  const made = new Set(ev.best5.map((c) => c[0]).filter((r, i, a) => a.indexOf(r) !== a.lastIndexOf(r)));
  if (heroCards.some((c) => ev.best5.includes(c) && made.has(c[0]))) return null;
  const high = heroCards.map((c) => c[0]).sort((a, b) => RANKS.indexOf(b) - RANKS.indexOf(a))[0];
  return `${RANK_NAME[high]} high (board: ${ev.name.toLowerCase()})`;
}

/** Same equity the coach shows: vs every opponent still in the hand, same iterations and seed. */
export function liveEquity(view) {
  const me = view.seats[view.heroSeat];
  if (!me?.holeCards || me.holeCards.length < 2) return null;
  const r = heroEquity(view);
  return { handName: describeHand(me.holeCards, view.board).name, equity: r.equity, vs: r.vs };
}

function heroHandName(f, view) {
  return f.street === 'preflop' ? f.handName : describeHand(view.seats[view.heroSeat].holeCards, view.board).name;
}
