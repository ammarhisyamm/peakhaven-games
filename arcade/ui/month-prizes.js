// Monthly prizes, shared by the pages and the API so both describe the same rule.
// One prize per game, to whoever tops that game's monthly board: three winners a month.
// Second and third are archived so last month's podium can be shown, and win nothing.
export const GAME_LABELS={blocks:'Peak Blocks',sequence:'Sequence',ridge:'Ridge Run'};
export const PODIUM_PLACES=3;
// Shown under a leaderboard's title when no prize line has been written for that game.
export const PRIZE_FALLBACK='1st place wins a prize';

const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const monthIndex=month=>Number(String(month??'').slice(5,7))-1;
export const monthName=month=>MONTHS[monthIndex(month)]??String(month??'');
export const monthLabel=month=>MONTHS[monthIndex(month)]?`${monthName(month)} ${String(month).slice(0,4)}`:String(month??'');
export const gameLabel=game=>GAME_LABELS[game]??String(game??'');

// The one line of prize text for a game's first place. Blank or missing text falls back, so a board always
// says what winning is worth.
export const prizeLine=(prizes,game)=>String(prizes?.[game]??'').trim()||PRIZE_FALLBACK;

// One modal for a player who won, however many games they won. Runners-up get none, so `wins` only ever
// holds first places.
export function winnerModal(wins){
  const won=(wins||[]).filter(w=>w&&w.game);
  if(!won.length)return null;
  const names=won.map(w=>gameLabel(w.game)),month=monthName(won[0].month);
  return {
    month:won[0].month,
    games:names,
    title:names.length===1?`You won ${names[0]} for ${month}!`:`You won ${names.length} games for ${month}!`,
    note:"We'll contact you at your account email about your prize.",
  };
}

// The address list behind "Copy winner emails". Only first places get a prize, so only they are copied, and
// someone who topped two games is written once.
export const winnerEmails=rows=>[...new Set((rows||[]).filter(r=>r&&r.winner&&r.email).map(r=>r.email))].join(', ');
