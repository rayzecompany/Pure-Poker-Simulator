import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHOWS, PERSONALITIES } from '../src/strategy/personalities.js';
import { BASE_PARAMS } from '../src/strategy/policy.js';
import { createBot } from '../src/strategy/bot.js';
import { Game, autoPlayHand } from '../src/engine/game.js';
import { pickShow, buildConfig, DEFAULTS } from '../src/ui/settings.js';

// Personalities must stay subtle: small offsets from the strong baseline.
const BOUNDS = {
  looseness: [-0.04, 0.04], aggression: [-0.08, 0.08], bluff: [0.85, 1.1], sizing: [0.92, 1.15], callDown: [-0.012, 0.012],
  slowplay: [0, 0.18], overbet: [0, 0.3], riverPressure: [0, 0.12], ipAggro: [0, 0.06], bluffRaise: [0, 0.022],
};

test('six shows, seven characters each, unique ids', () => {
  assert.equal(SHOWS.length, 6);
  assert.deepEqual(SHOWS.slice(0, 3).map((s) => s.name), ['Community', 'The Office', 'The Good Place']);
  for (const s of SHOWS) assert.equal(s.cast.length, 7, s.name);
  const ids = SHOWS.flatMap((s) => s.cast);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(Object.keys(PERSONALITIES).length, 42);
});

test('every personality is a small, known offset from the baseline', () => {
  for (const p of Object.values(PERSONALITIES)) {
    assert.ok(p.name && p.style && p.blurb, p.id);
    for (const [k, v] of Object.entries(p.params)) {
      assert.ok(k in BASE_PARAMS, `${p.id}: unknown param ${k}`);
      assert.ok(v >= BOUNDS[k][0] && v <= BOUNDS[k][1], `${p.id}.${k} = ${v}`);
    }
  }
});

test('switching shows keeps the table size and seats that cast', () => {
  const s = structuredClone(DEFAULTS);
  pickShow(s, 'office');
  assert.equal(s.show, 'office');
  assert.equal(s.opponents.length, 5);
  assert.ok(s.opponents.every((id) => PERSONALITIES[id].show === 'office'));
  const cfg = buildConfig(s, PERSONALITIES);
  assert.deepEqual(cfg.players.map((p) => p.name), ['You', 'Michael', 'Dwight', 'Jim', 'Pam', 'Angela']);
});

test('every show’s full cast plays legal hands together', () => {
  for (const show of SHOWS) {
    const g = new Game({ players: show.cast.map((id) => ({ id, name: PERSONALITIES[id].name })), seed: 3, startingStack: 200 });
    const bots = Object.fromEntries(show.cast.map((id) => [id, createBot(id)]));
    for (let h = 0; h < 25; h++) autoPlayHand(g, (v) => bots[v.heroId].decide(v));
    const chips = g.state.seats.reduce((a, s) => a + s.stack, 0);
    assert.ok(chips >= 7 * 200, `${show.name} chips ${chips}`); // auto-rebuys can only add
  }
});
