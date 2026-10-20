export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';

export function newDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

// Fisher-Yates. `rng` is a float source in [0, 1); if it also has `int(n)` (like secureRng) that is
// used instead, so every one of the 52! orders is exactly equally likely.
export function shuffle(arr, rng = secureRng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int ? rng.int(i + 1) : Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// Cryptographic randomness (Web Crypto, in every browser, Electron and Node 19+). Unseeded games deal
// with this. int(n) uses rejection sampling, so it has no modulo bias.
const POOL = new Uint32Array(256);
let poolAt = POOL.length;
function u32() {
  if (poolAt === POOL.length) { globalThis.crypto.getRandomValues(POOL); poolAt = 0; }
  return POOL[poolAt++];
}
export const secureRng = Object.assign(
  () => (u32() * 2 ** 21 + (u32() >>> 11)) / 2 ** 53, // 53 random bits, like Math.random
  {
    int(n) { // uniform integer in [0, n), 1 <= n <= 2^32
      const limit = 2 ** 32 - (2 ** 32 % n);
      let x;
      do x = u32(); while (x >= limit);
      return x % n;
    },
  },
);

// mulberry32: seeded and reproducible, for tests and drills
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
