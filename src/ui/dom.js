import { animate } from 'motion';

/** h('div.a.b', { onclick, ... }, ...children) */
export function h(sel, attrs, ...kids) {
  const [tag, ...cls] = sel.split('.');
  const el = document.createElement(tag || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && k !== 'type') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}

export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Critically damped spring; under reduced motion only the opacity part runs, as a short cross-fade. */
export function spring(el, kf, opts = {}) {
  if (reduced()) {
    const o = 'opacity' in kf ? { opacity: kf.opacity } : null;
    if (!o) {
      // apply end state at once
      return animate(el, Object.fromEntries(Object.entries(kf).map(([k, v]) => [k, Array.isArray(v) ? v[v.length - 1] : v])), { duration: 0 });
    }
    return animate(el, o, { duration: 0.18, delay: opts.delay ?? 0 });
  }
  return animate(el, kf, { type: 'spring', bounce: 0, duration: 0.4, ...opts });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
