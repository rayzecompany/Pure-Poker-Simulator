import { h } from './dom.js';
import { PERSONALITIES } from '../strategy/personalities.js';

// Drawn avatars: a little emoji-style bust per character, from a one-line look:
// "skin hair style [extras]". Generic on purpose (no likenesses), tinted per show so a table reads as one cast.
const SKIN = { l: '#f2c9a6', t: '#d6a27a', m: '#b47a52', d: '#7b4b2e' };
const HAIR = { k: '#221b17', db: '#3d2819', br: '#6b4527', au: '#93421f', bl: '#dcb563', gy: '#9b9894', wh: '#e4e0d8' };
const SHOW_HUE = { community: 40, office: 205, goodplace: 160, parks: 95, b99: 15, superstore: 265 };
const LOOKS = {
  jeff: 'l db short', annie: 'l br long', britta: 'l bl long', pierce: 'l wh bald', abed: 't k short', troy: 'd k buzz', shirley: 'd k curly',
  'office-michael': 'l db part', 'office-dwight': 'l br part g', 'office-jim': 'l br short', 'office-pam': 'l au long',
  'office-angela': 'l bl bun', 'office-kevin': 'l br bald', 'office-stanley': 'd gy bald gm',
  'goodplace-eleanor': 'l bl long', 'goodplace-chidi': 'd k buzz', 'goodplace-tahani': 'm k long', 'goodplace-jason': 't k short',
  'goodplace-michael': 'l wh short', 'goodplace-janet': 'm k pony', 'goodplace-shawn': 'l gy buzz',
  'parks-leslie': 'l bl bob', 'parks-ron': 'l br short m', 'parks-april': 'l k long', 'parks-andy': 'l br short',
  'parks-tom': 'm k part', 'parks-ben': 'l br part', 'parks-donna': 'd k curly',
  'b99-jake': 'l db short', 'b99-amy': 't k long', 'b99-holt': 'd gy buzz', 'b99-rosa': 't k curly',
  'b99-terry': 'd k bald', 'b99-charles': 'l br part', 'b99-gina': 'l db long',
  'superstore-amy': 't br long', 'superstore-jonah': 'l br short', 'superstore-dina': 'l bl pony', 'superstore-glenn': 'l gy bald g',
  'superstore-garrett': 'd k buzz b', 'superstore-mateo': 't k part', 'superstore-cheyenne': 't k pony',
};

const CAP = 'M11.5 18a8.5 8.5 0 0 1 17 0q-8.5-6-17 0z';
// hair drawn behind the head, then over it
const BACK = { long: 'M10.5 19a9.5 10 0 0 1 19 0v10h-19z', bob: 'M10.6 18.5a9.4 9.4 0 0 1 18.8 0v6.5h-18.8z', pony: 'M26 12.5q6 3 4 13q-2-5-4.5-7z' };
const FRONT = {
  short: CAP, long: CAP, bob: CAP, pony: CAP,
  buzz: 'M12.2 15.6a8.5 8.5 0 0 1 15.6 0q-7.8-3.4-15.6 0z',
  part: 'M11.5 18a8.5 8.5 0 0 1 17 0q-2.5-5.5-10.5-4.8q-3.5.8-6.5 4.8z',
  bun: `${CAP}M23 9.5a3 3 0 1 1-6 0a3 3 0 1 1 6 0z`,
  curly: [[12.5, 15.5], [14.5, 12], [18, 10.2], [22, 10.2], [25.5, 12], [27.5, 15.5]].map(([x, y]) => `M${x - 3.3} ${y}a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0-6.6 0z`).join(''),
};
const EXTRA = {
  g: '<g fill="none" stroke="#1d1d1f" stroke-width="1"><circle cx="16.8" cy="18.4" r="2.3"/><circle cx="23.2" cy="18.4" r="2.3"/><path d="M19.1 18.2h1.8"/></g>',
  m: (c) => `<path d="M16.8 21.6q3.2-1.6 6.4 0q-3.2 1.2-6.4 0z" fill="${c}"/>`,
  b: (c) => `<path d="M11.7 18.5q.4 9.5 8.3 9.5t8.3-9.5q-1.8 4.2-8.3 4.6q-6.5-.4-8.3-4.6z" fill="${c}"/>`,
};

const cache = new Map();
function svgFor(id) {
  if (cache.has(id)) return cache.get(id);
  const [skin, hair, style, extras = ''] = LOOKS[id].split(' ');
  const s = SKIN[skin], c = HAIR[hair], hue = SHOW_HUE[PERSONALITIES[id].show];
  const path = (d, fill) => (d ? `<path d="${d}" fill="${fill}"/>` : '');
  const svg = `<svg class="avatar" viewBox="0 0 40 40" aria-hidden="true">`
    + `<circle cx="20" cy="20" r="20" fill="hsl(${hue} 20% 22%)"/>`
    + path(BACK[style], c)
    + `<path d="M6 40a14 11 0 0 1 28 0z" fill="hsl(${hue} 38% 46%)"/><rect x="17" y="23" width="6" height="6" rx="2" fill="${s}"/>`
    + `<circle cx="20" cy="18" r="8.5" fill="${s}"/>`
    + path(FRONT[style], c)
    + '<g fill="#2a1f1a"><circle cx="16.8" cy="18.6" r="1"/><circle cx="23.2" cy="18.6" r="1"/></g>'
    + '<path d="M17.4 22.4q2.6 1.8 5.2 0" fill="none" stroke="#5a2e22" stroke-width="1" stroke-linecap="round"/>'
    + [...extras].map((x) => (typeof EXTRA[x] === 'function' ? EXTRA[x](c) : EXTRA[x])).join('')
    + '</svg>';
  cache.set(id, svg);
  return svg;
}

export function avatarEl(id, name) {
  if (!LOOKS[id]) return h('div.avatar.initial', { 'aria-hidden': 'true' }, (name || '?')[0]); // you
  const t = document.createElement('template');
  t.innerHTML = svgFor(id); // built only from the constants above
  return t.content.firstChild;
}
