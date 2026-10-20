// Bots: sample an action from the shared baseline policy with a small personality tilt. Only the view is used.
import { analyze, sample } from './policy.js';
import { PERSONALITIES } from './personalities.js';

export function createBot(id) {
  const { params } = PERSONALITIES[id] || PERSONALITIES.abed;
  return {
    id,
    decide(view) {
      try {
        return sample(analyze(view, params).options).action;
      } catch (e) {
        // never stall the table: fall back to the cheapest legal action
        console.error('bot decide failed', e);
        return view.legal?.canCheck ? { type: 'check' } : { type: 'fold' };
      }
    },
    thinkMs(view) {
      const legal = view.legal;
      if (!legal) return 600;
      const big = legal.callAmount > legal.pot * 0.5 || legal.callAmount > view.seats[view.heroSeat].stack * 0.3;
      const ms = (view.street === 'preflop' ? 700 : 1000) + Math.random() * 700 + (big ? 600 + Math.random() * 600 : 0) + (view.street === 'river' ? 250 : 0);
      return Math.round(Math.min(2500, Math.max(600, ms)));
    },
  };
}
