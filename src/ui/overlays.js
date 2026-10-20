import { h, spring } from './dom.js';

/** Modal with a dim scrim. Resolves true/false. */
export function confirmDialog(title, text, okLabel) {
  return new Promise((resolve) => {
    const close = (v) => { dismiss(scrim, modal).then(() => resolve(v)); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(false); } };
    const ok = h('button.btn.primary', { type: 'button', onclick: () => close(true) }, okLabel);
    const modal = h('div.modal.grain', { role: 'dialog', 'aria-modal': 'true' },
      h('h2', {}, title), h('p', {}, text),
      h('div.row', {}, h('button.btn.secondary', { type: 'button', onclick: () => close(false) }, 'Cancel'), ok));
    const scrim = h('div.scrim', { onpointerdown: (e) => { if (e.target === scrim) close(false); } }, modal);
    document.body.append(scrim);
    document.addEventListener('keydown', onKey, true);
    present(scrim, modal);
    ok.focus();
  });
}

/** Result card (tournament over, hero busted). actions: [{ label, primary, onclick }] */
export function resultCard(title, text, actions) {
  const modal = h('div.modal.grain', { role: 'dialog', 'aria-modal': 'true' },
    h('h2', {}, title), h('p', {}, text),
    h('div.row', {}, actions.map((a) => h('button.btn.' + (a.primary ? 'primary' : 'secondary'), {
      type: 'button', onclick: () => dismiss(scrim, modal).then(a.onclick),
    }, a.label))));
  const scrim = h('div.scrim', {}, modal);
  document.body.append(scrim);
  present(scrim, modal);
  modal.querySelector('.primary')?.focus();
}

function present(scrim, modal) {
  spring(scrim, { opacity: [0, 1] }, { duration: 0.3 });
  spring(modal, { opacity: [0, 1], scale: [0.97, 1], y: [8, 0] }, { duration: 0.35 });
}
function dismiss(scrim, modal) {
  if (!scrim.isConnected) return Promise.resolve();
  scrim.style.pointerEvents = 'none';
  spring(modal, { opacity: 0, scale: 0.97, y: 8 }, { duration: 0.3 });
  return spring(scrim, { opacity: 0 }, { duration: 0.3 }).then(() => scrim.remove());
}

let toastBox;
export function toast(text) {
  if (!toastBox?.isConnected) { toastBox = h('div.toasts', { 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h('div.toast', {}, text);
  toastBox.append(t);
  spring(t, { opacity: [0, 1], y: [-10, 0] });
  setTimeout(() => spring(t, { opacity: 0, y: -10 }).then(() => t.remove()), 3200);
}

/** A popover anchored to its trigger: grows from the trigger's corner, exits back into it. */
export function popover(trigger, build) {
  let el = null;
  const onDown = (e) => { if (el && !el.contains(e.target) && !trigger.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function open() {
    el = h('div.pop.grain', { role: 'dialog' }, build());
    document.body.append(el);
    const r = trigger.getBoundingClientRect();
    const w = el.offsetWidth;
    const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
    Object.assign(el.style, { top: `${r.bottom + 6}px`, left: `${left}px`, transformOrigin: `${r.right - left - r.width / 2}px 0` });
    spring(el, { opacity: [0, 1], scale: [0.94, 1] }, { duration: 0.32 });
    trigger.classList.add('on');
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    addEventListener('resize', close);
  }
  function close() {
    if (!el) return;
    const node = el; el = null;
    node.style.pointerEvents = 'none';
    spring(node, { opacity: 0, scale: 0.94 }, { duration: 0.28 }).then(() => node.remove());
    trigger.classList.remove('on');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey);
    removeEventListener('resize', close);
  }
  trigger.addEventListener('click', () => (el ? close() : open()));
}
