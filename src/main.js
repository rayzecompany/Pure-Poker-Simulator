import './styles/app.css';
import logo from './assets/images/rayze-company.png';
import { h, sleep } from './ui/dom.js';
import { Game } from './engine/game.js';
import { createBot } from './strategy/bot.js';
import { liveEquity, describeHand } from './strategy/coach.js';
import { PERSONALITIES } from './strategy/personalities.js';
import { loadSettings, saveSettings, hasSavedSettings, buildConfig, levelSchedule, SPEED, TABLE_KEYS } from './ui/settings.js';
import { renderSetup } from './ui/setup.js';
import { renderHome, renderSettings, renderHowTo } from './ui/pages.js';
import { createTable } from './ui/table.js';
import { createActionBar } from './ui/actionbar.js';
import { createPanel } from './ui/coach.js';
import { popover, toast, resultCard, confirmDialog } from './ui/overlays.js';
import { rankingsSheet } from './ui/rankings.js';

const firstVisit = !hasSavedSettings();
const settings = loadSettings();
let S = null; // the running session
// Bumped on every action and session change; async work started under an older value is stale.
// Module-level so a new session can never reuse an old session's value.
let loop = 0;

// ---------- shell ----------

const stats = h('div.stats');
const rankBtn = h('button.btn.ghost.sm', { type: 'button', 'aria-haspopup': 'dialog' }, 'Hand rankings');
const coachBtn = h('button.btn.ghost.sm.on', { type: 'button', hidden: true, onclick: () => coachBtn.classList.toggle('on', S.panel.toggle()) }, 'Coach');
const settingsBtn = h('button.btn.ghost.sm', { type: 'button', hidden: true, onclick: () => showSettings() }, 'Settings');
const menuBtn = h('button.btn.ghost.sm', { type: 'button', hidden: true, onclick: () => showHome() }, 'Menu');
const main = h('main.page');
const shell = h('div.shell', {},
  h('header.topbar', {},
    h('button.brand', { type: 'button', title: 'Main menu', onclick: () => showHome() }, 'Pure Poker Sim'),
    stats, h('span.spacer'), h('div.tools', {}, rankBtn, coachBtn, settingsBtn, menuBtn)),
  main);
const made = h('footer.made', {}, h('span', {}, 'Made by'), h('img', { src: logo, alt: 'The Rayze Company' }));
document.getElementById('app').replaceWith(shell, made);
popover(rankBtn, rankingsSheet);

function applyDisplay() {
  document.body.classList.toggle('four', !!settings.fourColor);
  rankBtn.hidden = !settings.rankings;
}

