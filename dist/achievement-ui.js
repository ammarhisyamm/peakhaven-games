// Lives beside achievements.js and blocks-core.js rather than in ui/, because build.mjs copies dist/ to
// build/game/ while it flattens ui/ to the build root: this is the only arrangement in which the shelf, the
// achievement rules and the milestone constant can all reach each other by one path that works both in the
// browser and when the server imports them.
//
// How an achievement is drawn, in one place, so the shelf on a game's page, the shelf in the profile and the
// popup in the game cannot word the same thing three ways.
//
// Everything here takes the shelf the server sent (achievementState from achievements.js) and returns
// markup. Nothing here decides whether something is earned: the server does that from the replay it
// verified, and the popup is only a prediction it will confirm.
import {TIERS, achievementsFor, achievementState} from './achievements.js';

const MEDAL = Object.freeze({bronze: '#cd7f32', silver: '#c8d4dd', gold: '#ffc63a'});
const escape = value => String(value).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

// A medal that is actually there. The first version drew three tiny pips on a near-transparent disc,
// which read as an empty gap to the left of the text rather than as a badge. Now an earned one is a filled
// disc in its tier's colour with a tick, and an unearned one is a dashed ring with a padlock: either way
// something is drawn, and which of the two it is can be seen at a glance.
const TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L19 7"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
function medal(tier) {
  const earned = Boolean(tier);
  return `<span class="achievement-medal ${earned ? 'earned tier-' + tier : 'locked'}"
    style="--medal:${earned ? MEDAL[tier] : '#9fb3c2'}" role="img"
    aria-label="${earned ? tier + ' earned' : 'not earned yet'}">${earned ? TICK : LOCK}</span>`;
}

// One row: the medal, what it is, and how far along. `Gold vials 140 / 250` comes from the shelf itself, so
// the number here is always the number the server counted.
function row(entry) {
  const pct = Math.max(0, Math.min(1, entry.goal ? entry.value / entry.goal : 1));
  const towards = entry.next ? `${entry.next.tier} at ${entry.next.at.toLocaleString('en-AU')}` : 'all three earned';
  return `<li class="achievement ${entry.tier ? 'has-tier tier-' + entry.tier : ''} ${entry.done ? 'complete' : ''}">
    ${medal(entry.tier)}
    <span class="achievement-copy">
      <b>${escape(entry.label)}</b>
      <small>${escape(entry.describe)}</small>
      <span class="achievement-track" role="img" aria-label="${escape(entry.label)}: ${escape(entry.progress)}, next ${escape(towards)}">
        <i style="transform:scaleX(${pct.toFixed(3)})"></i>
      </span>
      <span class="achievement-progress">${escape(entry.progress)}<em>${escape(towards)}</em></span>
    </span>
  </li>`;
}

// The shelf for one game, or for all of them. A guest sees exactly the same list, with what it takes to earn
// each one, and one line telling them how to start earning: hiding the list from them would hide the reason
// to sign in.
export function achievementShelf(shelf, {game = null, signedIn = true, heading = null} = {}) {
  const entries = (shelf?.length ? shelf : achievementState({}, {game})).filter(e => !game || e.game === game);
  if (!entries.length) return '';
  const earned = entries.filter(e => e.tier).length;
  return `<section class="achievement-shelf" aria-label="${game ? escape(game) + ' achievements' : 'Achievements'}">
    ${heading ? `<header class="achievement-heading"><h3>${escape(heading)}</h3><span>${signedIn ? `${earned} of ${entries.length} earned` : `${entries.length} to earn`}</span></header>` : ''}
    <ul class="achievement-list">${entries.map(row).join('')}</ul>
    ${signedIn ? '' : '<p class="achievement-guest">Sign in to earn achievements. Only runs the arcade has checked count.</p>'}
  </section>`;
}

// A game's achievements as one row that opens on tap: "Achievements 0/3". The count is the tiers earned
// out of that game's achievements. <details> because it is a disclosure: it opens with a tap, with a click,
// with the keyboard, and it tells a screen reader which of those it is without any of it being written here.
export function achievementCollapse(shelf, game, {open = false} = {}) {
  const {earned, total} = achievementSummary(shelf, game);
  return `<details class="achievement-collapse" data-achievements="${escape(game)}"${open ? ' open' : ''}>
    <summary><span class="achievement-collapse-label">Achievements</span>
      <b>${earned}/${total}</b><i class="achievement-collapse-mark" aria-hidden="true">▸</i></summary>
    ${achievementShelf(shelf, {game})}
  </details>`;
}

// How many of a game's achievements are earned, for a one-line summary beside a game.
export function achievementSummary(shelf, game) {
  const entries = (shelf ?? []).filter(e => e.game === game);
  const total = entries.length || achievementsFor(game).length;
  return {earned: entries.filter(e => e.tier).length, total};
}

// "Achievement unlocked!", the moment the run earns it. One at a time, queued, so two in the same cascade do
// not land on top of each other. The server has the last word: this is shown while the run is still being
// played, and only what verifies is kept.
// `create` is injected so the queueing can be tested without a browser; in the page it is just
// document.createElement.
export function createAchievementPopup({host = null, onShow = null, motion = true,
  create = tag => document.createElement(tag)} = {}) {
  const target = host ?? (typeof document === 'undefined' ? null : document.body);
  const shown = new Set();
  const queue = [];
  let showing = false;
  const next = () => {
    if (showing || !queue.length) return;
    const entry = queue.shift();
    showing = true;
    const el = create('div');
    el.className = `achievement-popup tier-${entry.tier}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="achievement-popup-medal" style="--medal:${MEDAL[entry.tier]}"></span>
      <span><strong>Achievement unlocked!</strong><b>${escape(entry.name)}</b><small>${escape(entry.tier)} · ${escape(String(entry.at))}</small></span>`;
    target?.append(el);
    onShow?.(entry);
    const done = () => {el.remove(); showing = false; next();};
    if (!motion) {setTimeout(done, 1800); return;}
    el.animate([
      {opacity: 0, transform: 'translateY(18px) scale(.86)'},
      {opacity: 1, transform: 'translateY(0) scale(1)', offset: .18},
      {opacity: 1, transform: 'translateY(0) scale(1)', offset: .82},
      {opacity: 0, transform: 'translateY(-14px) scale(.98)'},
    ], {duration: 2400, easing: 'cubic-bezier(.22,1,.3,1)', fill: 'both'}).onfinish = done;
  };
  return {
    // Each achievement announces itself once a run, however many times the numbers cross the line.
    offer(earned) {
      for (const entry of earned ?? []) {
        const key = `${entry.id}:${entry.tier}`;
        if (shown.has(key)) continue;
        shown.add(key);
        queue.push(entry);
      }
      next();
    },
    reset() {shown.clear(); queue.length = 0;},
    get pending() {return queue.length;},
  };
}
