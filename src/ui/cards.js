import { h } from './dom.js';

const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_NAME = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const RANK_NAME = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };

/** A playing card. code like "As"; null/undefined = face down. size: [w, h] in px. */
export function cardEl(code, size = [36, 50], small = false) {
  const style = `--w:${size[0]}px;--h:${size[1]}px`;
  if (!code) return h('div.pc.back', { style, 'aria-label': 'face-down card' });
  const r = code[0], s = code[1];
  const rank = RANK_NAME[r] ?? r;
  return h(`div.pc.${s}${s === 'h' || s === 'd' ? '.red' : ''}${small ? '.sm' : ''}`, { style, 'aria-label': `${rank} of ${SUIT_NAME[s]}`, 'data-card': code },
    h('span.r', rank), h('span.s', SUIT[s]), h('span.big', SUIT[s]));
}

export const miniCards = (codes, size = [22, 30]) => (codes || []).map((c) => cardEl(c, size, true));