const bigBlind = () => S?.game.state.bigBlind || settings.bb;
const round1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => (settings.units === 'bb' ? `${round1(n / bigBlind())} BB` : Math.round(n).toLocaleString());
const signed = (n, f = (x) => x) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${f(Math.abs(n))}`;

// ---------- screens ----------

const resumable = () => !!S && !S.over;
const play = () => (resumable() ? resume() : startSession(settings));

/** Leave the table (if we're at it) for another screen. The game waits. */
function leavePlay(screen) {
  if (S) S.paused = true;
  main.className = 'page';
  main.dataset.screen = screen;
  coachBtn.hidden = settingsBtn.hidden = true;
  menuBtn.hidden = screen === 'home';
  stats.hidden = true;
  main.scrollTop = 0;
}

function showHome() {
  leavePlay('home');
  renderHome(main, settings, {
    resumable: resumable(),
    firstVisit,
    onPlay: play,
    onNewGame: () => showNewGame(),
    onHowTo: () => showHowTo(),
    onSettings: () => showSettings(),
  });
}

function showNewGame() {
  leavePlay('newgame');
  renderSetup(main, settings, {
    inSession: resumable(),
    onBack: () => showHome(),
    onStart: async (s) => {
      if (resumable() && !(await confirmDialog('Start a new game?', 'Your current game ends. Stacks, stats and hand history start over.', 'Start new game'))) return;
      endSession();
      startSession(s);
    },
  });
}

function showSettings() {
  const back = resumable() && main.className === 'play-main';
  leavePlay('settings');
  renderSettings(main, settings, {
    doneLabel: back ? 'Back to table' : 'Done',
    onChange: (k, v) => { settings[k] = v; saveSettings(settings); applyDisplay(); },
    onDone: () => (back ? resume() : showHome()),
  });
}

function showHowTo() {
  leavePlay('howto');
  renderHowTo(main, {
    playLabel: resumable() ? 'Resume game' : 'Play',
    onBack: () => showHome(),
    onPlay: play,
  });
}

function resume() {
  showPlay();
  S.paused = false;
  if (settings.autoDeal && S.game.state.street === 'complete' && S.waitingNext) S.waitingNext();
}

// ---------- session ----------

function startSession(s) {
  endSession();
  for (const k of TABLE_KEYS) settings[k] = structuredClone(s[k]);
  s = settings;
  saveSettings(s);
  applyDisplay();
  const game = new Game(buildConfig(s, PERSONALITIES));
  const felt = h('div.felt.grain');
  const barEl = h('div.actionbar');
  const panelWrap = h('div.panel-wrap');
  const view = h('div.play', {}, h('div.table-col', {}, felt, barEl), panelWrap);
  S = {
    settings: structuredClone(s), game, view, paused: false, over: false, bots: {},
    deltas: new Map(), hands: 0, buyins: s.stackBB * s.bb, startStack: 0, liveKey: '', autoTimer: 0,
  };
  S.table = createTable(felt, { fmt, settings, handsPerLevel: s.structure === 'tournament' ? s.handsPerLevel : 0, heroCardSize });
  S.bar = createActionBar(barEl, { fmt, units: () => settings.units, onAct: (a) => apply(a) });
  S.panel = createPanel(panelWrap, { fmt, onFill: (a) => S.bar.fill(a) });
  coachBtn.classList.add('on');

  game.on('action', (rec, st) => { if (rec.seat != null) S?.table.logAction(rec, st || game.state); });
  game.on('street', () => S?.table.fadeActions());
  game.on('levelUp', (lvl) => {
    const l = levelSchedule(s)[Math.min(lvl, 15)];
    toast(`Level ${lvl + 1}: blinds ${l.sb}/${l.bb}${l.ante ? `, ante ${l.ante}` : ''}`);
  });
  game.on('busted', (seat) => {
    const p = game.state.seats[seat];
    if (s.structure === 'tournament' && p && !p.isHuman) toast(`${p.name} is out`);
  });

  S.table.setup(game.state);
  showPlay();
  nextHand();
}

function endSession() {
  if (!S) return;
  loop++;
  clearTimeout(S.autoTimer);
  S = null;
}

function showPlay() {
  main.className = 'play-main';
  delete main.dataset.screen;
  main.replaceChildren(S.view);
  coachBtn.hidden = settingsBtn.hidden = menuBtn.hidden = stats.hidden = false;
  applyDisplay();
  S.table.render(S.game.state);
  S.liveKey = '';
  updateLive();
  updateStats();
}

const heroCardSize = () => (innerWidth < 1240 ? [54, 76] : innerWidth >= 1700 ? [72, 101] : [64, 90]);

function nextHand() {
  const g = S.game;
  clearTimeout(S.autoTimer);
  S.waitingNext = null;
  S.table.clearActions();
  S.startStack = g.state.seats[0].stack;
  try { g.startHand(); } catch (err) { console.error(err); toast(`Could not deal: ${err.message}`); return; }
  S.liveKey = '';
  step();
}

async function step() {
  if (!S) return;
  const t = loop;
  const g = S.game;
  const st = g.state;
  S.table.render(st);
  updateLive();
  updateStats();
  if (st.street === 'complete') return handEnd();
  if (st.toAct == null) { console.warn('No one to act but hand not complete', st.street); return; }
  const seat = st.seats[st.toAct];
  if (seat.isHuman) {
    S.bar.turn(g.legalActions(), st);
    S.panel.setTurn(g.viewFor(seat.id));
    return;
  }
  S.panel.setTurn(null);
  S.bar.wait(`${seat.name} is thinking…`);
  const bot = S.bots[seat.id] || (S.bots[seat.id] = createBot(seat.id));
  const view = g.viewFor(seat.id);
  const ms = Math.max(120, (bot.thinkMs?.(view) ?? 900) * SPEED[settings.speed]);
  S.table.showThink(st.toAct, ms);
  await sleep(ms);
  while (S && S.paused && t === loop) await sleep(150);
  if (t !== loop) return;
  let action;
  try { action = bot.decide(view); } catch (err) { console.error(`${seat.name} bot error`, err); action = null; }
  apply(action);
}

function apply(action) {
  const g = S.game;
  const before = g.state;
  const boardLen = before.board.length;
  const street = before.street;
  const wasHero = before.seats[before.toAct]?.isHuman;
  loop++;
  try {
    if (!action) throw new Error('no action');
    g.act(action);
  } catch (err) {
    console.error('Action rejected', action, err);
    const l = g.legalActions();
    if (!l) return step();
    g.act(l.canCheck ? { type: 'check' } : { type: 'fold' });
  }
  S.table.clearThink();
  if (wasHero) { S.panel.setTurn(null); S.bar.wait(''); }
  const after = g.state;
  // let a new street land before the next player acts
  const dealt = after.board.length > boardLen || after.street !== street;
  const pause = after.street === 'complete' ? 400 : dealt ? 700 * Math.max(0.6, SPEED[settings.speed]) : 120;
  const t = loop;
  S.table.render(after);
  setTimeout(() => { if (t === loop) step(); }, pause);
}

async function handEnd() {
  const g = S.game;
  const st = g.state;
  const t = loop;
  S.panel.setTurn(null);
  S.bar.wait('');
  S.table.clearThink();
  const hero = st.seats[0];
  S.deltas.set(st.handNumber, hero.stack - S.startStack);
  S.hands++;
  S.panel.renderHistory(g.history || [], S.deltas);
  const rec = g.history?.[g.history.length - 1];
  if (settings.autoReview && rec?.heroDecisions?.length) S.panel.review(rec, true);
  updateStats();

  const alive = st.seats.filter((s) => s.stack > 0 && !s.busted);
  const heroOut = hero.stack <= 0;
  const tourney = S.settings.structure === 'tournament';
  await sleep(2500);
  while (S && S.paused && t === loop) await sleep(150); // don't pop the result card over another screen
  if (t !== loop) return;

  if (tourney && (heroOut || alive.length === 1)) {
    S.over = true;
    const [title, text] = heroOut
      ? [`You finished ${ordinal(alive.length + 1)}`, `Out after ${S.hands} hands. Every hand is in History with a coach review.`]
      : ['You won the tournament', `You took every chip in ${S.hands} hands.`];
    return resultCard(title, text, [{ label: 'Main menu', onclick: () => showHome() }, { label: 'Play again', primary: true, onclick: () => restart() }]);
  }
  if (heroOut) {
    const rebuy = h('button.btn.primary', { type: 'button', onclick: () => {
      const before = S.game.state.seats[0].stack;
      try { S.game.rebuy('hero'); } catch (err) { console.error(err); }
      S.buyins += S.game.state.seats[0].stack - before;
      nextHand();
    } }, `Rebuy ${fmt(S.settings.stackBB * S.settings.bb)}`);
    S.bar.custom(h('div.msg', {}, 'You’re out of chips.'), h('button.btn.secondary', { type: 'button', onclick: () => showHome() }, 'Main menu'), rebuy);
    rebuy.focus();
    return;
  }
  if (!tourney && alive.length < 2 && !S.settings.autoRebuy) { // with auto-rebuy, busted bots buy back in next hand
    S.bar.custom(h('div.msg', {}, 'Everyone else is out of chips.'), h('button.btn.primary', { type: 'button', onclick: () => restart() }, 'Play again'));
    return;
  }
  const next = h('button.btn.primary', { type: 'button', onclick: () => nextHand() }, 'Next hand', h('kbd', {}, 'N'));
  // The table shows the pot you collected; here, what the hand did to your stack.
  const d = S.deltas.get(st.handNumber);
  const won = st.result?.payouts?.[0] || 0;
  const msg = d > 0 ? `You collected ${fmt(won)}: ${fmt(d)} profit this hand.`
    : d < 0 ? `You lost ${fmt(-d)} this hand.${won ? ` (You got ${fmt(won)} back.)` : ''}`
      : won ? 'You broke even this hand.' : '';
  S.bar.custom(h('div.msg', {}, msg), next);
  S.waitingNext = () => { S.autoTimer = setTimeout(() => { if (t === loop && !S.paused) nextHand(); }, 1200); };
  if (settings.autoDeal) S.waitingNext();
}

function restart() {
  const s = S.settings;
  endSession();
  startSession(s);
}

const ordinal = (n) => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };

// ---------- live aid + stats ----------

function updateLive() {
  if (!S) return;
  const st = S.game.state;
  const hero = st.seats[0];
  if (!settings.equity || !hero.holeCards || hero.folded || st.street === 'complete') {
    S.table.setLive(null);
    S.liveKey = '';
    return;
  }
  const active = st.seats.filter((s) => !s.folded && !s.busted && !s.sittingOut).length;
  const key = `${st.handNumber}|${st.board.join('')}|${active}|${st.actions.length}`;
  if (key === S.liveKey) return;
  S.liveKey = key;
  // off the critical path: compute after this frame paints
  setTimeout(() => {
    if (S?.liveKey !== key) return;
    try {
      const view = S.game.viewFor('hero');
      const d = describeHand(view.seats[view.heroSeat].holeCards, view.board);
      const r = liveEquity(view);
      S.table.setLive({ name: r?.handName || d.name, draws: d.draws, outs: d.outs, equity: r?.equity ?? null, vs: r?.vs });
    } catch (err) { console.error('live equity', err); }
  }, 60);
}

function updateStats() {
  if (!S) { stats.replaceChildren(); return; }
  const st = S.game.state;
  const hero = st.seats[0];
  const inPlay = st.street !== 'complete' ? hero.totalBet || 0 : 0;
  const net = hero.stack + inPlay - S.buyins;
  const bb = S.settings.structure === 'tournament' ? S.settings.bb : st.bigBlind;
  const cls = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
  const stat = (k, v, c = '', opt = false) => h('div.stat' + (opt ? '.opt' : ''), {}, h('span.label', {}, k), h('b' + (c ? '.' + c : ''), {}, v));
  const items = [
    stat('Hands', S.hands),
    stat('Net', signed(net, (x) => Math.round(x).toLocaleString()), cls),
    stat('Net BB', signed(round1(net / bb)), cls),
    stat('Stack', fmt(hero.stack), '', true),
  ];
  if (S.settings.structure === 'tournament') items.push(stat('Players', st.seats.filter((s) => !s.busted && s.stack + (s.totalBet || 0) > 0).length, '', true));
  stats.replaceChildren(...items);
}

// ---------- keyboard ----------

document.addEventListener('keydown', (e) => {
  if (!S || main.className !== 'play-main' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector('.scrim')) return;
  if (S.bar.key(e)) { e.preventDefault(); return; }
  const k = e.key.toLowerCase();
  const typing = e.target instanceof HTMLInputElement && e.target.type === 'number';
  if (k === 'a' && !typing && S.bar.live) { e.preventDefault(); if (!S.panel.isOpen) coachBtn.click(); S.panel.advise(); }
  if (k === 'n' && !typing && S.game.state.street === 'complete') {
    const btn = [...document.querySelectorAll('.actionbar .btn.primary')].find((b) => b.textContent.startsWith('Next hand'));
    if (btn) { e.preventDefault(); btn.click(); }
  }
});

// ---------- boot ----------

applyDisplay();
showHome();
window.__poker = { get session() { return S; } }; // console debugging handle
