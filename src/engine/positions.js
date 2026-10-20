const ALL = ['UTG', 'UTG1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

// Canonical keys in preflop action order. Heads-up: BTN (posts SB, acts first preflop) then BB.
export function positionsFor(n) {
  if (n < 2 || n > 8) throw new Error(`Unsupported player count: ${n}`);
  if (n === 2) return ['BTN', 'BB'];
  return ALL.slice(8 - n);
}

export function displayLabel(key, n) {
  if (n === 2 && key === 'BTN') return 'BTN/SB';
  if (n >= 5 && key === positionsFor(n)[0]) return 'UTG';
  if (key === 'UTG1') return 'UTG+1';
  return key;
}
