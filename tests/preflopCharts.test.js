import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRange, freq, ALL_HANDS, comboCount, DEPTHS, RFI, SB_LIMP, VS_RFI, VS_3BET, VS_4BET,
  PUSH, CALL_PUSH, HU, FL, SIZING,
} from '../src/strategy/preflopCharts.js';

const keys = (s) => Object.keys(parseRange(s)).sort();
const pct = (m) => (comboCount(m) / 1326) * 100;
const VALID = new Set(ALL_HANDS);

test('169 hand classes, 1326 combos', () => {
  assert.equal(ALL_HANDS.length, 169);
  assert.equal(comboCount(Object.fromEntries(ALL_HANDS.map((h) => [h, 1]))), 1326);
});

test('parseRange expands tokens', () => {
  assert.equal(Object.keys(parseRange('22+')).length, 13);
  assert.equal(Object.keys(parseRange('A2s+')).length, 12);
  assert.deepEqual(keys('KTo+'), ['KJo', 'KQo', 'KTo']);
  assert.deepEqual(keys('T9s-65s'), ['65s', '76s', '87s', '98s', 'T9s']);
  assert.deepEqual(keys('A5s-A2s'), ['A2s', 'A3s', 'A4s', 'A5s']);
  assert.deepEqual(keys('88-55'), ['55', '66', '77', '88']);
  assert.deepEqual(keys('AK'), ['AKo', 'AKs']);
  assert.deepEqual(parseRange('A5s:0.5'), { A5s: 0.5 });
  assert.deepEqual(parseRange('A2s+,A9s-A3s:0'), { AKs: 1, AQs: 1, AJs: 1, ATs: 1, A2s: 1 });
  assert.equal(freq(parseRange('AA'), 'KK'), 0);
  assert.throws(() => parseRange('KAs'));
  assert.throws(() => parseRange('AA:2'));
});

// Walk every exported range map.
function* maps(obj, path = []) {
  if (!obj || typeof obj !== 'object') return;
  const vals = Object.values(obj);
  if (vals.length && typeof vals[0] === 'number') { yield [path.join('.'), obj]; return; }
  if (!vals.length && path.length) { yield [path.join('.'), obj]; return; }
  for (const [k, v] of Object.entries(obj)) yield* maps(v, [...path, k]);
}

test('every range map has valid classes and freq in (0,1]', () => {
  for (const [name, m] of maps({ RFI, SB_LIMP, VS_RFI, VS_3BET, VS_4BET, HU, FL })) {
    for (const [h, f] of Object.entries(m)) {
      assert.ok(VALID.has(h), `${name}: bad class ${h}`);
      assert.ok(f > 0 && f <= 1, `${name}: ${h}=${f}`);
    }
  }
});

test('push/call maps cover 169 hands with 0 < maxBB <= 20', () => {
  for (const [name, m] of maps({ PUSH, CALL_PUSH })) {
    assert.equal(Object.keys(m).length, 169, name);
    for (const [h, v] of Object.entries(m)) assert.ok(VALID.has(h) && v > 0 && v <= 20, `${name} ${h}=${v}`);
  }
});

test('raise + call never exceeds 1, and SB raise + limp <= 1', () => {
  const pairs = [];
  for (const d of DEPTHS) {
    for (const hero of Object.values(VS_RFI[d])) for (const o of Object.values(hero)) pairs.push([o.threeBet, o.call]);
    for (const o of Object.values(VS_3BET[d])) pairs.push([o.IP.fourBet, o.IP.call], [o.OOP.fourBet, o.OOP.call]);
    pairs.push([VS_4BET[d].jam, VS_4BET[d].call], [RFI[d].SB, SB_LIMP[d]], [HU.BB_VS_BTN[d].threeBet, HU.BB_VS_BTN[d].call]);
  }
  for (const o of Object.values(FL.VS_RFI)) pairs.push([o.threeBet, o.call]);
  for (const [a, b] of pairs) for (const h of ALL_HANDS) assert.ok(freq(a, h) + freq(b, h) <= 1.0001, h);
});

test('VS_RFI covers every later hero vs earlier opener', () => {
  const order = ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  for (const d of DEPTHS) order.forEach((hero, i) => order.slice(0, i).forEach((op) => {
    assert.ok(VS_RFI[d][hero][op].threeBet && VS_RFI[d][hero][op].call, `${d} ${hero} vs ${op}`);
  }));
});

test('RFI widths are monotonic by position', () => {
  for (const d of DEPTHS) {
    const w = ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN'].map((p) => pct(RFI[d][p]));
    for (let i = 1; i < w.length; i++) assert.ok(w[i] > w[i - 1], `${d}bb ${w.join(' ')}`);
    console.log(`RFI ${d}bb: ` + Object.keys(RFI[d]).map((p) => `${p} ${pct(RFI[d][p]).toFixed(1)}%`).join(', ') +
      (comboCount(SB_LIMP[d]) ? `, SB limp ${pct(SB_LIMP[d]).toFixed(1)}%` : ''));
  }
  console.log('FL RFI: ' + Object.keys(FL.RFI).map((p) => `${p} ${pct(FL.RFI[p]).toFixed(1)}%`).join(', '));
  console.log('HU BTN RFI: ' + DEPTHS.map((d) => `${d}bb ${pct(HU.BTN_RFI[d]).toFixed(1)}%`).join(', '));
  const at = (m, s) => pct(Object.fromEntries(Object.entries(m).filter(([, v]) => v >= s).map(([h]) => [h, 1])));
  for (const s of [20, 15, 10, 6]) {
    console.log(`PUSH ${s}bb: ` + Object.keys(PUSH).map((p) => `${p} ${at(PUSH[p], s).toFixed(1)}%`).join(', '));
  }
  console.log('BB call vs 10bb shove: ' + Object.keys(CALL_PUSH.BB).map((p) => `${p} ${at(CALL_PUSH.BB[p], 10).toFixed(1)}%`).join(', '));
  for (const d of DEPTHS) {
    console.log(`BB defend ${d}bb: ` + ['UTG', 'HJ', 'CO', 'BTN', 'SB'].map((o) => {
      const { threeBet, call } = VS_RFI[d].BB[o];
      return `vs ${o} 3b ${pct(threeBet).toFixed(1)}% + call ${pct(call).toFixed(1)}%`;
    }).join(', '));
  }
});

test('push ranges sanity: premiums always shove, trash never at 15bb from UTG', () => {
  for (const p of Object.keys(PUSH)) assert.equal(PUSH[p].AA, 20);
  assert.ok(PUSH.UTG['72o'] < 5);
  assert.ok(PUSH.UTG.AKo >= 15 && PUSH.BTN.A2o >= PUSH.UTG.A2o);
  assert.ok(SIZING.open[100].default === 2.5 && SIZING.limpAdd === 1);
});
