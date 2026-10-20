// Settings: defaults, persistence, and the GameConfig they produce.
import { showOf } from '../strategy/personalities.js';

const KEY = 'poker-sim.settings.v1';

export const DEFAULTS = {
  show: 'community',
  opponents: ['jeff', 'annie', 'britta', 'pierce', 'abed'],
  betting: 'NL',
  structure: 'cash',
  sb: 1,
  bb: 2,
  anteMode: 'none', // none | player | bb
  ante: 0,          // per-player ante in chips (anteMode 'player')
  stackBB: 100,
  handsPerLevel: 10,
  autoRebuy: true,
  speed: 'normal',
  // helpers start off; players turn them on in Settings
  coach: false,
  equity: false,
  rankings: false,
  autoReview: false,
  positions: true,
  fourColor: false,
  units: 'chips',
  autoDeal: false,
};

// Settings that change the table itself; changing any of them needs a new session.
export const TABLE_KEYS = ['show', 'opponents', 'betting', 'structure', 'sb', 'bb', 'anteMode', 'ante', 'stackBB', 'handsPerLevel', 'autoRebuy'];

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') return sanitize({ ...DEFAULTS, ...raw });
  } catch { /* storage blocked or corrupt: use defaults */ }
  return { ...DEFAULTS };
}

export function hasSavedSettings() {
  try { return localStorage.getItem(KEY) != null; } catch { return false; }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not fatal */ }
}

function sanitize(s) {
  const show = showOf(s.show);
  s.show = show.id;
  s.opponents = (Array.isArray(s.opponents) ? s.opponents : []).filter((id) => show.cast.includes(id));
  if (!s.opponents.length) s.opponents = show.cast.slice(0, 5);
  for (const k of ['sb', 'bb', 'ante', 'stackBB', 'handsPerLevel']) {
    const n = Math.round(Number(s[k]));
    s[k] = Number.isFinite(n) && n >= 0 ? n : DEFAULTS[k];
  }
  s.bb = Math.max(2, s.bb);
  s.sb = Math.min(Math.max(1, s.sb), s.bb);
  s.stackBB = Math.min(Math.max(10, s.stackBB), 1000);
  s.handsPerLevel = Math.max(1, s.handsPerLevel);
  return s;
}

/** Switch shows, keeping the same table size. */
export function pickShow(s, showId) {
  const show = showOf(showId);
  if (show.id === s.show) return;
  const n = Math.max(1, Math.min(s.opponents.length, show.cast.length));
  s.show = show.id;
  s.opponents = show.cast.slice(0, n);
}

export const SPEED = { slow: 1.6, normal: 1, fast: 0.45 };

const LEVEL_MULT = [1, 2, 3, 4, 6, 8, 10, 15, 20, 30, 40, 60, 80, 100, 150, 200];

/** Rising-blind schedule built from the starting blinds. */
export function levelSchedule(s) {
  return LEVEL_MULT.map((m) => {
    const bb = Math.max(2, Math.round(s.bb * m));
    const sb = Math.max(1, Math.round((bb * s.sb) / s.bb));
    const ante = s.anteMode === 'bb' ? bb : s.anteMode === 'player' ? Math.max(1, Math.round((s.ante || 1) * m)) : 0;
    return { sb, bb, ante };
  });
}

export function buildConfig(s, PERSONALITIES) {
  const stack = s.stackBB * s.bb;
  return {
    players: [
      { id: 'hero', name: 'You', isHuman: true },
      ...s.opponents.map((id) => ({ id, name: PERSONALITIES[id]?.name ?? cap(id) })),
    ],
    betting: s.betting,
    structure: s.structure,
    smallBlind: s.sb,
    bigBlind: s.bb,
    ante: s.anteMode === 'bb' ? s.bb : s.anteMode === 'player' ? Math.max(1, s.ante) : 0,
    bigBlindAnte: s.anteMode === 'bb',
    startingStack: stack,
    cash: { autoRebuyBots: s.autoRebuy, rebuyTo: stack },
    tournament: { handsPerLevel: s.handsPerLevel, levels: levelSchedule(s) },
  };
}

export const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
