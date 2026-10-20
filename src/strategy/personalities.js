// Opponents, grouped by TV show. Each is the shared baseline policy plus small offsets (see policy.BASE_PARAMS).
// Offsets stay small on purpose: every bot is still a strong, hard-to-exploit player, and the
// characters only differ in flavor (a little looser, a little more bluffy, a few more traps...).
// Ranges used: looseness ±0.04, callDown ±0.012 (these two touch all-in decisions, so they stay tight);
// aggression ±0.08, bluff 0.85..1.1, sizing 0.92..1.15, slowplay ≤0.18, overbet ≤0.3, riverPressure ≤0.12,
// ipAggro ≤0.06, bluffRaise ≤0.022 (inside the bounds a theory review found safe).

const CAST = {
  community: {
    name: 'Community',
    cast: {
      jeff: ['Jeff', 'Loose-aggressive', 'Smooth talker who leans on you in position and loves a river barrel.',
        { aggression: 0.06, bluff: 1.09, sizing: 1.075, ipAggro: 0.06, riverPressure: 0.12, looseness: 0.02 }],
      annie: ['Annie', 'Tight, textbook', 'Plays straight out of the study guide: disciplined, standard sizes, light on bluffs.',
        { looseness: -0.03, bluff: 0.85, callDown: -0.01, sizing: 0.94 }],
      britta: ['Britta', 'Stubborn defender', 'Hates getting pushed around: calls down a touch wider and sometimes fires back.',
        { callDown: 0.012, bluffRaise: 0.022, looseness: 0.01 }],
      pierce: ['Pierce', 'Splashy', 'Rich and sure of himself: a bit looser preflop and fond of big overbets.',
        { looseness: 0.04, overbet: 0.3, sizing: 1.15, aggression: 0.045 }],
      abed: ['Abed', 'Balanced, solver-like', 'Reads the meta. Mixes his strategy at precise frequencies; the closest to perfect.',
        {}],
      troy: ['Troy', 'Solid, slightly passive', 'Earnest and steady: calls a little more than he raises and bluffs a bit less.',
        { aggression: -0.08, bluff: 0.85, callDown: 0.01 }],
      shirley: ['Shirley', 'Tight and trappy', 'Sweet as pie until she check-raises you. Slowplays big hands a little more often.',
        { looseness: -0.02, slowplay: 0.18, bluff: 0.925 }],
    },
  },
  office: {
    name: 'The Office',
    cast: {
      michael: ['Michael', 'Overconfident', 'Thinks every hand could be the one and hates folding to friends. Calls a touch wide.',
        { looseness: 0.03, callDown: 0.012, bluff: 1.06 }],
      dwight: ['Dwight', 'Relentless', 'Treats every pot like a battle: raises more than most and sizes up.',
        { aggression: 0.06, sizing: 1.12, overbet: 0.15 }],
      jim: ['Jim', 'Sly', 'Quiet all hand, then a perfectly timed river bluff. Likes position.',
        { bluff: 1.09, riverPressure: 0.09, ipAggro: 0.045 }],
      pam: ['Pam', 'Patient', 'Waits for good spots and quietly traps with her strong hands.',
        { looseness: -0.02, slowplay: 0.12 }],
      angela: ['Angela', 'Ultra-tight', 'Plays very few hands and almost never bluffs. When she bets, believe her.',
        { looseness: -0.03, bluff: 0.85, aggression: -0.03, sizing: 0.94 }],
      kevin: ['Kevin', 'Secret shark', 'Looks lost, plays near-perfect poker. Don’t let the small talk fool you.',
        {}],
      stanley: ['Stanley', 'Unbothered', 'Steady and passive: checks, calls, and waits for the hand to be over.',
        { aggression: -0.08, bluff: 0.85, sizing: 0.94 }],
    },
  },
  goodplace: {
    name: 'The Good Place',
    cast: {
      eleanor: ['Eleanor', 'Scrappy bluffer', 'Talks her way out of trouble and pushes the moment she senses weakness.',
        { bluff: 1.09, aggression: 0.045, ipAggro: 0.045 }],
      chidi: ['Chidi', 'Overthinker', 'Agonizes over every choice, then makes the textbook play. Rarely bluffs.',
        { bluff: 0.85, aggression: -0.06, looseness: -0.01, sizing: 0.94 }],
      tahani: ['Tahani', 'Showy', 'Loves a grand gesture: bigger bets and the occasional dramatic overbet.',
        { sizing: 1.15, overbet: 0.27 }],
      jason: ['Jason', 'Chaotic', 'Plays more hands than anyone and fires when you least expect it.',
        { looseness: 0.04, bluff: 1.075, aggression: 0.045 }],
      michael: ['Michael', 'Architect', 'Builds elaborate traps: slowplays big hands and loves a check-raise.',
        { slowplay: 0.18, bluffRaise: 0.015 }],
      janet: ['Janet', 'All-knowing', 'Has seen every possible hand. Balanced, precise, close to perfect.',
        {}],
      shawn: ['Shawn', 'Ruthless', 'Keeps the pressure on every street, and most of all on the river.',
        { riverPressure: 0.12, aggression: 0.06 }],
    },
  },
  parks: {
    name: 'Parks and Recreation',
    cast: {
      leslie: ['Leslie', 'Go-getter', 'Takes the initiative and bets with energy, especially in position.',
        { aggression: 0.06, ipAggro: 0.06 }],
      ron: ['Ron', 'Stoic', 'Says nothing, plays few hands, and makes them count.',
        { looseness: -0.03, sizing: 1.075, bluff: 0.88 }],
      april: ['April', 'Deadpan', 'Impossible to read. Mixes in odd bluffs and quiet traps.',
        { bluff: 1.075, slowplay: 0.12 }],
      andy: ['Andy', 'Enthusiastic', 'Wants to see every flop and calls with hope more than he raises.',
        { looseness: 0.03, callDown: 0.01, aggression: -0.06 }],
      tom: ['Tom', 'Flashy', 'Treats himself to big bets and overbets. Style first.',
        { overbet: 0.3, sizing: 1.12, looseness: 0.02 }],
      ben: ['Ben', 'Numbers guy', 'Runs the math on every pot. Solid, disciplined, close to optimal.',
        { looseness: -0.01 }],
      donna: ['Donna', 'Confident', 'Knows her worth: steady pressure, and she rarely backs down.',
        { riverPressure: 0.09, callDown: 0.008, aggression: 0.03 }],
    },
  },
  b99: {
    name: 'Brooklyn Nine-Nine',
    cast: {
      jake: ['Jake', 'Cocky', 'Loves a hero call and a cheeky bluff. Plays a little loose.',
        { looseness: 0.02, bluff: 1.075, callDown: 0.01 }],
      amy: ['Amy', 'By the book', 'Organized and disciplined: standard sizes, light on bluffs.',
        { looseness: -0.03, bluff: 0.85, sizing: 0.94 }],
      holt: ['Holt', 'Poker-faced', 'Emotionless and exact. Balanced, near-perfect poker.',
        {}],
      rosa: ['Rosa', 'Intimidating', 'Few words, hard raises, and she fires back when pushed.',
        { bluffRaise: 0.022, aggression: 0.045 }],
      terry: ['Terry', 'Steady', 'Strong but gentle: calls more than he raises.',
        { aggression: -0.075, callDown: 0.008 }],
      charles: ['Charles', 'Loyal caller', 'Supportive to a fault: calls down a bit too often.',
        { callDown: 0.012, looseness: 0.02, bluff: 0.88 }],
      gina: ['Gina', 'Unpredictable', 'Pure confidence: overbets and bluffs when you least expect it.',
        { overbet: 0.18, bluff: 1.075, riverPressure: 0.075 }],
    },
  },
  superstore: {
    name: 'Superstore',
    cast: {
      amy: ['Amy', 'Practical', 'Level-headed and tight: folds the junk and bets her good hands.',
        { looseness: -0.02, aggression: 0.03 }],
      jonah: ['Jonah', 'Earnest', 'Means well and thinks it through, but calls a bit too much to be fair.',
        { callDown: 0.01, bluff: 0.88 }],
      dina: ['Dina', 'Drill sergeant', 'Aggressive and rule-obsessed: raises often and sizes up.',
        { aggression: 0.06, sizing: 1.09 }],
      glenn: ['Glenn', 'Gentle', 'Kind-hearted and passive: checks and calls more than he bets.',
        { aggression: -0.08, bluff: 0.85, sizing: 0.94 }],
      garrett: ['Garrett', 'Dry wit', 'Barely moves, then check-raises you. A quiet trapper.',
        { slowplay: 0.15, bluffRaise: 0.015 }],
      mateo: ['Mateo', 'Dramatic', 'Plays for the spotlight with big bets and the odd overbet.',
        { overbet: 0.225, sizing: 1.105, bluff: 1.045 }],
      cheyenne: ['Cheyenne', 'Breezy', 'Loose and casual, with a surprising bluff now and then.',
        { looseness: 0.03, bluff: 1.06 }],
    },
  },
};

/** Shows in menu order: [{ id, name, cast: [personality ids] }]. */
export const SHOWS = [];
/** Every opponent by id. Community keeps its original short ids; the rest are `${show}-${name}`. */
export const PERSONALITIES = {};

for (const [showId, { name, cast }] of Object.entries(CAST)) {
  const ids = [];
  for (const [key, [pname, style, blurb, params]] of Object.entries(cast)) {
    const id = showId === 'community' ? key : `${showId}-${key}`;
    PERSONALITIES[id] = { id, name: pname, style, blurb, params, show: showId };
    ids.push(id);
  }
  SHOWS.push({ id: showId, name, cast: ids });
}

export const showOf = (id) => SHOWS.find((s) => s.id === id) || SHOWS[0];
